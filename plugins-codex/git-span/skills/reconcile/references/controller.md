# Reconcile controller

You are the controller — the session's main agent running the forked path from `./shared.md`. You never commit from a spawned worker; after validation you run the commit commands yourself. `./worker.md` holds the per-anchor procedure and the git allowlist.

## Research the drift from scratch

The `git span drift` output lists every anchor for every drifted span (drifted
ones marked `— changed`/`— deleted`, healthy ones unmarked) — no need to run
`git span show` on each span.

Collect every file that appears in more than one drifted span, then pass them
all as roots to a single `tree` call at depth 1 — `tree` takes multiple roots,
separating unrelated roots into distinct top-level trees; never one call per
file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 1
```

The tree output is the adjacency list: each top-level tree covers one shared
file (or a clique of files that co-occur on a span), and each child line
represents one span that anchors it, displayed as its *other* anchored file
paths. Drifted spans under the same top-level tree are connected — one
**component**. A drifted span whose anchored files each appear in only one
drifted span is a component of size one. Non-drifted spans in the tree are
context that tells you what the correct line ranges should be.

Survey the blast radius — one more level, same roots at depth 2:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 2
```

This reveals the neighborhood: drifted spans (the component), non-drifted
spans anchoring the same files (context), and one hop beyond (spans a range
change might affect).

Flag any anchors on shared files whose ranges overlap — never split spans with
overlapping ranges on a shared file across workers.

## Assign the work

Spawn each unit worker via `spawn_agent` with `fork_turns: "all"`, its disjoint
unit in the `message`: the spans, drifted anchors (path, range,
CHANGED/DELETED), why, shared files, non-drifted context spans, and any
range-overlap flags. Keep a unit for yourself. When the worker count is one,
keep every unit and execute it yourself — spawn nothing.

Follow `./worker.md`'s per-anchor procedure for your own unit.

## Collect and validate

Collect the workers' reports as they return, then run the final validation:

```bash
git span drift     # must exit 0 with "0 drift"
git span doctor    # must report "no findings"
```

Run required validation for every behavior change.

Decide authority when a report stops on it: a doc drifting behind a deliberate,
committed code change is wrong — conform it; a code change with no coherent
commit story may be a regression — the doc may be the truth. Docs follow
deliberate committed code, describing current reality — never "we used to"
framing. Keep the why across routine re-anchors; write a new one only when the
subsystem itself changed. Fail closed on ambiguity: surface the stop in the
final report, never re-anchor over a live disagreement.

## Report and commit

Produce the final report: the findings, every anchor diff, the fork count,
per-fork timing (from the workers' reports), the validation status, and the
commit commands — `git add <changed-anchor-paths> .span` (omit content paths
when no anchor changed) then `git commit -o .span <changed-anchor-paths> -m
"Restore spanned relationships"`. When validation is green, run the commit
commands — you are the session's main agent.
