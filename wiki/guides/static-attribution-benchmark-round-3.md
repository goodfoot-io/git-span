---
title: Static attribution benchmark — round 3 end-to-end reuse
summary: Round-3 profile, measurements, and explicit residual for repeated Git and git-span work in the complete emitted-hook lifecycle.
aliases: [static attribution benchmark round 3, git-span hook benchmark]
---

# Static attribution benchmark — round 3 end-to-end reuse

Round 3 removed two kinds of repeated work without weakening the output contract. A consumed pre-state plan now owns that logical write instead of also executing the post-state parse’s overlapping copy; eligible planned paths reuse their Pre tracked decision rather than repeating Post membership/scope queries. The Bash path also uses invocation-scoped executor memoization, and [fixOutputModified()](../../packages/agent-hooks/src/common/touch-core.ts) reads the authoritative `drift --fix` rewrite summary instead of surrounding every fix with two `git status` calls and repeated span-root config lookups. See [runLayeredBashTouches()](../../packages/agent-hooks/src/common/bash-attribution.ts), [runBashTouches()](../../packages/agent-hooks/src/common/bash-touch.ts), and [createDefaultTouchExecutors()](../../packages/agent-hooks/src/common/touch-core.ts).

## Measurement contract

The final checkpoint ran on Linux ARM64, Node v24.16.0, revision `e1e99e17cce3dc5b61edbdd688404d6b9e74db7a`, with the same policy as rounds 1–2: parser cold + 5 discarded + 40 measured; emitted bundle cold + 2 discarded + 8 measured; nearest-rank percentiles; 16/1,500 tracked-file repositories. One-shot Node startup, the paired Pre plan for tracked Post cells, all repository and CLI subprocesses, memo I/O, and final rendering are included. The corrected harness counts the same lifecycle it times: two hook processes for tracked Post, one otherwise.

## Parser-only results

Every value is milliseconds, round 2 → round 3.

| Cell | Cold | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Fast rejection | 0.033 → 0.036 | 0.001 → 0.001 | 0.002 → 0.002 | 0.004 → 0.004 |
| Deterministic shell | 0.980 → 0.297 | 0.056 → 0.036 | 0.419 → 0.345 | 6.776 → 1.562 |
| Literal loop, 2 candidates | 0.387 → 0.149 | 0.026 → 0.028 | 0.069 → 0.040 | 0.099 → 1.298 |
| sed pattern, small file | 0.082 → 0.361 | 0.021 → 0.021 | 0.049 → 0.023 | 0.533 → 1.054 |
| Perl zero-pi | 0.584 → 1.361 | 0.021 → 0.021 | 0.985 → 1.892 | 5.402 → 4.536 |
| Python | 0.191 → 0.120 | 0.032 → 0.033 | 1.165 → 0.074 | 2.123 → 1.509 |
| Node | 1.866 → 1.860 | 0.031 → 0.025 | 0.613 → 0.082 | 2.432 → 0.652 |
| sed pattern, 20,000-line file | 19.121 → 14.619 | 6.100 → 3.851 | 13.833 → 6.418 | 17.984 → 6.551 |
| Compound, 4 candidates | 0.603 → 0.382 | 0.073 → 0.056 | 3.138 → 0.831 | 6.517 → 1.457 |

## Real emitted-bundle results

Every latency is milliseconds, round 2 → round 3. “Git” counts the complete paired lifecycle for tracked Post.

| Cell | Cold | p50 | p95 | p99 | Git |
|---|---:|---:|---:|---:|---:|
| Pre, small, rejection | 75.070 → 41.217 | 54.958 → 44.129 | 120.114 → 66.016 | 120.114 → 66.016 | 0 → 0 |
| Pre, small, 1 pattern | 80.666 → 72.105 | 79.183 → 80.514 | 149.084 → 118.097 | 149.084 → 118.097 | 3 → 3 |
| Pre, large, 1 pattern | 58.979 → 59.329 | 91.360 → 104.973 | 117.382 → 220.627 | 117.382 → 220.627 | 3 → 3 |
| Pre, large, 4 candidates | 80.809 → 84.879 | 74.210 → 77.246 | 138.148 → 106.408 | 138.148 → 106.408 | 3 → 3 |
| Post, small, rejection | 70.625 → 70.123 | 60.200 → 54.494 | 81.266 → 66.819 | 81.266 → 66.819 | 0 → 0 |
| Post lifecycle, small, 1 pattern | 530.744 → 207.585 | 465.177 → 238.212 | 529.710 → 363.532 | 529.710 → 363.532 | 24 → 7 |
| Post lifecycle, large, 1 pattern | 721.175 → 350.339 | 655.188 → 244.470 | 827.366 → 305.376 | 827.366 → 305.376 | 24 → 7 |
| Post lifecycle, large, 4 candidates | 1634.708 → 626.994 | 2057.740 → 600.809 | 2520.791 → 975.754 | 2520.791 → 975.754 | 78 → 19 |

One-pattern full-lifecycle Git children fell from 24 to 7; four-candidate children fell from 78 to 19. Large one-pattern p50 improved 62.7%, and large four-candidate p50 improved 70.8%. The small one-pattern p50 improved 48.8%.

## The 100 ms result and residual

The complete target was **not met**, and the timing boundary was not changed after measurement. Parser cells are comfortably below 100 ms, and no-intent emitted Pre/Post p99 is 66.016/66.819 ms. Tracked Pre is not consistently below 100 ms in this noisy shared environment (the final large one-pattern p50/p95/p99 was 104.973/220.627/220.627 ms). Rendered tracked Post remains materially above 100 ms: the one-pattern p50 is 238–244 ms and the four-candidate p50 is 601 ms.

The exact remaining one-pattern lifecycle is three batched Pre children — `git config git-span.dir`, one `git check-ignore -z --stdin`, and one `git ls-files -z --cached -- <all candidates>` — followed by four Post `git span` children for each unique touched path:

1. `git span drift <path> --fix` heals positional drift.
2. `git span list --porcelain <path>` returns complete declared span names and anchor ranges.
3. `git span drift --format porcelain <path>` returns live semantic drift statuses.
4. `git span why <name>` returns the rationale included in rendered context.

These are not interchangeable today. In particular, [list porcelain](../../packages/git-span/src/cli/show.rs) emits only name/path/range declarations and deliberately omits why; it does not resolve drift. [tree](../../packages/git-span/src/cli/tree.rs) renders a path co-occurrence graph in human/JSON form, with no span names, ranges, why text, or drift statuses, and would broaden the hook from exact overlapping spans to transitive graph neighbors. Replacing the four calls with `tree` would change recall/breadth and rendering semantics. Reaching a reliable sub-100-ms rendered path safely therefore needs a combined structured CLI operation or direct library integration that returns fix outcome, complete declarations, live statuses, and why text from one corpus/resolver pass.

## Correctness and validation

The final shared-corpus score remains 22/22: total recall 1.000, every layer recall 1.000, and attributed/expected range breadth 1.000. The real bundle cells assert every expected span name in final rendered output. Package lint, typecheck, focused touch/Bash/corpus tests, installed emitted-hook smoke, the full package test suite, and root validation passed after the round; the benchmark itself remains intentionally outside `yarn validate` because wall-clock gates are unsuitable for a shared runner.
