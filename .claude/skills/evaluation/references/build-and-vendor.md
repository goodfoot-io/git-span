# Building and vendoring

Everything here happens from `packages/mini-swe-agent`. See
`programbench-setup-guide.md` §"Build the mini-swe-agent artifact" /
"Derive the ProgramBench task images" for the narrative version.

## 1. Wheel + hook bundles

```sh
cd packages/mini-swe-agent
yarn build:hooks     # regenerates src/minisweagent_gitspan/hooks/bin/*.mjs + hooks.json
uv build              # embeds the .mjs bundles into the wheel
sha256sum dist/mini_swe_agent_git_span-*.whl
```

- The wheel's zip metadata (timestamps) is **not** byte-reproducible across
  `uv build` runs even with zero source changes; unpacked contents are
  byte-identical. Don't chase a matching wheel sha256 — treat
  `experiment/context/`'s staged copy as the canonical, immutable artifact
  once you've built the one you're going to ship, and don't re-run
  `uv build` afterward expecting the same bytes.
- Hook-bundle `.mjs` sha256s ARE deterministic across rebuilds (unlike the
  `plugins-claude`/`plugins-codex` bundles elsewhere in the monorepo, which
  hit esbuild collision-alias non-determinism across environments — that's
  a separate, known, non-blocking `yarn validate` finding, not something to
  chase here).
- After any hook/skill change, run `${CLAUDE_SKILL_DIR}/bin/verify-artifact-hashes.sh` before
  rebuilding the image — it recomputes wheel/bundle/skill-tree hashes from
  disk and diffs against `experiment/manifest.json` so drift is caught
  before it becomes an in-container preflight failure.

## 2. Pinned x86-64 binaries (git-span, node)

ProgramBench images are amd64-only; build/stage these once and reuse:

- **git-span**: `cargo zigbuild --release --target x86_64-unknown-linux-musl --locked`
  from `packages/git-span`. Needs `rustup target add x86_64-unknown-linux-musl`,
  `pip install ziglang` + a `zig -> python3 -m ziglang` shim, and
  `cargo install cargo-zigbuild` — this avoids needing a native musl
  cross-linker or `cross`-rs/QEMU. Output lands in
  `packages/git-span/target-cache/x86_64-unknown-linux-musl/release/git-span`
  (per-worktree `target-dir`, not the shared `/var/cache/git-span/cargo-target`
  root — see root `CLAUDE.md` `<build>`).
- **node**: download the pinned linux-x64 tarball from nodejs.org, verify its
  sha256 against the release's `SHASUMS256.txt`, extract only `bin/node`.
- Verify both under emulation before staging:
  `docker run --platform linux/amd64 debian:stable-slim ...`.
- Stage into `experiment/context/{git-span,node}` (git-span's `staged_path`/
  `staged_binary_path` in `manifest.json`).

## 3. Frozen skill tree

Copy the **complete** skill directory (not just `SKILL.md` — it routes to
`references/`) from the Claude-variant source (matches the bridge's Claude
hook wire protocol):

```sh
cp -r plugins-claude/git-span/skills/git-span experiment/context/git-span-skill
```

Record both the `SKILL.md` sha256 and the deterministic tree-hash (same
algorithm as `_TREE_HASH_SCRIPT`, see `architecture.md`). This is general
git-span operating guidance only — never bake task-specific spans or
solution hints into it (setup guide item 10).

## 4. Derive the task image

`experiment/Dockerfile` + `experiment/build-image.sh` do this idempotently:

```sh
./experiment/build-image.sh
```

- Captures the pristine base under `<repo>:<tag>_original-base` **exactly
  once** (source of truth for `BASE_IMAGE` on every rebuild, so re-runs
  never derive from a prior derivation) — pull the real base image first if
  neither tag exists locally.
- Copies the fresh wheel from `../dist/` into the build context, checks
  `node`/`git-span`/`git-span-skill` are staged, then
  `docker build --platform linux/amd64 --build-arg BASE_IMAGE=<original-base-tag> ...`.
- Only ever reassigns the **runner-expected tag**
  (`<repo>:task_cleanroom_v6`) to the freshly built image — the base tag is
  never overwritten.
- Two schematic-Dockerfile bugs already fixed in `experiment/Dockerfile`,
  don't reintroduce them: (a) install the wheel under its **original**
  filename — pip rejects a renamed wheel ("not a valid wheel filename");
  (b) don't build `FROM` a bare `sha256:...` ID — BuildKit parses that as a
  Hub repo name; build from the pinned local tag instead and keep the
  digest recorded in the manifest separately.
- Both arms use the **same** derived image (only the hook config flags
  differ) — this is intentional (setup guide "Experimental arms"): keeping
  treatment artifacts in the control image prevents image composition from
  becoming an arm-level confound. Never build a second image for control.

To modify what gets baked in (e.g. a newer skill, a rebuilt wheel), edit the
inputs under `experiment/context/`, bump the wheel/binary as needed, then
re-run `build-image.sh` — never hand-edit the derived image.

**Reproducibility gap: the pinned binaries only exist on this disk.**
`experiment/context/.gitignore` is a bare `*` and `dist/` is also
gitignored — the amd64 `git-span`/`node` binaries and the wheel that
`manifest.json` pins by hash are not in git anywhere. A fresh clone (or a
different host) must rebuild them from scratch to reproduce the pinned
hashes, and:
- the wheel will *not* hash-match on rebuild even from identical source
  (finding g below — zip metadata isn't reproducible);
- the git-span rebuild depends on a hand-installed toolchain
  (`ziglang` + `cargo-zigbuild`, see §2) that itself isn't pinned/recorded
  anywhere machine-readable, only in prose here and in `setup-log.md`.
`uv.lock` is also gitignored repo-wide (root `.gitignore` has `*.lock`), so
the Python dependency graph isn't pinned in-repo either — only
`programbench==1.2.4` in `pyproject.toml` is. If bit-for-bit artifact
reproduction across hosts/time ever matters, that requires deliberate
follow-up (e.g. archiving the built binaries+wheel alongside the manifest,
or committing a lockfile) — it isn't solved by anything currently in the
repo.

## 5. Vendor the ProgramBench task dataset

The PyPI `programbench` wheel ships **no task data**
(`data/tasks/.gitkeep` only). `programbench.constants.TASKS_DIR` resolves to
`<installed-package-dir>/data/tasks` with no override, so:

```sh
uv run experiment/vendor-task-data.sh   # or: ./experiment/vendor-task-data.sh
```

- Shallow, sparse-clones `facebookresearch/programbench` at the pinned
  commit (`experiment/manifest.json`'s `programbench.dataset_revision`),
  asserts the resolved commit matches exactly (fails closed otherwise),
  replaces `TASKS_DIR` wholesale.
- **Not durable**: this tree lives under
  `.venv/lib/.../site-packages/programbench/data/tasks`, not in the wheel.
  Any `uv sync`/`uv sync --reinstall` that reinstalls `programbench`
  recreates that directory empty. Re-run this script after every such sync.
- To pin a different upstream commit (e.g. a dataset update), edit
  `PINNED_COMMIT` in the script **and** `manifest.json`'s
  `programbench.dataset_revision`/`dataset_vendoring.pinned_commit`
  together — don't let them drift apart.
- `programbench==<version>` must stay a declared dependency (currently
  under `[dependency-groups].experiment` in `pyproject.toml`) or a plain
  `uv sync` silently drops it from the venv.

## 6. Update the manifest and arm configs together

`experiment/manifest.json` is the single pinned source of truth (per setup
guide "Pin the experiment"); `treatment.yaml`/`control.yaml`'s `expected_*`
fields must be copied from it exactly. After any artifact rebuild:

1. Recompute every sha256 (`${CLAUDE_SKILL_DIR}/bin/verify-artifact-hashes.sh`).
2. Update `manifest.json`'s `mini_swe_agent_git_span.wheel_sha256`,
   `hook_bundles_sha256`, `skill.skill_file_sha256`/`skill_tree_sha256`,
   `derived_image.image_id`.
3. Copy the non-`hooks.json` bundle hashes and the skill-tree hash into
   `treatment.yaml`'s `expected_bundle_sha256` / `expected_skill_tree_sha256`.
4. Bump `manifest_version` — don't edit a manifest mid-batch; cut a new one
   and re-derive images instead (setup guide: "Do not rebuild one arm
   midway through a batch").
