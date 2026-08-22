# Architecture

## What this evaluates

`packages/mini-swe-agent` measures whether git-span's context-injecting hooks
help a mini-swe-agent solve ProgramBench tasks better, by running the same
task images/model/limits under two arms that differ only in whether hooks
run:

- **Treatment** — `HookedDockerEnvironment(hooks_enabled=true, hooks_required=true)`.
- **Control** — same class, `hooks_enabled=false`.

Full rationale and rules: `packages/mini-swe-agent/programbench-setup-guide.md`
(the source of truth this skill operationalizes — read it for anything not
covered here).

## Code map

- `src/minisweagent_gitspan/environment.py` — `HookedDockerEnvironment` /
  `HookedLocalEnvironment`, `HookedConfigMixin` (the `expected_*`/`hooks_*`
  config fields), `_build_attestation` (preflight logic), `HookedEnvironmentMixin`
  (pre/post hook wiring around `execute()`, `serialize()`).
- `src/minisweagent_gitspan/bridge.py` — `HookBridge`/`DockerHookBridge`,
  `ALL_HOOKS = ("static-plan", "advisor", "post-tool-use", "post-tool-use-failure",
  "session-end")`, `default_hooks_dir()`, `_rewrite_context` (swaps unsupported
  "Load the git-span:git-span skill" prose for a `sed`-the-SKILL.md instruction).
- `src/minisweagent_gitspan/cli.py` — `main_extra`, the `mswea-extra` entry
  point; auto-injects `--environment-class
  minisweagent_gitspan.environment.HookedDockerEnvironment` for the
  `programbench` subcommand and guarantees `finish_session()` runs on every
  exit path.
- `src/minisweagent_gitspan/hooks/bin/*.mjs` — the compiled hook bundles.
  **Do not edit these directly** — they're generated. Editable sources:
  `packages/agent-hooks/src/common/advisor-core.ts` (shared logic behind
  `advisor.mjs`, and behind `src/claude`/`src/codex`/`src/opencode`'s advisors
  too — a change here affects all four targets) and `packages/agent-hooks/src/mswea/advisor.ts`
  (the thin mswea-specific wrapper actually compiled for this bundle). The
  other four `ALL_HOOKS` bundles have equivalent `src/mswea/*.ts` sources in
  the same package. Rebuild with, from `packages/mini-swe-agent/`:
  `yarn build:hooks` → delegates to
  `yarn workspace agent-hooks run build:hooks:mswea` → runs
  `claude-code-hooks -i "src/mswea/{advisor,static-plan,post-tool-use,post-tool-use-failure,session-end}.ts" -o "../../packages/mini-swe-agent/src/minisweagent_gitspan/hooks/hooks.json"`
  from `packages/agent-hooks/`. Then `uv build` to embed the fresh bundles
  in the wheel — see `build-and-vendor.md` §1.
- `experiment/` — everything scoped to one pinned canary/batch: `Dockerfile`,
  `build-image.sh`, `vendor-task-data.sh`, `manifest.json`,
  `treatment.yaml`/`control.yaml`, `smoke_test.py`.

**Upstream coupling** (git-span tracked): `environment.py` and `agent.py`
subclass upstream `mini-swe-agent==2.4.6` (pinned in `pyproject.toml`)
classes — constructor signatures, config fields, and `execute()` internals.
Bumping that pin can silently break the subclass contract with no type
error. The gitignored `vendor/third-party/mini-swe-agent` checkout is the
local reference for that upstream API; re-fetch it if you need to inspect
the base classes.

## Attestation (what `hooks_required: true` checks)

`_build_attestation` (`environment.py`) runs inside the environment's
constructor and fails closed (raises `RequiredHookError`, no model call
happens) unless every one of these matches the `expected_*` values in the
arm config:

- `node --version`, `git span --version`, package version.
- sha256 of the five `ALL_HOOKS` `.mjs` bundles — **not** `hooks.json`;
  `expected_bundle_sha256` must omit that key or preflight always fails
  (`hooks.json` is never added to the hashed set, so any expected entry for
  it compares against `None`).
- sha256 of `skill_file` and the deterministic tree-hash of its parent
  directory (sorted `rglob`, `relpath\0 + bytes + \0` per file — see
  `_TREE_HASH_SCRIPT` in `environment.py`; `${CLAUDE_SKILL_DIR}/bin/verify-artifact-hashes.sh`
  reimplements the same algorithm for pre-build checking).
- zero pre-existing spans in the repo root, when
  `require_initial_no_spans: true`.

## Telemetry — exact schema

`env.serialize()["info"]["hooks"]` (`HookedDockerEnvironment.serialize`,
`environment.py:376-388`) is exactly these 8 keys, no more:

```
session_id          str
enabled              bool
required              bool
arm                   str            config.experiment_arm
attestation           dict | None    see below — None if hooks_enabled=false
events                list[dict]     see below — [] if hooks is None
span_summary          dict           see below
session_finished      bool
```

`attestation` (`_build_attestation`, `environment.py:98-186`; raises
`RequiredHookError` and is never returned partial if any check fails):

```
required               bool
enabled                bool          always True when this dict exists
arm                     str
package_version         str
hooks_dir               str
skill_file               str
valid                    bool         false until every check passes
node_version             str
git_span_version         str
bundle_sha256            dict[str,str]  one entry per ALL_HOOKS *.mjs, keyed by filename — hooks.json is NEVER a key
skill_file_sha256        str
skill_tree               dict          {"sha256": ..., ...} — parsed JSON from _TREE_HASH_SCRIPT
repository_root          str
initial_span_count       int
initial_span_names       list[str]
errors                   list[str]     empty when valid
configured_image         str           config.image (Docker-only, added after the base dict at environment.py:489)
container_image_id       str           `docker inspect --format {{.Image}}` (Docker-only)
```

Note: there is no `docker_image_id` key — it's `container_image_id`. There
is no `final_summary` key anywhere in this schema — don't invent one.

`events[i]` (appended by `HookedEnvironmentMixin`, one per hook invocation):

```
ordinal        int      1-based, monotonic across the whole session
hook           str      one of ALL_HOOKS: snapshot, advisor, post-tool-use, post-tool-use-failure, session-end
status           str
denied            bool
context           str | None
context_chars      int
delivered           bool
entities             list
spans                list
```

Token count is always `null` — the environment doesn't own the model
tokenizer. Join `events` to the trajectory's ordered commands to
reconstruct span mutations; there's no separate before/after snapshot.

`span_summary` (`_collect_span_summary`, `environment.py:347-373`, computed
once at `SessionEnd`):

```
span_count          int      len(unique span names from `git span list --porcelain`)
anchor_count        int      total anchor rows (a span can have >1 anchor)
why_count            int      spans whose `git span list <name>` block carries why prose (a body line that is neither the `##` header nor a `-` anchor bullet); bare `git span why <name>` is interactive read mode and fails on a non-terminal stdin, so it cannot be used here
why_errors            list[str]  span names where `git span list <name>` exited non-zero
list_returncode        int
drift_returncode        int
drift                     Any    parsed `git span drift --format json --no-exit-code`; {"unparsed": ...} if not valid JSON
```

Field names above are copied directly from source, not paraphrased — if a
trajectory shows something else, the wheel is stale (rebuild it).
