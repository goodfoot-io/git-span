# Prompt: Drive git-span Toward Breakthrough-Scale Performance

You are working in `/workspace`, focused on `packages/git-span`. Continue performance work after the latest optimization passes, but change the emphasis: the next gains probably require a measured architectural breakthrough, not only more local read-path cleanup.

The public CLI surface must not change. Preserve output formats, flags, arguments, exit codes, and machine-readable contracts unless tests explicitly establish a new correct behavior.

## Current State

Read these first:

- `docs/optimization-status.md`: authoritative current status, results, accepted/rejected experiments, and validation notes.
- `profiling/continued-optimization-prompt.md`: original broad optimization prompt and constraints.
- `scripts/bench-span-scale.sh`: synthetic scale benchmark for 100/1,000/10,000 span tiers.
- `packages/git-span/src/cli/show.rs`: `ls` and `show` read/render path.
- `packages/git-span/src/span/read.rs`: span ref and commit read helpers.
- `packages/git-span/src/resolver/engine/mod.rs`: workspace-wide `stale` and `pre-commit` resolver orchestration.
- `packages/git-span/src/anchor.rs` and `packages/git-span/src/git.rs`: anchor ref/object and Git helper boundaries.

Latest completed pass:

- `git span list --porcelain` skips committed span why text and staged-state reads unless human output or `--search` needs them.
- Bulk `list`, workspace-wide `stale`, and `pre-commit` reuse span ref target OIDs from enumeration instead of resolving the same span refs again.
- `pre-commit` now resolves committed spans through one shared resolver state, matching the `stale` reuse pattern.
- A command-local full anchor-ref OID snapshot was tested and rejected: on the 1,000-span fixture it added a 30-60 ms namespace scan/peel cost to `list` and regressed `stale` to about 4.7 s.

Post-pass direct `GIT_SPAN_PERF=1` on a fresh 1,000-span, 2-anchor mixed fixture:

| operation | total | notable spans |
|---|---:|---|
| `ls --porcelain` | 91.656 ms | list span refs 19.135 ms; read committed span/anchor records 70.977 ms; sort/page/render 1.361 ms |
| `ls src/module_001.rs#L15-L19 --porcelain` | 89.138 ms | list span refs 19.131 ms; read committed span/anchor records 69.583 ms; path filter 0.220 ms |
| `stale --no-exit-code` | 1,718.633 ms | resolve all spans 1,718.439 ms; resolve span loop 1,695.391 ms; render human 0.001 ms |
| `pre-commit --no-exit-code` | 2,643.159 ms | shared resolve span loop 2,576.382 ms; pre-commit resolve wrapper 2,631.430 ms |

Known important artifact paths:

- `profiling/bench-span-scale.after.100x2.md` and `.csv`
- `profiling/git-span-profile.after.1000x2.*.err` and `.out`
- Older scale artifacts listed in `docs/optimization-status.md`

## Strategic Objective

Find and implement a major measured breakthrough for 10,000-span scale.

The current model is still effectively O(all committed span/anchor records) for filtered `ls`, and O(all anchors resolved) for workspace `stale` / `pre-commit`. More small cleanups are acceptable only if they directly support the larger decision. The main target is to prove, reject, or implement an authoritative Git-backed data layout that avoids scanning unrelated anchors for hot workflows.

Primary breakthrough candidates:

1. Authoritative path/range metadata index stored in span commits or span storage.
   - It must not be a derived cache with eviction or invalidation.
   - It should be part of the authoritative repository data model.
   - It should support `ls <path>#L<s>-L<e> --porcelain` without reading every unrelated anchor.
   - It should preserve existing public output and ordering, or update tests if a new ordering is explicitly chosen.

2. Reduced-ref layout.
   - Store anchor records directly in span commit trees rather than one `refs/anchors/v1/<uuid>` ref per anchor.
   - Preserve behavior without adding a migration unless explicitly requested.
   - Greenfield schema changes are allowed if tests/docs are updated and current CLI behavior stays stable.

3. Git-native searchable tree/index layout.
   - Store path-oriented metadata in deterministic tree paths such as path hashes or prefix shards.
   - Reads should be bounded by queried path/range rather than all spans.
   - Writes must remain transactional and fail closed.

4. Reftable-aware or packed-ref-aware strategy.
   - Measure first; do not assume.
   - If local Git supports reftable, create scratch fixtures and compare loose refs, packed refs, and reftable.
   - If a strategy only helps under reftable, document the fallback behavior clearly.

## Hard Constraints

- Do not add persistent derived caches, sidecar cache directories, daemon state, TTLs, or cleanup-dependent data.
- Do not change the public CLI surface area.
- Preserve fail-closed behavior.
- Prefer authoritative Git data over local filesystem state.
- Avoid automatic Git maintenance during normal CLI commands.
- Use `yarn`, not `npm`.
- After code or configuration changes, run validation from the package directory and root `yarn validate`. Warnings are blocking.

## Wiki Workload Is the Breakthrough Test

The downstream wiki CLI shells out once per fragment link:

```sh
git-span list <repo-relative-path>#L<start>-L<end> --porcelain
```

It parses:

```text
<span-name>\t<path>\t<start>-<end>
```

It expects `no spans` when there is no match.

Coverage rule: a wiki fragment is covered iff at least one span covers the code region and that same span also has the wiki file itself as an anchor. Optimize toward this real workload without adding a new CLI command.

Breakthrough target:

- At 10,000 spans x 2-5 anchors, filtered `ls <path>#L<s>-L<e> --porcelain` should avoid materializing unrelated anchors.
- Process startup may eventually dominate. Separate process startup cost from in-process lookup cost in the docs.
- If CLI-level batching would be the real solution, document it as a downstream recommendation, but do not add batching surface unless explicitly requested.

## Required First Measurements

Before designing a schema change, gather a decisive 10,000-span profile. If the full matrix is too slow, start with one targeted cell:

```sh
GIT_SPAN_BIN=/workspace/packages/git-span/target/release/git-span \
  scripts/bench-span-scale.sh \
  --span-counts 10000 \
  --anchors 2 \
  --iterations 1 \
  --wiki-queries 20 \
  --csv profiling/bench-span-scale.breakthrough.10000x2.csv \
  --keep \
  > profiling/bench-span-scale.breakthrough.10000x2.md \
  2> profiling/bench-span-scale.breakthrough.10000x2.err
```

Then run direct perf on the kept fixture:

```sh
cd /tmp/<kept-fixture>/repo-10000-2-mixed
GIT_SPAN_PERF=1 /workspace/packages/git-span/target/release/git-span list --porcelain >/workspace/profiling/git-span-profile.breakthrough.10000x2.ls.out 2>/workspace/profiling/git-span-profile.breakthrough.10000x2.ls.err
GIT_SPAN_PERF=1 /workspace/packages/git-span/target/release/git-span list 'src/module_001.rs#L15-L19' --porcelain >/workspace/profiling/git-span-profile.breakthrough.10000x2.ls-filter.out 2>/workspace/profiling/git-span-profile.breakthrough.10000x2.ls-filter.err
GIT_SPAN_PERF=1 /workspace/packages/git-span/target/release/git-span stale --no-exit-code >/workspace/profiling/git-span-profile.breakthrough.10000x2.stale.out 2>/workspace/profiling/git-span-profile.breakthrough.10000x2.stale.err
GIT_SPAN_PERF=1 /workspace/packages/git-span/target/release/git-span pre-commit --no-exit-code >/workspace/profiling/git-span-profile.breakthrough.10000x2.pre-commit.out 2>/workspace/profiling/git-span-profile.breakthrough.10000x2.pre-commit.err
```

Also run layout variants on the same scale:

- loose refs
- `git pack-refs --all`
- `git maintenance run --task=loose-objects --task=incremental-repack --task=commit-graph --task=pack-refs`
- reftable scratch repo if local Git supports it

Record object/ref counts:

```sh
git count-objects -vH
find .git/refs/spans .git/refs/anchors -type f | wc -l
test -f .git/packed-refs && wc -l .git/packed-refs
```

## Design Work Expected

After the 10,000-span profile, write down a short decision matrix in `docs/optimization-status.md` comparing at least these designs:

| design | expected filtered `list` complexity | write cost | storage cost | failure mode | migration needed now? |
|---|---|---|---|---|---|
| current refs | O(all span/anchor records) | current | high ref count | ref iteration/object reads | no |
| span-embedded anchors | O(spans) or better with index | lower refs | more commit-tree data | commit tree parse errors | no, greenfield only |
| authoritative path/range index | O(path bucket + matching spans) | extra tree writes | bounded tree blobs | stale index impossible if authoritative | no, greenfield only |
| reftable-aware refs | still O(log/scan refs), faster constants | current | backend-dependent | unavailable backend | no |

If a schema change is selected, implement the smallest greenfield slice that proves the behavior in tests and benchmark fixtures. Do not build migration code unless the user asks.

## Implementation Guidance

Prefer focused vertical slices:

1. Add read/write model types and parser tests for the new authoritative metadata.
2. Write metadata during new span commits.
3. Read metadata in filtered `list --porcelain` only.
4. Preserve legacy read path for any operation not covered by the new authoritative data only if the repository can contain both formats during the greenfield transition. If greenfield means no fallback, update tests and docs accordingly.
5. Benchmark before broadening to `stale` or `pre-commit`.

Be careful with semantics:

- Whole-file anchors match any range query on the same path.
- Line-range anchors overlap inclusively.
- `list <target> --porcelain` filters spans by target but renders all anchors in each matching span, not only the matching anchor.
- `--search` matches name, why, path, and rendered anchor address, so it may still require broader reads.
- Staging-only spans must still appear in `list` and `pre-commit` behavior.
- Orphaned anchors and missing refs must fail/report as current tests expect.

## Profiling Spans To Add If Needed

Keep perf logging opt-in and stderr-only. Add spans only around opaque groups:

- read span ref targets
- read span commit tree
- read anchors blob
- read anchor refs/blobs
- path-index lookup
- path-index candidate expansion
- filtered `list` render matched spans
- ref transaction setup and execution
- commit-tree construction

## Validation Requirements

Follow `AGENTS.md`.

For code/config changes in `packages/git-span`, run:

```sh
cd packages/git-span
cargo fmt --check
yarn lint
yarn typecheck
yarn test
```

For focused tests while iterating, prefer binary filters that actually run tests:

```sh
yarn test -E 'binary(cli_ls)'
yarn test -E 'binary(pre_commit_hook_integration)'
yarn test -E 'binary(stale_span_integration)'
```

Do not use `yarn test tests/cli_ls.rs`; with this repo's `nextest` setup it can build everything and then select zero tests, exiting 4.

Final validation:

```sh
cd /workspace
yarn validate
```

Exit code 0 is required.

## Expected Deliverables

1. New 10,000-span benchmark artifacts in ignored `profiling/`.
2. A design decision in `docs/optimization-status.md` with evidence.
3. A breakthrough implementation slice if the evidence supports one.
4. Tests for any new authoritative metadata format or changed read path.
5. Final validation summary.

The goal is not to make every operation perfect in one pass. The goal is to make one high-confidence move that changes the asymptotic behavior or definitively proves why a proposed asymptotic change should be rejected.
