# Scoring a run: `programbench eval`

Read this before invoking `programbench eval` for the first time.

## Confirmed working invocation (2026-08-13, control arm, 1 instance)

```sh
cd packages/mini-swe-agent
uv run programbench eval results/<arm> \
  --image-tag task_cleanroom_v6_original-base --docker-cpus 8
```

- `--image-tag task_cleanroom_v6_original-base` (the pristine base — see
  "Clean-room image contamination" below) resolved and ran correctly; get
  explicit sign-off on this choice vs. the contaminated default per instance,
  it's a real scoring-methodology decision, not a mechanical default.
- `--docker-cpus` defaults to 10; on a host with exactly 10 CPUs, pass a
  lower value (e.g. 8) — same "range of CPUs" failure mode as the run side,
  see `troubleshooting.md` finding m.
- Costs $0 — `eval` runs the vendored test suite locally, no model call.
  Took ~11.5 min for 319 tests / 1 instance.
- First invocation fetches test blobs from HuggingFace over the network
  (unauthenticated — expect a rate-limit warning, harmless for a single
  instance) — confirms this host-side `eval` step does need network access,
  unlike the `--network none` agent container it's evaluating.
- Output: `<results-dir>/<instance_id>/<instance_id>.eval.json` alongside
  the existing `.traj.json`. Terminal summary prints a 0-100 `Score` and
  "100 does not mean solved" — only a ✅ in that table means solved.

`eval.json` shape (list, not the dict the CLI summary might suggest):

```
test_results        list[{name, branch, status, extra}]  status: "passed"/"failure"/"skipped"
error_code           None | str
error_details        None | str
solution_branch       str   e.g. "submission"
test_branches          list[str]
test_branch_errors      dict
executable_hash          str
warnings                list
```
Count `status` values yourself (`Counter`) for a pass/fail breakdown — there
is no precomputed pass-count field.

## ⚠️ Clean-room image contamination

```
programbench eval output/run_name --image-tag <tag>   # default: task_cleanroom_v6
```

`--image-tag` **defaults to `task_cleanroom_v6`**, described by its own
`--help` text as "the artifact-free cleanroom image so submissions can't
rely on build artifacts leaked into the full `:task` build environment."

But `experiment/build-image.sh` **reassigns that exact tag**
(`programbench/<id>:task_cleanroom_v6`) to the git-span-derived image — the
one with Node 22, the `git-span` binary, the wheel, and `/opt/git-span`
baked in. `build-image.sh` only ever preserves the *pristine* image under a
different tag: `<repo>:task_cleanroom_v6_original-base`.

So a default `programbench eval` invocation scores every submission inside
a contaminated container, defeating the flag's purpose. `--image-tag
task_cleanroom_v6_original-base` resolves correctly (confirmed above) — use
it unless there's a specific reason not to. Before running `eval` for real:

- Confirm with whoever's asking for the score which tag they want — it's a
  scoring-methodology decision, not just a mechanical default.
- If eval must run against the derived (contaminated) image for some
  reason, that's a real deviation from the tool's documented guarantee —
  flag it explicitly in any results writeup, don't silently accept it.
- This is symmetric across both arms (same derived image, only hook flags
  differ) so it likely doesn't bias treatment vs. control *relative to each
  other* — but it can still change absolute pass/fail rates if a test
  happens to depend on a clean PATH or package set.

**Get an explicit answer to this before scoring a real batch.**

## Test blobs are not vendored or pinned

Unlike the task-definition dataset (`vendor-task-data.sh`, pinned to a
`facebookresearch/programbench` commit), the actual test blobs `eval` needs
come from HuggingFace:

- `HF_REPO_ID` defaults to `programbench/ProgramBench-Tests`.
- `HF_REVISION` defaults to `"main"` — **unpinned**, and not recorded
  anywhere in `manifest.json`. This is a silent reproducibility hole: the
  same instance can score against different test content at different
  times. If pinning matters for this experiment, either record the
  resolved revision at run time or vendor the blobs the same way the task
  dataset was vendored (`PROGRAMBENCH_BLOB_DIR` overrides the read path).
- Confirm before running: does fetching test blobs need network access
  and/or HF auth from this host? (Distinct from the task container itself,
  which stays `--network none` — this is a host-side fetch by the `eval`
  CLI, not something that runs inside the sandboxed submission container.)

## `eval`'s own container isn't pinned to `--platform linux/amd64`

`programbench.constants.DOCKER_RUN_ARGS = []` — empty. Unlike
`mini-swe-agent`'s `programbench.yaml` (`environment.run_args`, which the
run side explicitly sets), `eval`'s own container invocation passes no
explicit platform flag. Confirmed working anyway on this sibling-Docker-socket
arm64 host (2026-08-13 run): Docker auto-selected the image's single
published platform (amd64) with no explicit flag. Still worth a spot-check
(`docker inspect` the eval container) on a new/different host before trusting
timing.

`--docker-cpus` defaults to 10 (env override
`PROGRAMBENCH_DOCKER_CPUS`) and is unrelated to the run-side `--cpus 20` in
`programbench.yaml`'s `environment.run_args` — they're two different
container invocations (one runs the agent, one evaluates the submission)
and don't need to match.

## Other CLI facts worth knowing before a real batch

- `mswea-extra programbench --help` shows a `--shuffle` flag (shuffles
  instance order) — use it for a real batch instead of hand-rolling
  pairing; not mentioned in `reports/programbench/readiness.md`.
- `--redo-existing` re-runs instances that already have output. Using it on
  a partial batch overwrites, not appends — decide up front whether that's
  the retry mechanism you want, and keep the audit trail the setup guide
  asks for (an infra retry "replaces a failed run and retains its audit
  record" — nothing in the CLI does this bookkeeping for you).
- `mswea-extra` prints `Loading global config from
  '/home/node/.config/mini-swe-agent/.env'` on every invocation. Check what,
  if anything, lives there before a real run — an unrecorded global default
  (API base URL, a different model, extra env) would be an unaudited
  confound identical across both arms but invisible in `manifest.json`.
- `testorg__calculator.abc1234` is a synthetic fixture in the vendored
  dataset. `programbench.submission.benchmark_instances()` excludes it via
  `FIXTURE_PREFIX`, but `mini-swe-agent`'s runner calls
  `load_all_instances()` directly and does **not** exclude it. An
  unfiltered full-dataset batch (`--filter` omitted or too broad) will run
  it — exclude it explicitly (e.g. `--filter '^(?!testorg__).*$'`) for any
  run beyond the single-instance canary.
