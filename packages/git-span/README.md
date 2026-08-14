# git span

`git span` tracks implicit semantic dependencies — line-range or whole-file anchors coupled by nothing a schema, type, test, or build/generator step enforces. Each span names its anchors, should carry a compact, decision-relevant `why`, and surfaces drift via `git span drift` when anchors diverge from their recorded state.

The primary CLI surface lives in `src/cli/mod.rs`. Run `git span --help` or `git span drift --help` for flag reference.

### Exact batched context

`git span context <address>... --format json` returns one schema-v1 snapshot
for exact repository-relative paths and inclusive line ranges: normalized
scopes, exact anchored/current overlaps, complete selected spans, why text,
live status/source facts, and structured mutation counts. `--fix` adds
cycle-safe positional repair; `--operation-id <uuid>` makes a delivery-unknown
repair replayable across processes. Failures leave stdout empty, while a valid
no-overlap query succeeds with an empty `spans` array. The complete schema,
token, failure, service, and recovery contract is in the
[command reference](../../plugins-claude/git-span/skills/git-span/references/command-reference.md#exact-batched-context).

Linux uses an authenticated private per-worktree watcher service for warm
queries and falls back to the same strict in-process answer whenever the
watcher or service is unavailable. The released-binary
[acceptance harness](./scripts/context-acceptance.py) runs 31 samples in each
required warm cell. On the documented 2026-08-14 container run, warm context
p50/p95 improvement over the legacy process lifecycle was at least
78.2%/76.3% (clean) and reached 86.7%/90.0% (multi-span); cold bootstrap was 43.0 ms,
invalidated rebuild 42.7 ms, strict fallback 34.6 ms, and a journaled repair
136.1 ms. Root-switch and linked-worktree checks passed.

### The drift cache

`git span drift` (and related resolution paths) are backed by a single persistent cache: a SQLite database at `<common_dir>/span/store.db` (plus its `-wal` and `-shm` companions), implemented in `src/resolver/store/`. This is the whole on-disk cache footprint — remove `store.db*` to reset it. Setting `GIT_SPAN_CACHE=0` disables it for a run.

The store is bounded by a count-based sweep: stale non-live generations are swept to a 16-generation reuse buffer, and maintenance runs after a publish and at drift open. It lives in the Git *common* directory, so it is shared across linked worktrees of one clone on one host; it is not shared cross-host or cross-clone. Earlier releases kept two separate caches (a `cache/v1/` filesystem trail store and a `stale-cache.db`); both were replaced by this one store and leave no files behind on a fresh clone.

### The shared executable-digest store

A configured filter driver's resolved executable (e.g. a `git-lfs` install) is content-hashed to prove its identity as part of every state-token capture. That hash is a fact about a file on the local machine, not about any one repository, so it is memoized in a *second*, small, per-user SQLite database — separate from the per-repo drift cache above — at `$GIT_SPAN_CACHE_HOME/exe-digest.db`, defaulting to `$HOME/.cache/git-span/exe-digest.db` (mirrors the workspace's `$HOME/.cache/git-span/cargo-target/` per-user build-artifact directory). Every repository on a machine that shares the same filter executable reuses the same memoized digest instead of re-hashing it per clone. `GIT_SPAN_EXE_DIGEST_DB` overrides the database file path directly (useful for CI isolation). `GIT_SPAN_CACHE=0` disables this store too, exactly like the drift cache. Implemented in `src/resolver/core/exe_digest_store.rs`; safe to delete at any time (it is rebuilt lazily, fail-closed on any error — a missing or broken database just means every executable is re-hashed).

## Profiling

Perf investigation tooling is documented in [Profiling `git span drift`](../../wiki/guides/profiling-git-span-drift.md):

- **Flame graph capture** — `perf record` + `inferno-flamegraph` recipe for identifying hot functions.
- **`--perf-trace <path>`** — opt-in per-anchor wall-clock CSV emitter for `git span drift`; CSV schema, usage constraints, and quick analysis snippets are documented there.
