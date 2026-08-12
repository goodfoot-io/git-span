# Scoring a run: `programbench eval`

Nothing in `programbench-setup-guide.md` or the canary reports covers this —
the canary was stopped before either arm ran, let alone scored. Read this
before invoking `programbench eval` for the first time.

## ⚠️ Clean-room image contamination (unresolved as of the last canary)

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
a contaminated container, defeating the flag's purpose. Before running
`eval` for real:

- Ask whether the intended invocation is
  `--image-tag task_cleanroom_v6_original-base` instead of the default —
  confirm `eval` actually composes `{image_name}:{image_tag}` such that
  this resolves to a real, pulled image before relying on it.
- If eval must run against the derived (contaminated) image for some
  reason, that's a real deviation from the tool's documented guarantee —
  flag it explicitly in any results writeup, don't silently accept it.
- This is symmetric across both arms (same derived image, only hook flags
  differ) so it likely doesn't bias treatment vs. control *relative to each
  other* — but it can still change absolute pass/fail rates if a test
  happens to depend on a clean PATH or package set.

**Get an explicit answer to this before scoring a real batch.** It has
never been exercised.

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
explicit platform flag. Docker will generally auto-select the platform of a
locally-present single-platform image, but this hasn't been verified in
this sibling-Docker-socket setup. Before trusting `eval` timing/behavior,
confirm with a throwaway instance that its containers actually run under
amd64 emulation (`docker inspect` the eval container, or watch for a
platform-mismatch warning).

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
