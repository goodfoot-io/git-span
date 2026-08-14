---
title: Static attribution benchmark — round 1 lexical dispatch
summary: Round-1 profile and measurements for lexical fast rejection in the agent-hook static-attribution pipeline.
aliases: [static attribution benchmark round 1, lexical dispatch benchmark]
---

# Static attribution benchmark — round 1 lexical dispatch

Round 1 made no-intent commands stop before the full shell grammar and gated the Python and Node recognizers behind their executable words. The optimization is in [canCarryStaticIntent()](../../packages/agent-hooks/src/common/static-attribution.ts) and the layered dispatch in [parseCommandLayered()](../../packages/agent-hooks/src/common/static-attribution.ts). It preserves explicit history/generator refusals and the corpus oracle.

## Measurement contract

Both checkpoints ran on Linux ARM64, Node v24.16.0, revision `e1e99e17cce3dc5b61edbdd688404d6b9e74db7a`, with sequential working-tree checkpoints. Parser policy: first natural cold sample, 5 discarded warmups, 40 measured samples. Bundle policy: first natural cold sample, 2 discarded warmups, 8 measured samples. Percentiles are nearest rank; with eight bundle samples p95 and p99 are both the maximum. Bundles were built before cells and build time was excluded, while one-shot Node startup, Git work, and Post rendering were included. Repositories contained 16 and 1,500 tracked files.

Tracked Post timings include their required paired Pre plan and simulated write. The first version of the process counter wrapped only the selected hook, not that paired Pre; the Git counts below correct that historical accounting by adding the corresponding measured Pre count. Tracked Post uses two hook processes; every other bundle cell uses one.

## Parser-only results

Every value is milliseconds, baseline → round 1.

| Cell | Cold | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Fast rejection | 0.899 → 0.037 | 0.039 → 0.001 | 0.749 → 0.006 | 4.212 → 0.009 |
| Deterministic shell | 0.331 → 0.213 | 0.052 → 0.082 | 0.454 → 1.740 | 4.762 → 3.568 |
| Literal loop, 2 candidates | 0.175 → 0.441 | 0.030 → 0.028 | 1.073 → 0.255 | 1.637 → 1.300 |
| sed pattern, small file | 0.111 → 0.409 | 0.020 → 0.035 | 0.034 → 0.042 | 0.164 → 0.572 |
| Perl zero-pi | 1.636 → 0.424 | 0.023 → 0.036 | 1.474 → 0.082 | 4.686 → 1.811 |
| Python | 0.254 → 0.190 | 0.027 → 0.044 | 1.545 → 0.071 | 1.926 → 0.797 |
| Node | 2.624 → 3.384 | 0.034 → 0.030 | 2.305 → 0.909 | 2.425 → 2.948 |
| sed pattern, 20,000-line file | 27.533 → 15.409 | 7.925 → 5.996 | 17.185 → 25.700 | 23.244 → 33.865 |
| Compound, 4 candidates | 0.288 → 1.362 | 0.075 → 0.064 | 3.173 → 3.091 | 10.610 → 8.234 |

The profile-supported win is narrow and strong: the fast-rejection p50 fell 97.4%, with p95/p99 falling from 0.749/4.212 ms to 0.006/0.009 ms. Small sub-millisecond cells show scheduler and garbage-collection noise in their tails; no broader claim is based on those movements.

## Real emitted-bundle results

Every latency is milliseconds, baseline → round 1. “Git” is the corrected complete-lifecycle subprocess count.

| Cell | Cold | p50 | p95 | p99 | Git |
|---|---:|---:|---:|---:|---:|
| Pre, small, rejection | 72.791 → 75.426 | 114.242 → 74.998 | 152.848 → 109.768 | 152.848 → 109.768 | 3 → 3 |
| Pre, small, 1 pattern | 213.015 → 214.326 | 119.165 → 110.978 | 214.544 → 154.902 | 214.544 → 154.902 | 7 → 7 |
| Pre, large, 1 pattern | 99.446 → 93.977 | 130.522 → 128.820 | 233.525 → 183.731 | 233.525 → 183.731 | 7 → 7 |
| Pre, large, 4 candidates | 342.764 → 214.181 | 229.388 → 168.879 | 280.504 → 230.437 | 280.504 → 230.437 | 13 → 13 |
| Post, small, rejection | 119.273 → 70.737 | 101.514 → 85.530 | 129.653 → 123.077 | 129.653 → 123.077 | 2 → 2 |
| Post lifecycle, small, 1 pattern | 808.274 → 563.185 | 703.679 → 634.131 | 820.590 → 740.197 | 820.590 → 740.197 | 42 → 42 |
| Post lifecycle, large, 1 pattern | 1695.256 → 811.770 | 969.881 → 867.536 | 2058.224 → 1979.699 | 2058.224 → 1979.699 | 42 → 42 |
| Post lifecycle, large, 4 candidates | 4360.050 → 7915.201 | 2943.399 → 2674.214 | 3568.375 → 4021.649 | 3568.375 → 4021.649 | 138 → 138 |

The built-bundle profile showed the next bottleneck clearly: lexical work was no longer material beside repeated repository, ignore, tracked-membership, and rendering subprocesses. Round 1 therefore did not meet the sub-100-ms full-hook objective.

## Correctness and checkpoint validation

The shared corpus passed all 22 cases: recall was 1.000 overall and in every layer (shell, literal loop, pattern substitution, Python, Node); attributed/expected range breadth was 1.000. Package lint, typecheck, the full agent-hooks test suite, the corpus tests, and the installed emitted-hook portability smoke all passed at this checkpoint.

Continue with [round 2](./static-attribution-benchmark-round-2.md).
