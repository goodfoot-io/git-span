---
title: Running the git-span benchmarks
summary: How to compile-check, run, and interpret the git-span and static-attribution performance benchmarks — the real-corpus scoreboard, hook parser/corpus and emitted-bundle harness, warm-drift SLA, size sweep, cache controls, and profiling tools.
aliases: [git-span benchmarks, bench:check, yarn bench, size sweep, perf-baseline, real_corpus, static attribution benchmark]
---

# Running the git-span benchmarks

git-span ships three Rust benchmark surfaces under [packages/git-span/benches](../../packages/git-span/benches), plus the agent-hook static-attribution benchmark under [packages/agent-hooks/scripts](../../packages/agent-hooks/scripts). They are **standalone commands, deliberately kept out of `yarn validate`**: timed benchmarks on a shared devcontainer would flake and block unrelated work, so the validation lane carries none of them. Run them on demand or in a dedicated CI job.

The guiding invariant across every benchmark: **an optimized command must never change its output**. A faster run that diverges from a genuinely cache-disabled run is a regression, not a win — so every measured cell is guarded by a byte-identical oracle before any number is trusted.

## The commands at a glance

| Command | What it does | Timed? |
|---------|--------------|--------|
| `yarn bench:check` | Compiles every bench + the feature-gated targets (`cargo bench --no-run --locked --features bench-corpus`). The anti-rot guard. | no |
| `yarn bench` | Runs the real-corpus scoreboard ([real_corpus.rs](../../packages/git-span/benches/real_corpus.rs)) + the in-process warm/cold benches ([drift_warm.rs](../../packages/git-span/benches/drift_warm.rs), [drift_head_only.rs](../../packages/git-span/benches/drift_head_only.rs)). | yes |
| `cargo bench --bench size_sweep --features bench-corpus` | Runs the synthetic scaling sweep ([size_sweep.rs](../../packages/git-span/benches/size_sweep.rs)). Slow (up to 2000 spans). | yes |
| `cd packages/agent-hooks && yarn bench:static` | Checks the shared static-attribution corpus, times parser cells, builds the emitted Claude hooks, and times real Pre/Post hook lifecycles in small and large Git repositories. | yes |

Both scripts live in [packages/git-span/package.json](../../packages/git-span/package.json) and route through [scripts/with-target-lock.sh](../../packages/git-span/scripts/with-target-lock.sh) into the shared `build` cargo target group, so they serialize against sibling-worktree builds rather than corrupting them.

## `yarn bench:static` — parser and emitted-hook attribution

Run the deterministic harness from the agent-hooks package:

```bash
cd packages/agent-hooks
yarn bench:static --output /tmp/static-attribution.json
```

The entry point in [run-static-attribution-benchmark.js](../../packages/agent-hooks/scripts/run-static-attribution-benchmark.js) bundles [static-attribution-benchmark.ts](../../packages/agent-hooks/scripts/static-attribution-benchmark.ts) exactly as the shipped hook build does. Its parser cells import the same [static-attribution corpus](../../packages/agent-hooks/test/common/fixtures/static-attribution-corpus.ts) as Vitest. Before timing, the harness fails if resolved operations, refusal reasons, pre-state requirements, per-layer recall, or conservative range breadth differ from that corpus.

The emitted-bundle cells use the workspace `git-span` executable in real temporary repositories: 16 tracked files for the small fixture, 1,500 by default for the large fixture, plus one- and four-candidate writes and a no-intent rejection cell. Post cells include rendered dependency context. A tracked Post measurement is the complete lifecycle needed to produce it — paired Pre plan, simulated write, and Post hook — and its process counter covers both hook processes and every `git`/`git span` child. The first invocation is reported separately as natural cold (filesystem and operating-system caches are not forcibly dropped); discarded warmups and every raw measured sample remain in the JSON. Percentiles use nearest rank.

Tune the policy without editing the harness:

```bash
yarn bench:static \
  --parser-warmups 10 --parser-samples 80 \
  --bundle-warmups 3 --bundle-samples 20 \
  --large-files 1500 --output /tmp/static-attribution.json
```

Benchmark reports are evidence artifacts, while this page is the current procedure. Keep the measured boundary fixed: the full rendered tracked-post path includes its paired pre-hook, subprocesses, memo I/O, and rendering.

## `yarn bench:check` — the rot guard

The benches build their fixtures from **library symbols** (`SpanFile`, `AnchorRecord`, [sha256_hex](../../packages/git-span/src/types.rs)) rather than shelling out to CLI subcommands, so a renamed or removed symbol is a compile error. `bench:check` is what turns that into protection: it compiles all bench and `[[bin]]` targets — including the feature-gated [size_sweep.rs](../../packages/git-span/benches/size_sweep.rs) and [bench-corpus-gen](../../packages/git-span/src/bin/bench-corpus-gen.rs) via `--features bench-corpus` — without running them. Run it before relying on any bench; it is cheap and catches the silent-rot failure mode that motivated the suite.

## `yarn bench` — the real-corpus scoreboard

[real_corpus.rs](../../packages/git-span/benches/real_corpus.rs) drives the **actual `git-span` binary** (`env!("CARGO_BIN_EXE_git-span")`) over the repository's own [.span/](../../.span) corpus, so the numbers include process startup, repo discovery, and corpus parse — the real cost a developer feels. It clones the workspace into a tempdir (`git clone --local`, with a `--no-hardlinks` fallback for cross-device `/tmp`) so it never mutates the developer's real `store.db`.

Per-operation cells: `list`, `tree`, `show`, `history`, `drift-cold`, `drift-warm`, `dirty-tree-drift-cold`, `dirty-tree-drift-warm`, the interior-anchor cell, `list <glob>` variants, and `drift-fix`.

### The byte-identical correctness oracle

Before timing each cell, the oracle captures the command's stdout, stderr, and exit status twice against the same clone — once with **the one cache disabled** (`GIT_SPAN_CACHE=0`, the single "disable all caching" switch, hence the genuine ground truth) and once with the store live — and asserts all three are identical, across **all five `drift` formats** (human, porcelain, json, junit, github-actions). A divergence panics with the offending operation/format named. This is what makes the latency numbers trustworthy: a fast wrong answer fails the oracle before it is ever reported. The `dirty-tree` oracle cell additionally dirties an unrelated tracked file so the warm-dirty render is gated too.

`GIT_SPAN_CACHE=0` is the uncached ground truth. It bypasses the repository SQLite resolver store and the per-user executable-digest store, so a cache-disabled run cannot remain partly warm through another cache tier.

### Per-op budgets and the no-regression rule

Each operation has its own hard latency ceiling — never a single composite score, so a win on one command cannot mask a regression on another. Cells accumulate raw samples; a final report computes a robust **median** per op (warmup discarded), prints the full scoreboard, and evaluates every ceiling and the baseline-relative rule in one end-of-run pass (so one noisy op never aborts the rest). The no-regression rule — `median > baseline_median * 1.35 + noise_floor` — reads its baselines from [perf-baseline.json](../../packages/git-span/benches/perf-baseline.json); when that file is absent (a fresh checkout) the regression check is skipped and only ceilings + the oracle run.

### The one active store

The repository resolver cache is a SQLite database at `<common_dir>/span/store.db` (plus its `-wal` / `-shm` sidecars), owned by [resolver/store](../../packages/git-span/src/resolver/store/mod.rs). To clear it for a genuine cold run, remove `store.db*`; the benches and the [bench-span.sh](../../scripts/bench-span.sh) / [bench-span-scale.sh](../../scripts/bench-span-scale.sh) harnesses do this in their cache-clearing helpers.

**Sharing boundary.** The store lives in the Git *common* directory, so it is shared across **linked worktrees of one clone on one host** — a build in any worktree reuses generations published by its siblings. It is explicitly **not** shared cross-host or cross-clone: same-host linked-worktree sharing is a design constraint, cross-host is a stated non-goal (see `notes/architecture-and-complexity.md`, card main-157). Each clone keeps its own store.

### The cache-off switch

`GIT_SPAN_CACHE=0` is the single "disable all caching" control. Only the exact string `"0"` disables caching; any other value leaves it enabled.

### Quota, GC, and diagnostics

The store is bounded by a count-based sweep (stale non-live generations reclaimed to a 16-generation reuse buffer); maintenance runs off the hot read path: it reconciles generation liveness against the repository's active worktree HEADs (so superseded generations become evictable), evicts non-live generations cheapest-to-rebuild first, cleans orphan rows, and checkpoints/truncates the WAL. A `SQLITE_CORRUPT` or schema-incompatible database is quarantined and recreated on open. Every step is observable through the `cache-path.*` perf counters (hit class, bypass reason, publish rows/bytes/fanout/duration, corruption-recovery, liveness reconciliation, and GC bytes/generations/rows) — see [Profiling git span drift](./profiling-git-span-drift.md) for the full family. `GIT_SPAN_PERF=1` (or `--perf`) turns them on; they cost nothing when off.

### The in-process warm SLA

[drift_warm.rs](../../packages/git-span/benches/drift_warm.rs) measures `drift_spans()` **in-process** (no process spawn) and enforces the warm-clean SLA: a manual median over 30 iterations must stay under 40 ms, or the bench panics. The process-level `drift-warm` cell in `real_corpus.rs` includes startup and discovery and carries its own looser ceiling.

## `size_sweep` — scaling-cliff detection

[size_sweep.rs](../../packages/git-span/benches/size_sweep.rs) answers the question the fixed real corpus cannot: does cost stay linear as a repo grows? It generates corpora at 25 / 150 / 600 / 2000 spans in both commit-graph-present and commit-graph-absent variants, forces the cold uncached resolver (`GIT_SPAN_CACHE=0`, the single disable switch), takes a robust median per size (warmup discarded), and computes the scaling exponent `log(t_B/t_A)/log(size_B/size_A)` for each adjacent size pair. Any exponent above the significance band (1.65) panics, naming the offending pair — catching a reintroduced super-linear regression (the historical hazard being the relocation scan and reverse-walk bookkeeping in [session.rs](../../packages/git-span/src/resolver/session.rs)).

It carries `required-features = ["bench-corpus"]`, is invisible to the default build, and runs only via `cargo bench --bench size_sweep --features bench-corpus`. A full 2000-span cold sweep takes minutes — expected, not a hang.

### The deterministic corpus generator

The sweep's corpora come from [src/bench_corpus.rs](../../packages/git-span/src/bench_corpus.rs) (feature-gated behind `bench-corpus`, also exposed as the [bench-corpus-gen](../../packages/git-span/src/bin/bench-corpus-gen.rs) binary). It writes honest `rk64`-fingerprinted anchors over the exact extent each anchor declares, so a freshly generated corpus resolves Fresh, and pins all six git author/committer name/email/date env vars so a given seed and span count always reproduce the same commit SHAs.

## Relationship to the profiling tools

The benchmarks tell you *how fast* and *whether output is correct*; the profiling tools in [Profiling git span drift](./profiling-git-span-drift.md) tell you *where the time goes*. `GIT_SPAN_PERF=1` emits span/counter breakdowns (and confirms which cache path a run took — invaluable when a measurement looks wrong), and `git span drift --perf-trace <csv>` emits per-anchor wall-clock. Reach for those when a benchmark surfaces a regression and you need to localize it.
