# git-mesh user-perceived latency: optimization findings (2026-06)

A seven-iteration optimization pass targeting user-perceived latency on common
operations, with a focus on `git mesh stale --fix` and `git mesh list <glob>`.
Each iteration: establish/extend the measurement surface, attribute the cost,
implement (verify byte-identical + validate), commit. Wins were committed only
when verified; unverifiable changes were reverted.

## The measurement insight that shaped everything

The benchmark harness clones into `/tmp` (**overlayfs**, fast), but the real
checkout is on **fuse/virtiofs** (slow per-syscall). The same `list` is ~12 ms
on `/tmp` and ~70-126 ms on the real workspace; cold `stale` is ~180 ms on
`/tmp` vs ~550-1700 ms on fuse. **User-perceived latency lives on fuse, where
cost is dominated by per-file/per-object I/O round-trips, not CPU.** Two tools
made wins provable despite a noisy shared host:

- `list.layer-reads` and `mesh.load-all-corpus` counts — **deterministic**,
  filesystem- and noise-independent proxies for I/O work.
- A `startup` cell (`git mesh --version`, ~5.6 ms pure spawn) isolating fixed
  process overhead so work can be read as `median − startup`.

## What worked, and what didn't

| # | Change | Result | Committed? |
|---|--------|--------|-----------|
| 2 | Parallelize the corpus **parse** loop (`std::thread::scope`, per-thread `repo.clone()`) | parse 11.7→3.3 ms (3.5×) | yes |
| 3 | `stale --fix`: build source layers once, reuse in the post-fix re-resolve | post-resolve −41% | yes |
| 4 | `stale`: load the `.mesh` corpus once per state (was 4-6×) | loads 4→2 / 6→3; corpus-handling 25-32→3 ms (fuse) | yes |
| 6 | `history`: per-path blob-OID compare instead of per-commit full-tree diff | 867→302 ms fuse (2.87×); 175→42 ms local | yes |
| — | Parallelize the **discover** phase | break-even warm, cold unverifiable | reverted |
| — | Parallelize the **cold resolve** | byte-identical but **regressed** on fuse | reverted |
| — | Reduce repo-open / `gix::discover` | already minimal (~4 ms, opened once) | no change |

### The governing lesson

**On fuse, eliminating redundant work wins; parallelizing I/O does not.**
Concurrent fuse reads do not overlap (virtiofs serializes them), and each
worker's per-thread `EngineState::new` *duplicates* the fuse-heavy source scan —
so parallelizing the discover phase and the cold resolve was break-even to a
regression and was reverted. The reliable levers were **elimination** (iters
3, 4, 6) and **CPU parallelism where per-worker setup is cheap** (iter 2, just a
handle clone). Fixed overhead (startup ~5.6 ms + repo-open ~4 ms) is irreducible
without risky gix-internals surgery and is dwarfed by the work.

## Cumulative result (fuse `/workspace`, original 1.0.117 vs final 1.0.120, interleaved)

| op | before | after | change |
|----|--------|-------|--------|
| `list 'packages/**'` | ~20.8 ms | ~11.1 ms | −47% |
| `history <mesh>` | ~955 ms | ~272 ms | −72% (3.5×) |
| `stale` (cold) | ~555 ms | ~540 ms | ~flat |

`stale --fix` improved on its `--fix`-specific overhead (post-resolve −41%,
corpus loads 6→3) but, like cold `stale`, remains dominated by the resolver.

## Scale validation (`size_sweep`, 25→2000 meshes)

No super-linear regression — all adjacent-size exponents are well under the 1.65
band (with commit-graph: 0.90 / 0.63 / 1.26; without: 1.01 / 1.00 / 1.25), and
criterion reported −40% to −70% vs the pre-work baseline.

## Stopping analysis — where the floor is

After these iterations the remaining cold `stale` cost (~500 ms on fuse) is the
**resolver's per-anchor content resolution**: 136 anchors each doing one
memoized HEAD-blob lookup + decompress + line-index + hash. It is already
linear, memoized, and cached; profiling found no algorithmic hotspot. The only
structural lever is reducing the *number* of fuse object reads (batched/pack
reads), which is uncertain (depends on repo gc/pack state) and high-risk against
correctness-critical drift classification — not worth it for the measured
operating point. The fixed floor (startup + repo-open ≈ 10 ms) is irreducible.
Further work should target the resolver's fuse read **count**, not its CPU or
parallelism.
