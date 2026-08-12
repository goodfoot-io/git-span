# Running and verifying

Producing a trajectory is not the finish line — scoring it with
`programbench eval` has its own unresolved gap (a default `--image-tag` that
silently scores against the *contaminated* image, not the clean-room one it
claims to be). Read `${CLAUDE_SKILL_DIR}/references/evaluation-and-scoring.md` before running
`eval` for the first time; don't assume the default invocation is correct.

## Preflight one real container

Before any batch, verify the derived image under ProgramBench's real
`--user agent --network none --cap-drop SYS_PTRACE` settings:

```sh
${CLAUDE_SKILL_DIR}/bin/preflight-container.sh programbench/xorg62_1776_tty-clock.f2f847c:task_cleanroom_v6
```

Expect: `whoami` → `agent`; node/git-span versions match the manifest;
bridge import succeeds; `SKILL.md` readable; `git status --short` may show
pre-existing task content (e.g. a base-image-shipped binary) — that's
expected, not a failure; `git span list --porcelain` prints the human
message `No spans match the filters.` (28 bytes) even with zero spans —
that's not byte-empty but *is* zero spans (see `troubleshooting.md` finding
a/b). Don't script the setup guide's literal `test -z "$(...)"` /
`status --short` snippets as pass/fail gates; read the output.

## Bridge smoke scenario

`experiment/smoke_test.py` implements the setup guide's disposable-repo
scenario end to end against a real derived container:

```sh
cd packages/mini-swe-agent
uv run python experiment/smoke_test.py --expected experiment/expected.json
```

16 numbered assertions, exit 0 only if every one passes; also appends a
timestamped transcript to `reports/programbench/smoke.md`. Covers: env
construction, disposable-repo setup (bypassing hooks), attestation,
uncovered-writes `git status` report, allow-on-already-presented commit,
hold-once on fresh never-previewed debt, span add/why, retry commit,
anchored-read context, `serialize()` shape, a second real
`hooks_required=True` construction against `/workspace`, and a control-arm
check. See `troubleshooting.md` for the advisor hold/allow semantics this
depends on and why the scenario isn't the setup guide's literal step
ordering.

Re-run this after **any** change to hooks, the skill, the Dockerfile, or
`environment.py`/`bridge.py` before trusting a real batch.

## Running the two arms

`programbench` has **no** `-i`/`--instance` flag — the only selector is
`--filter <regex>`, matched with `re.match` (start-anchored only, not
whole-string). An unanchored filter runs **all** vendored instances (201 by
default), not one canary. Always anchor both ends:

```sh
--filter '^xorg62__tty-clock\.f2f847c$'
```

Use the guarded wrapper, which refuses to run without an anchored filter
and an explicit confirmation (this calls a live model API and can occupy a
container up to the configured wall-time ceiling):

```sh
${CLAUDE_SKILL_DIR}/bin/run-arm.sh treatment --filter '^xorg62__tty-clock\.f2f847c$' --yes
${CLAUDE_SKILL_DIR}/bin/run-arm.sh control   --filter '^xorg62__tty-clock\.f2f847c$' --yes
```

Equivalent to (see `-c` semantics below):

```sh
uv run mswea-extra programbench -c programbench.yaml -c experiment/treatment.yaml \
  -m deepseek/deepseek-v4-flash --filter '^xorg62__tty-clock\.f2f847c$' -o results/treatment
```

- `-c` is repeatable with **no additive default**: passing it replaces the
  built-in default config list entirely. Always list the base
  `programbench.yaml` spec first, the arm file second (arm file wins on
  overlap) — omitting the base file silently drops step/cost/wall-time
  limits.
- Model key: litellm reads `DEEPSEEK_API_KEY`; the secret is stored as
  `DEEPSEEK_API_TOKEN` in `/workspace/.env.deepseek`. Export the mapped
  name, never print either value. `${CLAUDE_SKILL_DIR}/bin/run-arm.sh` does this for you given
  `--env-file`. That key has never actually been exercised against a live
  call in this setup — a dead/unfunded key only surfaces after the image
  pulls and the container starts, not before.
- `mswea-extra` prints `Loading global config from
  '/home/node/.config/mini-swe-agent/.env'` on every invocation. Check that
  file before a real run — an unrecorded global default there (API base
  URL, a different model) would be an unaudited confound identical across
  both arms but invisible in `manifest.json`.
- `model_class` must be **omitted** from an arm YAML, not set to `null` —
  `get_model()` does `config.pop("model_class", "")`, so an explicit
  `null` is a different value than "absent" and can break model
  resolution. `treatment.yaml`/`control.yaml` already omit it; keep that.
- The base config spec must be the bare name `programbench.yaml`, not the
  path `minisweagent/config/benchmarks/programbench.yaml` — the latter
  does not resolve through `minisweagent.config.get_config_path`.
- For anything beyond the single-instance canary, exclude the synthetic
  fixture instance explicitly: `mini-swe-agent`'s runner calls
  `load_all_instances()`, which — unlike `programbench`'s own
  `benchmark_instances()` — does **not** drop `testorg__calculator.abc1234`.
  Use `--shuffle` (a real flag, `mswea-extra programbench --help`) for
  batch instance ordering instead of hand-rolling pairing.
- Limits from `programbench.yaml` (unmodified by either arm file):
  `step_limit: 1000`, `cost_limit: 0` (uncapped), `wall_time_limit_seconds: 21600`
  (6h), `container_timeout: 7h`, `per_command_timeout_seconds: 180`. Budget
  for the ceiling, not the expectation.
- Results land under `-o results/<arm>/<instance_id>/`:
  `<instance_id>.traj.json` (full trajectory), `submission.tar.gz` (copied
  `/workspace` state). Run root gets `minisweagent.log` and
  `exit_statuses_<ts>.yaml`.
- For a real (non-canary) batch, shuffle and pair treatment/control runs
  rather than completing every treatment before starting controls; use
  several replicates per instance for a stochastic model; keep infra
  retries attributable (they replace a failed run and retain its audit
  record — never silently count as another sample).

## Post-run verification checklist

After a real run of either arm, confirm (see setup guide "Readiness gate" /
"Required treatment attestation and telemetry" for the full rationale):

- [ ] Treatment: `info.hooks.attestation.valid is True`; every event's
      `status` is a known classification (never a raw exception).
- [ ] Control: `info.hooks.enabled is False`; same derived image digest as
      treatment (confirms hook flags are the only arm-level difference).
- [ ] Treatment: `info.hooks.span_summary.span_count > 0` for at least some
      runs, and at least one `delivered: true` event's `context` is
      non-empty.
- [ ] `.span/` does not exist at task start in either arm.
- [ ] `submission.tar.gz` produced, exit status recorded in
      `exit_statuses_<ts>.yaml` — confirms the run didn't die on something
      unrelated to the hooks.
- [ ] `info.hooks.events` ordinals are monotonic 1..N with no gaps, and
      every `delivered: true` event's context is traceable in the matching
      trajectory step's tool-result content.

Do not start a full batch until a small shuffled pilot passes every item
above. If treatment agents never create spans in the pilot, report that as
a finding about the intervention itself — do not pre-seed spans to make the
pilot look better (that gives treatment task-specific information control
never gets, invalidating the comparison).
