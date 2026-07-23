---
name: reconcile
description: Reconcile stale git spans surfaced by `git span stale`. Use when asked to "reconcile stale spans", "fix stale spans", "resolve span drift", "clean up stale spans", or when `git span stale` exits non-zero with drift.
---

<instructions>

Reconcile every stale span reported by `git span stale`. The workflow has two phases: **research** (read-only — identify what drifted and why) then **execution** (mutate `.span/` files to re-anchor, re-hash, or delete). The research phase is done inline by the main agent; the execution phase is handed to forked subagents.

Work is partitioned by **file-connected components** — clusters of stale spans that share at least one anchored file. Within a component, spans must be reconciled together because they share context about what the correct line ranges are for the files they all anchor. Across components, spans are fully independent. Each component goes to one fork; all forks run in parallel. A span that shares no files with any other stale span is a component of size one — still a valid fork unit.

Some steps reference sections of the `git-span:git-span` skill (e.g. "the command-reference section"). These are conditional — invoke `git-span:git-span` only when the topic exceeds what is explained here. The skill's sections are loaded together when the skill is invoked; navigate to the named section within it.

---

## Phase 1 — Research (main agent, read-only)

Do not mutate any file. Every command in this phase is read-only.

### 1. Auto-fix and commit before any research

`--fix` is global (it touches all spans), so run it once before partitioning:

```bash
git span stale --fix
```

If `--fix` changed spans:
- **`resolved, pending commit`**: commit source files first, then the span:
  ```bash
  git add <source-files> && git commit -m "Commit shifted source files"
  git add .span && git commit -m "Re-anchor moved span anchors"
  ```
  *(If this status is unfamiliar, invoke `git-span:git-span` — the terminal-statuses section covers `resolved, pending commit`.)*
- **Otherwise**: commit the span directly:
  ```bash
  git add .span && git commit -m "Re-anchor moved span anchors"
  ```

If `--fix` changed nothing, say so explicitly and note the reason (no MOVED or whitespace-equivalent CHANGED anchors). Do not proceed silently.

### 2. Run `git span stale` again

```bash
git span stale
```

The remaining findings are CHANGED (beyond whitespace) and DELETED. Group them by span name.

### 3. Build the file-sharing graph and find connected components

The `git span stale` output already lists every anchor for every stale span (stale
ones marked `— changed`/`— deleted`, healthy ones unmarked). Use that directly —
no need to run `git span show` on each span.

Collect every file that appears in more than one stale span, then pass all of
them as roots to a single `tree` call at depth 1 — `tree` accepts multiple
roots in one invocation and separates unrelated roots into distinct top-level
trees in the same output, so there is never a reason to call it once per file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 1
```

The tree output is the adjacency list: each top-level tree covers one shared
file (or a clique of files that co-occur on a span), and each child line
represents one span that anchors it, displayed as its *other* anchored file
paths. Stale spans that appear as children of the same top-level tree are
connected — they form one component. A stale span whose anchored files each
appear in only one stale span is a component of size one. Spans that appear in
the tree output but are not stale are context the fork will use to understand
what the correct line ranges should be.

*(If the tree output format is unfamiliar, invoke `git-span:git-span` — the
inspecting-spans section covers the nested markdown-list schema.)*

*Example: `wiki/meta/update-order`, `git-span-touchpoints/cli-config`, and
`wiki/meta/command-behavior-source-of-truth` all anchor `cli/mod.rs`, while
`docs/merge-conflict-fix-contract` anchors `command-reference.md` and
`terminal-statuses.md`, which no other stale span anchors. Running
`git span tree cli/mod.rs command-reference.md terminal-statuses.md --depth 1`
in one call returns `cli/mod.rs` as a top-level tree with all three spans as
children (one component) and `command-reference.md`/`terminal-statuses.md`
merged onto their own clique line as a second, separate top-level tree (a
second component) — the same result as three single-file calls, without
manually cross-referencing the outputs. These two components can be forked in
parallel.*

Find the connected components of this graph. Each component is one unit of work.

### 4. Survey blast radius for context

Widen the tree one more level to understand the second-degree neighborhood —
spans that don't anchor a shared file directly, but anchor files that the
component's other spans anchor. Pass every shared file collected in step 3 as
roots of one call again, this time at depth 2, rather than one call per file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 2
```

This reveals the full neighborhood the fork needs: stale spans (the component),
non-stale spans that anchor the same files (context for correct ranges), and
one hop beyond (spans that might be affected by a range change). The fork
prompt will include the non-stale spans as context.

### 5. Note findings per component — do not investigate yet

The main agent's job is structural, not investigative. For each component, record
**what** is stale — the forks will determine **why** and **what to do about it**.

For each component, assemble a brief:

- Every span in the component
- Every stale anchor (from the `git span stale` output) — path, line range, CHANGED or DELETED
- The why for each span (from the stale output — do not run `git span why <name>` to read it)
- Shared files within the component, and any non-stale spans that also anchor them (from step 4's blast radius)
- Flag any anchors on shared files whose ranges overlap — the fork will need to coordinate them

**Do not** read every stale-anchored file, run `git span history`, or write per-anchor
confirmations here. That investigation is the fork's job (Phase 2). The main agent
only reads a file in Phase 1 when it needs to resolve a range conflict visible from
the stale output alone (e.g., two spans anchor the same file at overlapping ranges
and the stale output gives conflicting signals about which range is current).

**Do not run `git span why <name>`.** The stale output already prints the why for
every span that has one. Running `why` separately is a wasted command — the fork
will read the why from the same stale output.

Classify each anchor as CHANGED or DELETED (from the stale output — no further
classification yet). The forks will read the files, compare against history, and
assign the final category (re-hash, range-shift, delete, code-fix-first, add-why).

**STOP if a DELETED anchor's file no longer exists on disk.** The fork can't
investigate a deleted file — the main agent must handle this case inline:
- If the remaining anchors still describe a valid relationship, remove the
  deleted-file anchor from the span.
- If the relationship is gone entirely, delete the span.
*(If deletion syntax is unfamiliar, invoke `git-span:git-span` — the
command-reference section covers `git span delete`.)*

### 6. Assemble the work plan — one per component

For each component, produce:

- Component label (shared-file name, or "isolated")
- Span names
- Stale anchor paths with CHANGED/DELETED status
- Why (from stale output)
- Shared files and any non-stale spans anchoring them (from blast radius)
- Any range-overlap flags for the fork to coordinate

**That's it.** No per-anchor confirmations, no pre-computed `remove`/`add` commands,
no classification beyond CHANGED/DELETED. The forks own the investigation.

### 7. Check whether forking is worthwhile

If the set of stale spans is small and simple (e.g., 1–2 spans, all WholeFile
anchors, no shared files), the overhead of a fork may not be justified. In that
case handle it inline — read the files, run history, confirm, classify, and execute
directly. Skip Phase 2.

Otherwise, hand each component to a fork in Phase 2.

---

## Phase 2 — Execution (one fork per component, all forks in parallel)

Fork one subagent per component. If there is 1 component, you get 1 fork. If there
are N components, N forks run in parallel.

**No worktree isolation** — components are disjoint by construction (if two spans
shared a file, they'd be in the same component), so forks touch disjoint `.span/`
files. They share the main worktree without conflict. Only the main agent commits
at the end.

Dispatch each component with a fork. Forks inherit the full conversation context
(including this skill's instructions), so the prompt only needs to identify which
spans the fork owns and the structural context the main agent gathered in Phase 1:

```xml
<invoke name="Agent">
<parameter name="description" string="true">Reconcile <component-label> cluster</parameter>
<parameter name="subagent_type" string="true">fork</parameter>
<parameter name="prompt" string="true">
Reconcile these <N> stale spans (component: <component-label> — connected via <shared-file>). Do not commit.

## <name-1>
- CHANGED: <path>#L<N>-L<M>
- Healthy: <paths>
- Why: <from stale output>

## <name-2>
- CHANGED: <path> — <CHANGED|DELETED>
- Why: <from stale output>

(Context: these spans share <shared-file>. Non-stale spans also anchoring it: <list>. <Range-overlap flag if any>.)
</parameter>
</invoke>
```

### Fork procedure

Each fork reads this section from context to know what to do. The main agent's
prompt only designates which spans — the procedure is shared here.

For each assigned span:

1. Read the current bytes at each stale anchor location.
2. Run `git span history <name>`; compare `<current>` against anchored content.
3. Write a one-sentence confirmation of the relationship. Stop if you cannot.
4. Classify and execute:

| Category | Action |
|---|---|
| Bytes shifted, meaning preserved | `git span remove <name> '<path>#L<old>'` then `git span add <name> '<path>#L<new>'` |
| Content updated, same relationship | `git span remove <name> '<path>#L<N>'` then `git span add <name> '<path>#L<N>'` (re-hash) |
| Content no longer describes relationship | `git span remove <name> '<path>#L<N>'` |
| One side of the relationship broke | Fix the code first, then re-anchor (both sides in one commit) |
| Relationship gone entirely | `git span delete <name>` |
| Span has no why | `git span why <name> "<one present-tense sentence naming what the anchors form together>"` |

*(If deletion syntax is unfamiliar, invoke `git-span:git-span` — the
command-reference section covers `git span delete`. If source code needs
fixing or you need to write a why, invoke `git-span:git-span` — the
"Declare a new coupling" recipe covers why-writing conventions.)*

5. `git span stale` — confirm this span no longer appears (ignore spans
   assigned to other components).

**Rules**: Never bulk re-add every anchor to clear the exit code. Each CHANGED
finding requires its own one-sentence confirmation. Coordinate ranges when
multiple spans in the component anchor the same file. Stop and report if any
finding cannot be confirmed. Do not commit.

### After all forks complete

```bash
git span stale     # must exit 0 with "0 stale"
git span doctor    # must report "no findings"
git add .span && git commit -m "Reconcile stale spans"
```

If any fork reported a failure, or `git span stale` is non-zero, handle the
failing component inline (its spans are isolated from the successful components
by definition, so only the failed component needs rework).

---

## Git allowlist

When resolving spans in a shared worktree, restrict to: `git span …`, `git add .span[/<name>]`, `git commit -m` (never `-a` or `--amend`), `git checkout <commit-ish> -- .span/<name>`, and read-only `git status`/`git diff`/`git log`/`git show`. Never touch paths outside `.span/` or rewind HEAD.
</instructions>
