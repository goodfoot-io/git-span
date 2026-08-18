# Reconcile drifted git spans

Run it inline when you are not working on other tasks. You are the session's main agent: preparation, execution, validation, and commit.

Work is partitioned by **file-connected components** — clusters of drifted spans that share at least one anchored file. Handle one component at a time. Within a component, only spans with overlapping ranges on the same file must be reconciled together; the rest of the component is independent. Across components, spans are fully independent. A span that shares no files with any other drifted span is a component of size one.

Some steps reference sections of the `git-span:git-span` skill — invoke it only when the topic exceeds what is explained here, and navigate to the named section.

---

## Phase 1 — Preparation

Only step 1 may mutate `.span/`; the remaining research is read-only.

### 1. Auto-fix mechanical drift

`--fix` is global — run it once before partitioning. First scan the bare drift
output for `deleted in the working tree` anchors that are renames in progress:
a deletion at the old path plus a new file in `git status --short`, matched by
content (`git hash-object <new>` = `git rev-parse HEAD:<old>`). Stage both
halves (`git add <new> <old>`) — the resolver sees a staged rename as `moved
to <path>` and `--fix` clears it without a commit — and commit it when no
review-before-commit gate forbids; left unstaged it is invisible to the
resolver (an untracked destination has no git data) and needs a manual
re-anchor. A deletion is never cleared by `--fix` — step 4's STOP case governs
either way — but staging first makes its classification authoritative (`deleted
in the index`; committed, it names the commit). Under a review-before-commit
gate, staging still resolves the move; only a read-only worktree forces the
manual pass (or the R1 fallback when it ships). Confirm `--fix`'s `moved to`
destination when another same-content file exists — it matches by content and
may pick the wrong copy.

```bash
git span drift --fix
```

The remaining findings are CHANGED (beyond whitespace) and DELETED. Group them by span name.

If it changes `.span/`, commit that refresh with any uncommitted anchored source
it records — list every path it records in the commit's `-o`; if the source is
already committed, commit `.span/` alone. Use one commit. Otherwise continue.

### 2. Build the file-sharing graph and find connected components

The `git span drift` output lists every anchor for every drifted span (drifted
ones marked `— changed`/`— deleted`, healthy ones unmarked) — no need to run
`git span show` on each span.

Collect every file that appears in more than one drifted span, then pass all of
them as roots to a single `tree` call at depth 1 — `tree` takes multiple
roots, separating unrelated roots into distinct top-level trees; never one
call per file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 1
```

The tree output is the adjacency list: each top-level tree covers one shared
file (or a clique of files that co-occur on a span), and each child line
represents one span that anchors it, displayed as its *other* anchored file
paths. Drifted spans that appear as children of the same top-level tree are
connected — they form one component. A drifted span whose anchored files each
appear in only one drifted span is a component of size one. Spans that appear in
the tree output but are not drifted are context that tells you what the correct
line ranges should be.

Find the connected components of this graph. Each component is one unit of work.

### 3. Survey blast radius for context

Widen the tree one more level to understand the second-degree neighborhood —
spans that don't anchor a shared file directly, but anchor files that the
component's other spans anchor. Pass every shared file collected in step 2 as
roots of one call again, at depth 2:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 2
```

This reveals the full neighborhood you need: drifted spans (the component),
non-drifted spans that anchor the same files (context for correct ranges), and
one hop beyond (spans that might be affected by a range change).

### 4. Note findings per component — the execution plan

Your job here is structural, not investigative: record **what** is drifted; the
per-anchor investigation happens in Phase 2. For each component, assemble a
brief:

- Every span in the component
- Every drifted anchor (from the `git span drift` output) — path, line range, CHANGED or DELETED
- The why for each span (from the drift output — do not run `git span why <name>` to read it)
- Shared files within the component, and any non-drifted spans that also anchor them (from step 3's blast radius)
- Flag any anchors on shared files whose ranges overlap — those spans must be reconciled together

An oversized component can be handled in cohesive sub-batches by topic/subsystem,
as long as no sub-batch separates spans with overlapping ranges on a shared file.

**STOP if a DELETED anchor's file no longer exists on disk.** A deleted file
cannot be investigated:
- If the remaining anchors still describe a valid relationship, remove the
  deleted-file anchor from the span.
- If the relationship is gone entirely, delete the span.
*(If deletion syntax is unfamiliar, invoke `git-span:git-span` — the
command-reference section covers `git span delete`.)*

---

## Phase 2 — Execution

Handle each component (or sub-batch) in turn. For each span, follow the
per-anchor procedure:

1. Run `git span history <name>` once for all anchors. Use its live-drift diffs
   to identify byte changes, `drift source` (`sources` in JSON) to identify layers, and its
   declaration diff and timeline to establish provenance. `HEAD` alone does not
   prove a committed change; a worktree-only declaration re-anchor can produce it.
   If only the declaration changed, inspect it and either commit or revert it rather
   than searching timeline entries for a content commit that does not exist.
   History does not locate a CHANGED anchor's destination, so use a targeted
   old/current file diff only when its logical region moved. When authority
   remains unclear, decide which side is authoritative: a doc drifting behind a
   deliberate, committed code change is wrong — conform it; a code change with
   no coherent commit story may be a regression — the doc may be the truth.
   Docs follow deliberate committed code, describing current reality — never
   "we used to" framing. Keep the why across routine re-anchors; write a new
   one only when the subsystem itself changed. Fail closed on ambiguity, not on
   editing per se.
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

Every `add`/`why` write now ends with a post-write span-wide check that shares
`drift`'s exit contract: exit 0 = clean, exit 1 = actionable drift remains or
the check errored (the output says which: remains lines vs `state unverified`),
exit 2 = indeterminate — the resolver's `index_changed` verdict, retryable.
Read the mutation's span-wide line (`0 drift across ...`, `N anchors drifted —
...`, `state indeterminate`, `state unverified`) before the trailing scoped
`drift`; drift's own 0/1/2 semantics are unchanged.

5. `git span drift <name>` — require exit 0 and zero drift for this span.

Confirm the intended canonical address occurs exactly once, every superseded address is absent, and the why remains accurate.

Confirm each CHANGED finding; never bulk re-add anchors. `add` does not retire a
different address. Coordinate overlapping ranges. Stop on unconfirmed findings.

---

## Phase 3 — Validation and commit

```bash
git span drift     # must exit 0 with "0 drift"
git span doctor    # must report "no findings"
```

Run required validation for every behavior change and surface every anchor diff.

```bash
git add <changed-anchor-paths> .span   # omit content paths when no anchor changed
git commit -o .span <changed-anchor-paths> -m "Restore spanned relationships"
```

If validation fails, handle the failing component before committing.

---

## Git allowlist

When resolving spans in a shared worktree, restrict to: `git span …`, edits to
assigned anchors when confirmed authority or a satisfied gate decides them, required tests,
`git add .span[/<name>]`, `git add <assigned-anchor>`, `git commit -o .span[/<name>] <assigned-anchor> -m` (never
`-a` or `--amend`), `git checkout <commit-ish> -- .span/<name>`, and read-only
`git status`/`git diff`/`git log`/`git show`. Never touch unrelated paths or
rewind HEAD.
