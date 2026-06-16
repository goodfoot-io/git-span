---
title: Running the git-mesh benchmarks
summary: How to compile-check, run, and interpret the git-mesh performance benchmarks — the real-corpus scoreboard with its byte-identical correctness oracle, the in-process warm-stale SLA gate, the synthetic size-sweep and its deterministic corpus generator, the GIT_MESH_CACHE_V2 cache-off switch, and the perf-baseline.json no-regression rule — plus how they relate to the GIT_MESH_PERF profiling tools.
aliases: [git-mesh benchmarks, bench:check, yarn bench, size sweep, perf-baseline, real_corpus]
---

# Running the git-mesh benchmarks

git-mesh ships three benchmark surfaces, all under [packages/git-mesh/benches](../../packages/git-mesh/benches), plus a deterministic corpus generator. They are **standalone commands, deliberately kept out of `yarn validate`**: timed benchmarks on a shared devcontainer would flake and block unrelated work, so the validation lane carries none of them. Run them on demand or in a dedicated CI job.

The guiding invariant across every benchmark: **an optimized command must never change its output**. A faster run that diverges from a genuinely cache-disabled run is a regression, not a win — so every measured cell is guarded by a byte-identical oracle before any number is trusted.

## The commands at a glance

| Command | What it does | Timed? |
|---------|--------------|--------|
| `yarn bench:check` | Compiles every bench + the feature-gated targets (`cargo bench --no-run --locked --features bench-corpus`). The anti-rot guard. | no |
| `yarn bench` | Runs the real-corpus scoreboard ([real_corpus.rs](../../packages/git-mesh/benches/real_corpus.rs)) + the in-process warm/cold benches ([stale_warm.rs](../../packages/git-mesh/benches/stale_warm.rs), [stale_head_only.rs](../../packages/git-mesh/benches/stale_head_only.rs)). | yes |
| `cargo bench --bench size_sweep --features bench-corpus` | Runs the synthetic scaling sweep ([size_sweep.rs](../../packages/git-mesh/benches/size_sweep.rs)). Slow (up to 2000 meshes). | yes |

Both scripts live in [packages/git-mesh/package.json](../../packages/git-mesh/package.json) and route through [scripts/with-target-lock.sh](../../packages/git-mesh/scripts/with-target-lock.sh) into the shared `build` cargo target group, so they serialize against sibling-worktree builds rather than corrupting them.

## `yarn bench:check` — the rot guard

The benches build their fixtures from **library symbols** (`MeshFile`, `AnchorRecord`, [sha256_hex](../../packages/git-mesh/src/types.rs)) rather than shelling out to CLI subcommands, so a renamed or removed symbol is a compile error. `bench:check` is what turns that into protection: it compiles all bench and `[[bin]]` targets — including the feature-gated [size_sweep.rs](../../packages/git-mesh/benches/size_sweep.rs) and [bench-corpus-gen](../../packages/git-mesh/src/bin/bench-corpus-gen.rs) via `--features bench-corpus` — without running them. Run it before relying on any bench; it is cheap and catches the silent-rot failure mode that motivated the suite.

## `yarn bench` — the real-corpus scoreboard

[real_corpus.rs](../../packages/git-mesh/benches/real_corpus.rs) drives the **actual `git-mesh` binary** (`env!("CARGO_BIN_EXE_git-mesh")`) over the repository's own [.mesh/](../../.mesh) corpus, so the numbers include process startup, repo discovery, and corpus parse — the real cost a developer feels. It clones the workspace into a tempdir (`git clone --local`, with a `--no-hardlinks` fallback for cross-device `/tmp`) so it never mutates the developer's real `stale-cache.db`.

Per-operation cells: `list`, `tree`, `show`, `history`, `stale-cold`, `stale-warm`, and a `dirty-tree-stale-cold` cell.

### The byte-identical correctness oracle

Before timing each cell, the oracle captures the command's stdout twice against the same clone — once with the cache disabled (`GIT_MESH_CACHE_V2=0`, the genuine ground truth) and once with the cache live — and asserts the two byte streams are identical, across **all five `stale` formats** (human, porcelain, json, junit, github-actions). A divergence panics with the offending operation/format named. This is what makes the latency numbers trustworthy: a fast wrong answer fails the oracle before it is ever reported. The `dirty-tree` oracle cell additionally dirties an unrelated tracked file so the warm-dirty render is gated too.

### Per-op budgets and the no-regression rule

Each operation has its own hard latency ceiling — never a single composite score, so a win on one command cannot mask a regression on another. Cells accumulate raw samples; a final report computes a robust **median** per op (warmup discarded), prints the full scoreboard, and evaluates every ceiling and the baseline-relative rule in one end-of-run pass (so one noisy op never aborts the rest). The no-regression rule — `median > baseline_median * 1.35 + noise_floor` — reads its baselines from [perf-baseline.json](../../packages/git-mesh/benches/perf-baseline.json); when that file is absent (a fresh checkout) the regression check is skipped and only ceilings + the oracle run.

### The cache-off switch

`GIT_MESH_CACHE_V2=0` disables the cross-invocation SQLite stale cache ([cache_v2](../../packages/git-mesh/src/resolver/cache_v2/mod.rs)) — distinct from `GIT_MESH_CACHE=0`, which only disables the within-run L1/L2 content cache. Only the exact string `"0"` disables it; anything else leaves the cache on (fail-closed). It is the mechanism the oracle relies on to produce a ground-truth run.

### The in-process warm SLA

[stale_warm.rs](../../packages/git-mesh/benches/stale_warm.rs) measures `stale_meshes()` **in-process** (no process spawn) and enforces the historical warm-clean SLA: a manual median over 30 iterations must stay under 40 ms, or the bench panics. This is the apples-to-apples home for the 40 ms figure — the process-level `stale-warm` cell in `real_corpus.rs` is necessarily higher (it includes ~17 ms startup + ~12 ms discovery) and carries its own, looser, process-level ceiling.

## `size_sweep` — scaling-cliff detection

[size_sweep.rs](../../packages/git-mesh/benches/size_sweep.rs) answers the question the fixed real corpus cannot: does cost stay linear as a repo grows? It generates corpora at 25 / 150 / 600 / 2000 meshes in both commit-graph-present and commit-graph-absent variants, forces the cold uncached resolver (`GIT_MESH_CACHE_V2=0` and `GIT_MESH_CACHE=0`), takes a robust median per size (warmup discarded), and computes the scaling exponent `log(t_B/t_A)/log(size_B/size_A)` for each adjacent size pair. Any exponent above the significance band (1.65) panics, naming the offending pair — catching a reintroduced super-linear regression (the historical hazard being the relocation scan and reverse-walk bookkeeping in [session.rs](../../packages/git-mesh/src/resolver/session.rs)).

It carries `required-features = ["bench-corpus"]`, is invisible to the default build, and runs only via `cargo bench --bench size_sweep --features bench-corpus`. A full 2000-mesh cold sweep takes minutes — expected, not a hang.

### The deterministic corpus generator

The sweep's corpora come from [src/bench_corpus.rs](../../packages/git-mesh/src/bench_corpus.rs) (feature-gated behind `bench-corpus`, also exposed as the [bench-corpus-gen](../../packages/git-mesh/src/bin/bench-corpus-gen.rs) binary). It writes honest `rk64`-fingerprinted anchors over the exact extent each anchor declares, so a freshly generated corpus resolves Fresh, and pins all six git author/committer name/email/date env vars so a given seed and mesh count always reproduce the same commit SHAs.

## Relationship to the profiling tools

The benchmarks tell you *how fast* and *whether output is correct*; the profiling tools in [packages/git-mesh/docs/profiling.md](../../packages/git-mesh/docs/profiling.md) tell you *where the time goes*. `GIT_MESH_PERF=1` emits span/counter breakdowns (and confirms which cache path a run took — invaluable when a measurement looks wrong), and `git mesh stale --perf-trace <csv>` emits per-anchor wall-clock. Reach for those when a benchmark surfaces a regression and you need to localize it.
