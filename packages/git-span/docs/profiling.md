# Profiling `git span stale`

Three complementary tools cover the common perf questions:

1. **`perf record` + `inferno-flamegraph`** — self-time profile. "Which functions are hot?"
2. **`git span stale --perf-trace <path>`** — per-anchor wall-clock distribution. "Is the runtime uniform across many anchors, or concentrated in a few?"
3. **`--perf` / `GIT_SPAN_PERF=1` cache-path counters** — "which cache path did this run take, and why?" See [Cache-path counters](#cache-path-counters-perf--git_span_perf1) below.

Both `perf` and `inferno` are pre-installed in the devcontainer image
([`./.devcontainer/Dockerfile`](./.devcontainer/Dockerfile)) — no `apt install` or
`cargo install` step is needed on a fresh rebuild.

## Flame graph capture

```bash
perf record -F 199 -g --call-graph=dwarf \
    -o /tmp/stale.perf \
    -- git span stale --perf
perf script -i /tmp/stale.perf 2>/dev/null \
    | inferno-collapse-perf \
    | inferno-flamegraph > /tmp/stale.svg
```

`-F 199` samples at 199 Hz (prime, to avoid lock-step with periodic events). `--call-graph=dwarf` walks DWARF unwind info so Rust frames resolve cleanly without frame-pointer instrumentation.

### `perf_event_paranoid` fallback

Some host kernels lock `perf` event capture to root. If `perf record` reports `Permission denied` or `Access to performance monitoring and observability operations is limited`, lower the paranoia level from the container:

```bash
sudo sysctl kernel.perf_event_paranoid=1
```

The devcontainer image does not set this at startup — many hardened hosts reject the sysctl, and a failing image bootstrap is worse than a documented one-line fix.

## Per-anchor wall-clock trace (`--perf-trace`)

```bash
git span stale --perf-trace /tmp/trace.csv
```

Writes one CSV row per resolved anchor to `/tmp/trace.csv`. The flag is opt-in; without it, no per-anchor instrumentation runs.

### CSV schema

| Column | Type | Description |
|--------|------|-------------|
| `span` | string | Span name (e.g. `wiki/architecture/refs`) |
| `anchor_id` | string | Anchor identifier within the span |
| `anchor_sha` | hex | Commit SHA the anchor is pinned to |
| `path` | string | File path the anchor references |
| `wall_us` | u128 | Wall-clock microseconds spent in [`resolve_anchor_inner`](../src/resolver/engine/anchor.rs) |
| `fast_path` | bool | `true` if the anchor returned via [`clean_head_fast_path`](../src/resolver/engine/anchor.rs) |
| `status` | enum | One of `Fresh`, `Moved`, `Changed`, `Orphaned`, `MergeConflict`, `Submodule`, `ContentUnavailable` |

Values containing `,`, `"`, newline (`\n`), or carriage return (`\r`) are RFC-4180-escaped (wrapped in `"`, internal `"` doubled).

**Column order is a stable interface.** External tooling that consumes the CSV may pin to it; changes go through a deprecation cycle.

### Usage constraints

`--perf-trace` requires a full scan and rejects positional paths — partial scans defeat the "where did the time go?" question the flag exists to answer:

```bash
git span stale --perf-trace /tmp/trace.csv          # OK: full scan
git span stale --perf-trace /tmp/trace.csv some/path  # CliError
```

The only other flag conflict `git span stale` enforces is unrelated to `--perf-trace`: `--fix` requires `--format human` and errors on any other format.

### Quick analyses

```bash
# Top 10 slowest anchors
awk -F, 'NR>1 {print $5"\t"$2"\t"$4}' /tmp/trace.csv | sort -rn | head

# Mean wall-clock, count
awk -F, 'NR>1 {sum += $5; count++} END {print sum/count " us avg, " count " anchors"}' /tmp/trace.csv

# Fast-path vs full-resolution split
awk -F, 'NR>1 {print $6}' /tmp/trace.csv | sort | uniq -c

# Anchors > 50 ms
awk -F, 'NR>1 && $5 > 50000 {print $5"\t"$1"\t"$2}' /tmp/trace.csv | sort -rn
```

## Why two tools

`perf` samples at 199 Hz; many anchors complete in well under 5 ms and fall below the sample resolution, so flame graphs answer "which functions are hot" but not "which anchors are slow." The CSV emitter measures the bounded interval (function entry to return) and is the right tool for per-anchor distribution analysis. The two are complementary — use both when triaging a regression.

## Trace overhead

When `--perf-trace` is absent, the resolver does not capture per-anchor traces; the session's trace buffer stays `None` and the per-anchor loop pays a single `Option::is_some()` check per iteration. When the flag is set, each anchor adds one `Instant::now()` (already captured for the existing `per_anchor_us` summary), a snapshot of the fast-path counter, and a `Vec::push` of ~80 bytes — well under 1 ms total on a 2,600-anchor workspace.

## Cache-path counters (`--perf` / `GIT_SPAN_PERF=1`)

**`--perf-trace` intentionally forces full resolution** for its per-anchor wall-clock profiling — bypassing every cache tier is what lets it attribute time to `resolve_anchor_inner` uniformly. It stays that way; it answers "where does resolver time go on a full scan," not "which cache path did this run take."

The cache-path counters below are a SEPARATE, additive mechanism that does **not** force full resolution — they observe whichever path a normal (uncached-flag) invocation actually takes, on top of the existing `--perf` diagnostics (`GIT_SPAN_PERF=1` or the `--perf` flag; see [`src/perf.rs`](../src/perf.rs)):

```bash
GIT_SPAN_PERF=1 git span stale --no-exit-code 2>&1 >/dev/null | grep 'cache-path\.'
```

These counters are THE cache diagnostics surface. There is one cache — the
SQLite store (`<git_dir>/span/store.db`, see [`resolver/store`](../src/resolver/store/mod.rs)) —
and the `cache-path.*` family reports everything it does: which path a run
took, why it bypassed, what it published, and what the bounded quota reclaimed.
The Phase 7 cutover deleted both legacy caches (`resolver/cache`,
`resolver/cache_v2`) and their `cache.l1-*` / `cache.l2-*` counter families;
nothing contrasts against this surface anymore.

Every line is emitted via the same [`crate::perf::note`](../src/perf.rs) /
[`crate::perf::counter`](../src/perf.rs) calls every other `--perf` diagnostic
uses — plain, gated output — so they cost nothing when `--perf`/`GIT_SPAN_PERF=1`
is off. `note` lines are free-form text; `counter` lines carry an integer value.

**Routing — which path served the run** (exactly one `hit-class` per run):

| Line | Meaning |
|------|---------|
| `cache-path.hit-class: exact` | The committed cache key resolved and the working tree was clean; the compact summary was decoded and projected in memory (the warm-clean exact hit). |
| `cache-path.hit-class: exact-memo` | An exact hit served from the bounded in-process memo (a repeat within the same process), before any store read. |
| `cache-path.hit-class: incremental` | No exact generation, but a cached ancestor generation was found; only the changed span blobs/affected definitions were re-resolved and the rest reused. |
| `cache-path.hit-class: dirty` | The committed key resolved but the working tree carried dirty paths; unaffected spans were rendered from the committed baseline and only the affected set was resolved. |
| `cache-path.hit-class: miss` | The store did not serve this run (ineligible options, store-open failure, a torn-read revalidation, or a genuine cold/invalidated key); the uncached resolver ran instead. |
| `cache-path.bypass-reason: <reason>` | Emitted alongside a miss/bypass, naming why the store did not serve — e.g. `capture-token: <err>`, `uncommitted-span-files`, `store-open: <err>`, `summary-decode`, `rejected-<reason>`, `revalidate-torn-read`, `dirty-no-baseline`, `dirty-no-reuse`, `incremental-no-ancestor`, `incremental-no-reuse`. |

`GIT_SPAN_CACHE=0` is reported as an ordinary bypass: the entry point returns before touching the store, so a disabled run simply shows no `cache-path.*` routing beyond its bypass.

**Cold miss and publish** (a miss that resolves and stores a new generation):

| Line | Meaning |
|------|---------|
| `cache-path.cold-miss-builds` | Resolver builds this run performed (exactly `1` for a well-behaved cold miss — the single-pass guarantee). |
| `cache-path.state-observe-us` | Microseconds spent capturing the external state token (`.git/index`, worktree paths, committed `.span` sidecars) that keys the read. |
| `cache-path.revalidate-discarded` (+ `: <field>`) | The snapshot moved mid-build on a non-HEAD field, so the single-pass core was discarded as a possible torn read. |
| `cache-path.publish-rows` | Reuse rows written in the publish transaction. |
| `cache-path.publish-summary-bytes` | Byte size of the compact render-ready summary persisted. |
| `cache-path.publish-dependency-fanout` | Distinct dependency identities the generation records. |
| `cache-path.publish-us` | Microseconds spent in the publish transaction. |
| `cache-path.publish-ok` / `cache-path.publish-failed` (+ `: <err>`) | Publish outcome. A failure fails closed on the *cache*, never the command — the already-computed result still renders. |
| `cache-path.publish-skipped: ineligible` | The token was persistence-ineligible (e.g. an incomplete filter dependency identity), so nothing was stored. |

`cache-path.state-observe-us` is split further into opt-in
`cache.capture.<phase>` wall-clock spans. The phases are `committed`,
`uncommitted`, `index-load`, `head`, `source-tree`, `span-subtree`,
`replace-refs`, `filters`, `attributes`, `normalization`, `index-identity`,
`staged-state`, `worktree-state`, and `availability`. Their sum is slightly
smaller than `state-observe-us` because token assembly and relevant-path set
construction remain in the parent measurement. These spans make a slow state
proof attributable without requiring kernel sampling access.

**Incremental / dirty reuse counts** (work proportional to what changed):

| Line | Meaning |
|------|---------|
| `cache-path.incremental-anchor-resolutions` / `cache-path.incremental-reused-spans` / `cache-path.incremental-resolved-spans` | Anchors re-resolved, spans reused unchanged, and spans rebuilt on the incremental ancestor-reuse path. |
| `cache-path.dirty-anchor-resolutions` / `cache-path.dirty-reused-spans` / `cache-path.dirty-resolved-spans` | The same three counts on the dirty affected-set path. |

**Integrity, corruption recovery, and bounded lifecycle** (emitted when a maintenance pass runs — only above the quota high-water mark, off the hot read path):

| Line | Meaning |
|------|---------|
| `cache-path.corruption-recovered: <reason>` | The store quarantined and recreated an incompatible-schema or `SQLITE_CORRUPT` database on open; a silent recovery made reportable. |
| `cache-path.reconcile-demoted` | Superseded generations demoted from `live` after reconciling against the repository's active worktree HEADs, making them evictable. |
| `cache-path.reconcile-skipped: live-heads: <err>` / `cache-path.reconcile-failed: <err>` | Liveness reconciliation could not run in full (fail closed: nothing is demoted, correctness preserved). |
| `cache-path.store-cap-bytes` | The configured byte ceiling (default 256 MiB; overridable via `GIT_SPAN_STORE_MAX_BYTES` or `git config git-span.storeMaxBytes`). |
| `cache-path.gc-bytes-before` / `cache-path.gc-bytes-after` | Store size on disk before and after the bounded eviction + WAL truncate. |
| `cache-path.gc-generations-removed` / `cache-path.gc-rows-removed` | Non-live generations and rows the quota pass evicted. |
| `cache-path.gc-corruption-recovered: true` | A corruption recovery folded into this maintenance pass. |
| `cache-path.maintain-skipped: size: <err>` / `cache-path.maintain-failed: <err>` | The maintenance pass could not size or complete (the command still succeeds). |
