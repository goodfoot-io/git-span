---
name: evaluation
description: Build, run, and modify the Docker-based ProgramBench evaluations for git-span's mini-swe-agent hooks (packages/mini-swe-agent/experiment) — treatment vs. control arms, derived task images, preflight/smoke checks, and real canary/batch runs.
---

# ProgramBench evaluation

Source of truth: `packages/mini-swe-agent/programbench-setup-guide.md` — read
it for anything this skill doesn't cover. This skill operationalizes it with
scripts and the concrete pinned state from the last canary setup (see
`reports/programbench/*.md`).

**This skill's own files** (`bin/*.sh`, `references/*.md` below) live at
`${CLAUDE_SKILL_DIR}` — i.e. `/workspace/.claude/skills/evaluation/` — **not**
inside `packages/mini-swe-agent/`. Every `bin/...` and `references/...` path
in this skill means `${CLAUDE_SKILL_DIR}/bin/...` /
`${CLAUDE_SKILL_DIR}/references/...`; run them from any cwd with that prefix,
e.g. `${CLAUDE_SKILL_DIR}/bin/verify-artifact-hashes.sh`. The repo paths this
skill operates *on* (`experiment/`, `src/minisweagent_gitspan/`,
`programbench-setup-guide.md`) are the separate, unprefixed ones below, all
under `packages/mini-swe-agent/`.

Everything this skill *evaluates* lives under `packages/mini-swe-agent/`:

```
experiment/
  Dockerfile, build-image.sh    # derive the treatment task image
  vendor-task-data.sh           # PyPI programbench ships no task data
  manifest.json                 # pinned versions/hashes/digests, single source of truth
  treatment.yaml / control.yaml # arm configs; treatment carries expected_*, control pins nothing
  expected.json                 # third pin-carrying file — read by smoke_test.py
  smoke_test.py                 # real-container bridge scenario
  context/                      # build-context: staged node/git-span binaries, wheel, skill copy
src/minisweagent_gitspan/
  environment.py, bridge.py, cli.py, hooks/bin/*.mjs
```

## Quick tasks

All `bin/`/`references/` paths below are relative to `${CLAUDE_SKILL_DIR}`.

| Doing | Load / run |
|---|---|
| Understand the hook bridge / attestation / telemetry shape | `${CLAUDE_SKILL_DIR}/references/architecture.md` |
| Rebuild the wheel, binaries, skill copy, or derived image | `${CLAUDE_SKILL_DIR}/references/build-and-vendor.md` |
| Check artifact hashes match `manifest.json` before rebuilding | `${CLAUDE_SKILL_DIR}/bin/verify-artifact-hashes.sh` |
| Re-pin every hash after a rebuild (all three files at once) | `${CLAUDE_SKILL_DIR}/bin/repin-artifacts.sh --yes` — then re-run with `--image-id sha256:...` after `build-image.sh` |
| Preflight a real derived container | `${CLAUDE_SKILL_DIR}/bin/preflight-container.sh <image>` |
| Run the bridge smoke scenario | `uv run python experiment/smoke_test.py --expected experiment/expected.json` (from `packages/mini-swe-agent` — this one's a repo path, not a skill path) |
| Run a real treatment/control eval | `${CLAUDE_SKILL_DIR}/references/running-and-verifying.md`, then `${CLAUDE_SKILL_DIR}/bin/run-arm.sh` |
| Score a completed run (`programbench eval`) | `${CLAUDE_SKILL_DIR}/references/evaluation-and-scoring.md` **first** — the default `--image-tag` is a known unresolved gap, see below |
| Something failed and looks like a known gotcha | `${CLAUDE_SKILL_DIR}/references/troubleshooting.md` — check before re-diagnosing |
| Working from inside a devcontainer / unsure Docker even works here | `${CLAUDE_SKILL_DIR}/references/troubleshooting.md` finding m — this is a sibling Docker socket (host's daemon), not nested Docker; verify before assuming |
| Need the exact `attestation`/`span_summary`/`events` trajectory field names | `${CLAUDE_SKILL_DIR}/references/architecture.md` "Telemetry — exact schema" — don't infer field names from prose, they're listed verbatim there |

## Non-negotiable rules

**Attestation/manifest integrity** (violating these fails closed inside the
container, or silently invalidates a score):
- **Three files carry pins, and they must move together:**
  `manifest.json` (the source of truth), `treatment.yaml`, and
  **`expected.json`** — the easy one to miss, since it isn't mentioned in the
  setup guide's pinning section but `smoke_test.py` reads it. Re-pinning two
  of the three leaves the smoke scenario asserting against dead hashes.
  `control.yaml` pins nothing (hooks are disabled there, so no attestation).
  `${CLAUDE_SKILL_DIR}/bin/repin-artifacts.sh` writes all three in lockstep.
- **`hooks.json` is never in `expected_bundle_sha256`.** It's not one of the
  5 `ALL_HOOKS` bundles hashed by `_build_attestation`; any expected entry
  for it compares against nothing and preflight always fails. See
  `${CLAUDE_SKILL_DIR}/references/troubleshooting.md` finding j. It *is*
  pinned in `manifest.json`'s `hook_bundles_sha256`, for provenance only.
- **`hooks.json` lives one directory above the bundles it lists.** The five
  `ALL_HOOKS` `.mjs` are in `src/minisweagent_gitspan/hooks/bin/`; `hooks.json`
  sits in `.../hooks/`. Anything that hashes the manifest's
  `hook_bundles_sha256` keys against disk must special-case that one path, or
  it reports a phantom mismatch for a file that is perfectly fine.
- **Never edit a manifest mid-batch.** Cut a new `manifest_version` and
  re-derive images instead of hand-patching pinned values.
- **`programbench eval`'s default `--image-tag` scores against the
  git-span-contaminated image, not the clean-room one it claims to be** —
  `${CLAUDE_SKILL_DIR}/references/evaluation-and-scoring.md`. Get this
  confirmed before trusting any score.

**Experiment design integrity**:
- **Never pre-seed spans.** The experiment is greenfield by design — every
  task starts with zero spans in both arms. Pre-seeding gives treatment
  information control never gets.
- **Both arms share one derived image**; only `hooks_enabled`/`hooks_required`
  differ. Never build a separate image for control.

**CLI/invocation gotchas**:
- **`-c` on `mswea-extra programbench` is non-additive.** Always pass the base
  `programbench.yaml` spec first, the arm file second — omitting the base
  file silently drops its limits rather than merging over defaults.
- **`--filter` is `re.match`, start-anchored only.** Anchor both ends
  (`'^instance_id$'`) or you run every vendored instance, not one.

**Cost/safety**:
- **Real runs cost money and can occupy a container for hours.** Use
  `${CLAUDE_SKILL_DIR}/bin/run-arm.sh`, which refuses to run without an
  explicit `--yes` and an anchored `--filter`. `cost_limit: 0` means
  uncapped — nobody has estimated a real dollar figure for a batch; ask
  before scaling past a 1-instance canary.
- Never print or log the DeepSeek key. It's stored as `DEEPSEEK_API_TOKEN` in
  `/workspace/.env.deepseek`; litellm expects it exported as
  `DEEPSEEK_API_KEY`.
- This devcontainer's Docker socket is a sibling to the host's daemon, not
  nested Docker — `-v` bind mounts to a path inside this container don't
  work (they resolve on the host); use `docker cp` or a build context
  instead. See `${CLAUDE_SKILL_DIR}/references/troubleshooting.md` finding m.

## Modifying the harness

`environment.py`/`agent.py` subclass upstream `mini-swe-agent==2.4.6` classes
pinned in `pyproject.toml` — see `${CLAUDE_SKILL_DIR}/references/architecture.md`
"Upstream coupling" before bumping that pin or changing constructor
signatures. Editable hook sources (not the compiled `.mjs`) live in
`packages/agent-hooks/src/` — see architecture.md's code map.

Full ordered sequence, all steps blocking — do not skip or reorder. Paths
prefixed `${CLAUDE_SKILL_DIR}` are this skill's; unprefixed paths are
`packages/mini-swe-agent`-relative repo paths:

1. Edit the real TypeScript source under `packages/agent-hooks/src/` (never
   `hooks/bin/*.mjs` directly — those are generated).
2. `yarn build:hooks && uv build` (from `packages/mini-swe-agent/`) —
   regenerates the `.mjs` bundles and embeds them in a fresh wheel.
   `${CLAUDE_SKILL_DIR}/references/build-and-vendor.md` §1-3.
3. `${CLAUDE_SKILL_DIR}/bin/verify-artifact-hashes.sh` — confirm hashes,
   fix drift, before touching the container.
4. `${CLAUDE_SKILL_DIR}/bin/repin-artifacts.sh --yes` — rewrites
   `manifest.json` + `treatment.yaml` + `expected.json` together from the
   artifacts just built, bumps `manifest_version`, and refuses to write if the
   wheel's embedded bundles don't match the on-disk ones (a stale wheel would
   otherwise get pins attesting to bytes the container never contains). Never
   hand-patch a subset of the three — see the attestation-integrity rules above.
5. `./experiment/build-image.sh` — rebuild the derived image; both arms
   still share it. Then re-run
   `${CLAUDE_SKILL_DIR}/bin/repin-artifacts.sh --yes --no-bump --image-id sha256:...`
   with the `derived_image_id=` it prints, to record the new image in
   `derived_image` and both arms.
6. `${CLAUDE_SKILL_DIR}/bin/preflight-container.sh <image>` then
   `uv run python experiment/smoke_test.py --expected experiment/expected.json`
   — both must pass before trusting a real run.
7. Repo golden rule still applies: lint/typecheck/test the changed package
   (`packages/agent-hooks` at minimum), then `yarn validate` from the root.

When adding a new smoke/test scenario, remember finding d in
`${CLAUDE_SKILL_DIR}/references/troubleshooting.md`: uncovered-writes
reporting needs ≥2 changed paths in one changeset — a single file can never
trigger a report or hold.
