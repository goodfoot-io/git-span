---
name: reconcile
description: Reconcile drifted git spans surfaced by `git span drift`. Use when asked to "reconcile drifted spans", "reconcile stale spans", "fix drifted spans", "fix stale spans", "resolve span drift", "clean up drifted spans", "clean up stale spans", or when `git span drift` exits non-zero with drift.
---

<instructions>

Reconcile every drifted span reported by `git span drift`. The workflow has two phases: **preparation and research** (auto-fix mechanical drift, then investigate) and **execution** (restore the relationship and reconcile its declaration). The main agent handles the first phase; forked subagents handle execution.

Work is partitioned by **file-connected components** — clusters of drifted spans that share at least one anchored file. Within a component, only spans with overlapping ranges on the same file must be reconciled together; the rest of the component is independent. Across components, spans are fully independent. Each component maps to one or more forks, all running in parallel: an oversized component (too many spans for one fork) splits into cohesive sub-batches by topic/subsystem, as long as no split separates spans with overlapping ranges on a shared file. A span that shares no files with any other drifted span is a component of size one — still a valid fork unit.

Some steps reference sections of the `git-span:git-span` skill (e.g. "the command-reference section"). These are conditional — invoke `git-span:git-span` only when the topic exceeds what is explained here. The skill's sections are loaded together when the skill is invoked; navigate to the named section within it.

---

## Phase 1 — Preparation and research (main agent)

Only step 1 may mutate `.span/`; the remaining research is read-only.

### 1. Auto-fix mechanical drift

`--fix` is global (it touches all spans), so run it once before partitioning:

```bash
git span drift --fix
```

If it changes `.span/`, commit that refresh with any uncommitted anchored source
it records; if the source is already committed, commit `.span/` alone. Use one
commit. Otherwise continue.

### 2. Run `git span drift` again

```bash
git span drift
```

The remaining findings are CHANGED (beyond whitespace) and DELETED. Group them by span name.

### 3. Build the file-sharing graph and find connected components

The `git span drift` output already lists every anchor for every drifted span (drifted
ones marked `— changed`/`— deleted`, healthy ones unmarked). Use that directly —
no need to run `git span show` on each span.

Collect every file that appears in more than one drifted span, then pass all of
them as roots to a single `tree` call at depth 1 — `tree` accepts multiple
roots in one invocation and separates unrelated roots into distinct top-level
trees in the same output, so there is never a reason to call it once per file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 1
```

The tree output is the adjacency list: each top-level tree covers one shared
file (or a clique of files that co-occur on a span), and each child line
represents one span that anchors it, displayed as its *other* anchored file
paths. Drifted spans that appear as children of the same top-level tree are
connected — they form one component. A drifted span whose anchored files each
appear in only one drifted span is a component of size one. Spans that appear in
the tree output but are not drifted are context the fork will use to understand
what the correct line ranges should be.

Find the connected components of this graph. Each component is one unit of work.

### 4. Survey blast radius for context

Widen the tree one more level to understand the second-degree neighborhood —
spans that don't anchor a shared file directly, but anchor files that the
component's other spans anchor. Pass every shared file collected in step 3 as
roots of one call again, this time at depth 2, rather than one call per file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 2
```

This reveals the full neighborhood the fork needs: drifted spans (the component),
non-drifted spans that anchor the same files (context for correct ranges), and
one hop beyond (spans that might be affected by a range change). The fork
prompt will include the non-drifted spans as context.

### 5. Note findings per component — do not investigate yet

The main agent's job is structural, not investigative. For each component, record
**what** is drifted — the forks will determine **why** and **what to do about it**.

For each component, assemble a brief:

- Every span in the component
- Every drifted anchor (from the `git span drift` output) — path, line range, CHANGED or DELETED
- The why for each span (from the drift output — do not run `git span why <name>` to read it)
- Shared files within the component, and any non-drifted spans that also anchor them (from step 4's blast radius)
- Flag any anchors on shared files whose ranges overlap — the fork will need to coordinate them

**Do not** read every drift-anchored file, run `git span history`, or write per-anchor
confirmations here. That investigation is the fork's job (Phase 2). The main agent
only reads a file in Phase 1 when it needs to resolve a range conflict visible from
the drift output alone (e.g., two spans anchor the same file at overlapping ranges
and the drift output gives conflicting signals about which range is current).

**Do not run `git span why <name>`.** The drift output already prints the why for
every span that has one. Running `why` separately is a wasted command — the fork
will read the why from the same drift output.

Classify each anchor as CHANGED or DELETED (from the drift output — no further
classification yet). The forks will read the files, compare against history, and
assign the final category (re-hash, range-shift, delete, gate-transition, add-why).

**STOP if a DELETED anchor's file no longer exists on disk.** The fork can't
investigate a deleted file — the main agent must handle this case inline:
- If the remaining anchors still describe a valid relationship, remove the
  deleted-file anchor from the span.
- If the relationship is gone entirely, delete the span.
*(If deletion syntax is unfamiliar, invoke `git-span:git-span` — the
command-reference section covers `git span delete`.)*

### 6. Assemble the work plan — one per fork unit

For each component, produce a fork unit; split an oversized component into
several cohesive sub-batches (by topic/subsystem) if needed, never separating
spans flagged with a range overlap. For each fork unit, produce:

- Label (shared-file name, sub-batch topic, or "isolated")
- Span names
- Drifted anchor paths with CHANGED/DELETED status
- Why (from drift output)
- Shared files and any non-drifted spans anchoring them (from blast radius)
- Any range-overlap flags for the fork to coordinate

**That's it.** No per-anchor confirmations, no pre-computed `remove`/`add` commands,
no classification beyond CHANGED/DELETED. The forks own the investigation.

### 7. Check whether forking is worthwhile

If the set of drifted spans is small and simple (e.g., 1–2 spans, all WholeFile
anchors, no shared files), the overhead of a fork may not be justified. In that
case handle it inline — read the files, run history, confirm, classify, and execute
directly. Skip Phase 2.

Otherwise, hand each component to a fork in Phase 2.

---

## Phase 2 — Execution (one fork per fork unit, all forks in parallel)

Fork one subagent per fork unit from step 6 (a component, or a sub-batch of an
oversized component). If there are N fork units, N forks run in parallel.

**No worktree isolation** — fork units are disjoint by construction (spans with
overlapping ranges on a shared file are never split across units), so forks
touch disjoint `.span/` files. They share the main worktree without conflict.
Only the main agent commits.

Dispatch each fork unit with the `spawn_agent` tool, setting `fork_turns: "all"`
so the fork runs to completion. Forks inherit the full conversation context
(including this skill's instructions), so the `message` only needs to identify
which spans the fork owns and the structural context the main agent gathered in
Phase 1:

```json
{
  "task_name": "reconcile <component-label> cluster",
  "message": "Reconcile these <N> drifted spans (component: <component-label> — connected via <shared-file>). Do not commit.\n\n## <name-1>\n- CHANGED: <path>#L<N>-L<M> (bare <path> for a whole-file anchor)\n- Healthy: <paths>\n- Why: <from drift output>\n\n## <name-2>\n- CHANGED: <path> — <CHANGED|DELETED>\n- Why: <from drift output>\n\n(Context: these spans share <shared-file>. Non-drifted spans also anchoring it: <list>. <Range-overlap flag if any>.)",
  "fork_turns": "all"
}
```

### Fork procedure

Each fork reads this section from context to know what to do. The main agent's
`spawn_agent` message only designates which spans — the procedure is shared here.

For each assigned span:

1. Run `git span history <name>` once for all anchors. Use its live-drift diffs
   to identify byte changes, `drift source` (`sources` in JSON) to identify layers, and its
   declaration diff and timeline to establish provenance. `HEAD` alone does not
   prove a committed change; a worktree-only declaration re-anchor can produce it.
   If only the declaration changed, inspect it and either commit or revert it rather
   than searching timeline entries for a content commit that does not exist.
   History does not locate a CHANGED anchor's destination, so use a targeted
   old/current file diff only when its logical region moved. Apply
   `wiki/guides/reconciliation-authority.md` when authority remains unclear.
2. Read current bytes at each drifted anchor.
3. Write a concise confirmation of the relationship and its decisive nonlocal
   fact. Stop if you cannot.
4. Classify and execute:

| Category | Action |
|---|---|
| Whole-file anchor CHANGED; the file is still consumed as a unit | `git span add <name> '<path>'` — re-add the same bare path; a whole-file anchor stays whole-file |
| Range anchor CHANGED at the same address; the logical region did not move | `git span add <name> '<path>#L<start>-L<end>'` — re-add the exact existing range, nothing else |
| File shrunken below the anchored end; the region still exists | `git span remove <name> '<path>#L<old>'` then `git span add <name> '<path>#L<new>'` — an identity change, with the new extent equal to the file's current line count |
| Logical region genuinely moved to a new range | `git span remove <name> '<path>#L<old>'` then `git span add <name> '<path>#L<new>'` |
| One anchor lags a confirmed authority | Conform it, validate any code change, then re-anchor; include the content diff in your report |
| Content no longer describes relationship | `git span remove <name> '<path>#L<N>'` |
| Relationship gone entirely | `git span delete <name>` |
| Span has no why | Invoke the core skill's why rules, then use `git span why` |
| Lifecycle gate is satisfied | Make the authorized behavior change, revise or retire the substantive why, and reconcile or retire every superseded anchor |
| Authority remains unclear or no intentional change explains drift | Stop and report — the user decides |

Never add a narrower range just because edited code now looks locally narrower: an unchanged whole-file anchor stays whole-file and an unchanged range keeps its exact boundaries. A file whose line count no longer reaches the anchored end is the exception — the extent genuinely contracted, so it is an identity change, not a narrowing, and the shrunken-file row above governs. If a span accidentally holds both a whole-file anchor and a range anchor for the same file, retire the one that no longer reflects the logical region and keep exactly one.

For deletion syntax or why rules, invoke the corresponding `git-span:git-span`
section.

5. `git span drift <name>` — require exit 0 and zero drift for this span.

Confirm the intended canonical address occurs exactly once, every superseded address is absent, and the why remains accurate.

Confirm each CHANGED finding; never bulk re-add anchors. `add` does not retire a
different address. Coordinate overlapping ranges. Stop on unconfirmed findings.
Do not commit.

### After all forks complete

```bash
git span drift     # must exit 0 with "0 drift"
git span doctor    # must report "no findings"
git add <changed-anchor-paths> .span
git commit -m "Restore spanned relationships"
```
Omit content paths when no anchor changed. Run required validation for every
behavior change and surface every anchor diff in the final report.

If any fork reported a failure, or `git span drift` is non-zero, handle the
failing fork unit inline (its spans are isolated from the successful units by
definition, so only the failed unit needs rework).

---

## Git allowlist

When resolving spans in a shared worktree, restrict to: `git span …`, edits to
assigned anchors when confirmed authority or a satisfied gate decides them, required tests,
`git add .span[/<name>]`, `git add <assigned-anchor>`, `git commit -m` (never
`-a` or `--amend`), `git checkout <commit-ish> -- .span/<name>`, and read-only
`git status`/`git diff`/`git log`/`git show`. Never touch unrelated paths or
rewind HEAD.
</instructions>
