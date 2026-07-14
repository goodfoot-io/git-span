# git span

`git span` tracks implicit semantic dependencies in a git repository — line-range or whole-file anchors that participate in a coupling no schema, type, or test enforces. Each span names its anchors, optionally carries a `why` sentence defining the subsystem they collectively form (recommended on every span), and surfaces drift via `git span stale` when those anchors diverge from their anchored state.

The primary CLI surface lives in `src/cli/mod.rs`. Run `git span --help` or `git span stale --help` for flag reference.

### Upgrading from the sqlite cache

The trail cache now lives at `<common_dir>/span/cache/v1/` as a BLAKE3-keyed content-addressed filesystem store. The previous sqlite-backed cache at `<common_dir>/span/cache/span_cache.sqlite` (or `<git_dir>/span/cache/span_cache.sqlite` on older per-worktree installations), along with its `-shm` and `-wal` companions, is unused and can be removed with a single `rm -f <common_dir>/span/cache/span_cache.sqlite*` (and the `<git_dir>` variant if present). Nothing reads those files anymore.

Separately, and unrelated to the sqlite cache above, `git span stale` (and related resolution paths) are backed by a second, currently-active cache: a SQLite database at `<common_dir>/span/stale-cache.db` (see `src/resolver/cache_v2/schema.rs`). Cleanup of the on-disk footprint needs to account for both stores — the `cache/v1/` filesystem store and `stale-cache.db` (plus its `-shm`/`-wal` companions) — not just one.

## Profiling

Perf investigation tooling is documented in [`./docs/profiling.md`](./docs/profiling.md):

- **Flame graph capture** — `perf record` + `inferno-flamegraph` recipe for identifying hot functions.
- **`--perf-trace <path>`** — opt-in per-anchor wall-clock CSV emitter for `git span stale`; CSV schema, usage constraints, and quick analysis snippets are documented there.
