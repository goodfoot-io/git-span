# git span

`git span` tracks implicit semantic dependencies in a git repository — line-range or whole-file anchors that participate in a coupling no schema, type, or test enforces. Each span names its anchors, optionally carries a `why` sentence defining the subsystem they collectively form (recommended on every span), and surfaces drift via `git span stale` when those anchors diverge from their anchored state.

The primary CLI surface lives in `src/cli/mod.rs`. Run `git span --help` or `git span stale --help` for flag reference.

### The stale cache

`git span stale` (and related resolution paths) are backed by a single persistent cache: a SQLite database at `<common_dir>/span/store.db` (plus its `-wal` and `-shm` companions), implemented in `src/resolver/store/`. This is the whole on-disk cache footprint — remove `store.db*` to reset it. Setting `GIT_SPAN_CACHE=0` disables it for a run.

The store is bounded by a byte high-water mark (256 MiB by default; override with `GIT_SPAN_STORE_MAX_BYTES` or `git config git-span.storeMaxBytes`), with transactional GC that runs only when a publish crosses the cap. It lives in the Git *common* directory, so it is shared across linked worktrees of one clone on one host; it is not shared cross-host or cross-clone. Earlier releases kept two separate caches (a `cache/v1/` filesystem trail store and a `stale-cache.db`); both were replaced by this one store and leave no files behind on a fresh clone.

## Profiling

Perf investigation tooling is documented in [`./docs/profiling.md`](./docs/profiling.md):

- **Flame graph capture** — `perf record` + `inferno-flamegraph` recipe for identifying hot functions.
- **`--perf-trace <path>`** — opt-in per-anchor wall-clock CSV emitter for `git span stale`; CSV schema, usage constraints, and quick analysis snippets are documented there.
