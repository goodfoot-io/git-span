---
title: Static attribution benchmark — round 2 repository filtering
summary: Round-2 profile and measurements for batched tracked and ignored-path filtering in the agent-hook static-attribution pipeline.
aliases: [static attribution benchmark round 2, tracked filtering benchmark]
---

# Static attribution benchmark — round 2 repository filtering

Round 2 replaced per-candidate repository and ignore probes with an in-process parent walk for ordinary worktrees, one NUL-delimited `check-ignore --stdin`, and exactly one NUL-delimited `ls-files --cached` membership query for the whole candidate set. The implementation is in [resolveRepoRoot()](../../packages/agent-hooks/src/common/agent-hooks-common.ts), [queryIgnoredFiles()](../../packages/agent-hooks/src/common/static-attribution.ts), and [filterTrackedEligibility()](../../packages/agent-hooks/src/common/static-attribution.ts).

## Measurement contract

The environment and policy match [round 1](./static-attribution-benchmark-round-1.md): Linux ARM64, Node v24.16.0, the same revision and sequential patch checkpoints; parser cold + 5 discarded + 40 measured; bundle cold + 2 discarded + 8 measured; nearest-rank percentiles; 16/1,500 tracked-file repositories; Post rendering and paired Pre included. Historical Post Git counts below are corrected complete-lifecycle totals as described in round 1.

## Profile finding and subprocess invariant

Before round 2, one tracked candidate launched seven Pre Git children: two repository-root queries from the CWD path, one from the candidate directory, one span-root config lookup, two identical per-path ignore checks, and one batched `ls-files`. Four candidates launched thirteen because the two ignore checks repeated for every path. The no-intent Pre path still launched three discovery/config children.

After round 2, rejection launches zero Git children. Any non-empty same-repository candidate set launches three, independent of candidate count: one span-root config read, one batch ignore query, and one batch tracked-membership query. The membership-specific diagnostics counter remains exactly one; the benchmark records all three children.

## Parser-only results

Every value is milliseconds, round 1 → round 2. This round did not target parsing; the table guards against collateral regression.

| Cell | Cold | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Fast rejection | 0.037 → 0.033 | 0.001 → 0.001 | 0.006 → 0.002 | 0.009 → 0.004 |
| Deterministic shell | 0.213 → 0.980 | 0.082 → 0.056 | 1.740 → 0.419 | 3.568 → 6.776 |
| Literal loop, 2 candidates | 0.441 → 0.387 | 0.028 → 0.026 | 0.255 → 0.069 | 1.300 → 0.099 |
| sed pattern, small file | 0.409 → 0.082 | 0.035 → 0.021 | 0.042 → 0.049 | 0.572 → 0.533 |
| Perl zero-pi | 0.424 → 0.584 | 0.036 → 0.021 | 0.082 → 0.985 | 1.811 → 5.402 |
| Python | 0.190 → 0.191 | 0.044 → 0.032 | 0.071 → 1.165 | 0.797 → 2.123 |
| Node | 3.384 → 1.866 | 0.030 → 0.031 | 0.909 → 0.613 | 2.948 → 2.432 |
| sed pattern, 20,000-line file | 15.409 → 19.121 | 5.996 → 6.100 | 25.700 → 13.833 | 33.865 → 17.984 |
| Compound, 4 candidates | 1.362 → 0.603 | 0.064 → 0.073 | 3.091 → 3.138 | 8.234 → 6.517 |

## Real emitted-bundle results

Every latency is milliseconds, round 1 → round 2. “Git” is the complete-lifecycle subprocess count.

| Cell | Cold | p50 | p95 | p99 | Git |
|---|---:|---:|---:|---:|---:|
| Pre, small, rejection | 75.426 → 75.070 | 74.998 → 54.958 | 109.768 → 120.114 | 109.768 → 120.114 | 3 → 0 |
| Pre, small, 1 pattern | 214.326 → 80.666 | 110.978 → 79.183 | 154.902 → 149.084 | 154.902 → 149.084 | 7 → 3 |
| Pre, large, 1 pattern | 93.977 → 58.979 | 128.820 → 91.360 | 183.731 → 117.382 | 183.731 → 117.382 | 7 → 3 |
| Pre, large, 4 candidates | 214.181 → 80.809 | 168.879 → 74.210 | 230.437 → 138.148 | 230.437 → 138.148 | 13 → 3 |
| Post, small, rejection | 70.737 → 70.625 | 85.530 → 60.200 | 123.077 → 81.266 | 123.077 → 81.266 | 2 → 0 |
| Post lifecycle, small, 1 pattern | 563.185 → 530.744 | 634.131 → 465.177 | 740.197 → 529.710 | 740.197 → 529.710 | 42 → 24 |
| Post lifecycle, large, 1 pattern | 811.770 → 721.175 | 867.536 → 655.188 | 1979.699 → 827.366 | 1979.699 → 827.366 | 42 → 24 |
| Post lifecycle, large, 4 candidates | 7915.201 → 1634.708 | 2674.214 → 2057.740 | 4021.649 → 2520.791 | 4021.649 → 2520.791 | 138 → 78 |

The multi-candidate Pre p50 improved 56.1% and became candidate-count independent at the Git boundary. The full rendered Post path remained dominated by repeated `git span` work, which became round 3’s profile target.

## Correctness and checkpoint validation

The shared corpus again passed 22/22 with total and per-layer recall 1.000 and range breadth 1.000. Package lint, typecheck, the focused Bash attribution/write suite, the corpus suite, and the installed emitted-hook portability smoke passed at this checkpoint.

Continue with [round 3](./static-attribution-benchmark-round-3.md).
