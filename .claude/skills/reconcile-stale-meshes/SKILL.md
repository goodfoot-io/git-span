---
name: reconcile-stale-meshes
description: Reconcile stale git meshes surfaced by `git mesh stale`. Use when asked to "reconcile stale meshes", "fix stale meshes", "resolve mesh drift", "clean up stale meshes", or when `git mesh stale` exits non-zero with drift.
---

<instructions>

Reconcile every stale mesh reported by `git mesh stale`. The workflow has two phases: **research** (read-only — identify what drifted and why) then **execution** (mutate `.mesh/` files to re-anchor, re-hash, or delete). The research phase is done inline by the main agent; the execution phase is handed to forked subagents.

Work is partitioned by **file-connected components** — clusters of stale meshes that share at least one anchored file. Within a component, meshes must be reconciled together because they share context about what the correct line ranges are for the files they all anchor. Across components, meshes are fully independent. Each component goes to one fork; all forks run in parallel. A mesh that shares no files with any other stale mesh is a component of size one — still a valid fork unit.

Some steps reference sections of the `git-mesh:git-mesh` skill (e.g. "the command-reference section"). These are conditional — invoke `git-mesh:git-mesh` only when the topic exceeds what is explained here. The skill's sections are loaded together when the skill is invoked; navigate to the named section within it.

---

## Phase 1 — Research (main agent, read-only)

Do not mutate any file. Every command in this phase is read-only.

### 1. Auto-fix and commit before any research

`--fix` is global (it touches all meshes), so run it once before partitioning:

```bash
git mesh stale --fix
```

If `--fix` changed meshes:
- **`resolved, pending commit`**: commit source files first, then the mesh:
  ```bash
  git add <source-files> && git commit -m "Commit shifted source files"
  git add .mesh && git commit -m "Re-anchor moved mesh anchors"
  ```
  *(If this status is unfamiliar, invoke `git-mesh:git-mesh` — the terminal-statuses section covers `resolved, pending commit`.)*
- **Otherwise**: commit the mesh directly:
  ```bash
  git add .mesh && git commit -m "Re-anchor moved mesh anchors"
  ```

If `--fix` changed nothing, say so explicitly and note the reason (no MOVED or whitespace-equivalent CHANGED anchors). Do not proceed silently.

### 2. Run `git mesh stale` again

```bash
git mesh stale
```

The remaining findings are CHANGED (beyond whitespace) and DELETED. Group them by mesh name.

### 3. Build the file-sharing graph and find connected components

The `git mesh stale` output already lists every anchor for every stale mesh (stale
ones marked `— changed`/`— deleted`, healthy ones unmarked). Use that directly —
no need to run `git mesh show` on each mesh.

For every file that appears in more than one stale mesh, run `tree` at depth 1:

```bash
git mesh tree '<shared-file>' --depth 1
```

The tree output is the adjacency list: each child line represents one mesh that
anchors the file, displayed as its *other* anchored file paths. Stale meshes that
appear as children of the same file are connected — they form one component. A
stale mesh whose anchored files each appear in only one stale mesh is a component
of size one. Meshes that appear in the tree output but are not stale are context
the fork will use to understand what the correct line ranges should be.

*(If the tree output format is unfamiliar, invoke `git-mesh:git-mesh` — the
inspecting-meshes section covers the nested markdown-list schema.)*

*Example: `wiki/meta/update-order`, `git-mesh-touchpoints/cli-config`, and
`wiki/meta/command-behavior-source-of-truth` all anchor `cli/mod.rs` — running
`git mesh tree cli/mod.rs --depth 1` shows all three as children, so they form
one component. `docs/merge-conflict-fix-contract` anchors only
`command-reference.md` and `terminal-statuses.md`, which no other stale mesh
anchors — it forms a second component. These two components can be forked in
parallel.*

Find the connected components of this graph. Each component is one unit of work.

### 4. Survey blast radius for context

For the shared files within each component, widen the tree one more level to
understand the second-degree neighborhood — meshes that don't anchor the shared
file directly, but anchor files that the component's other meshes anchor:

```bash
git mesh tree '<shared-file>' --depth 2
```

This reveals the full neighborhood the fork needs: stale meshes (the component),
non-stale meshes that anchor the same files (context for correct ranges), and
one hop beyond (meshes that might be affected by a range change). The fork
prompt will include the non-stale meshes as context.

### 5. Note findings per component — do not investigate yet

The main agent's job is structural, not investigative. For each component, record
**what** is stale — the forks will determine **why** and **what to do about it**.

For each component, assemble a brief:

- Every mesh in the component
- Every stale anchor (from the `git mesh stale` output) — path, line range, CHANGED or DELETED
- The why for each mesh (from the stale output — do not run `git mesh why <name>` to read it)
- Shared files within the component, and any non-stale meshes that also anchor them (from step 4's blast radius)
- Flag any anchors on shared files whose ranges overlap — the fork will need to coordinate them

**Do not** read every stale-anchored file, run `git mesh history`, or write per-anchor
confirmations here. That investigation is the fork's job (Phase 2). The main agent
only reads a file in Phase 1 when it needs to resolve a range conflict visible from
the stale output alone (e.g., two meshes anchor the same file at overlapping ranges
and the stale output gives conflicting signals about which range is current).

**Do not run `git mesh why <name>`.** The stale output already prints the why for
every mesh that has one. Running `why` separately is a wasted command — the fork
will read the why from the same stale output.

Classify each anchor as CHANGED or DELETED (from the stale output — no further
classification yet). The forks will read the files, compare against history, and
assign the final category (re-hash, range-shift, delete, code-fix-first, add-why).

**STOP if a DELETED anchor's file no longer exists on disk.** The fork can't
investigate a deleted file — the main agent must handle this case inline:
- If the remaining anchors still describe a valid relationship, remove the
  deleted-file anchor from the mesh.
- If the relationship is gone entirely, delete the mesh.
*(If deletion syntax is unfamiliar, invoke `git-mesh:git-mesh` — the
command-reference section covers `git mesh delete`.)*

### 6. Assemble the work plan — one per component

For each component, produce:

- Component label (shared-file name, or "isolated")
- Mesh names
- Stale anchor paths with CHANGED/DELETED status
- Why (from stale output)
- Shared files and any non-stale meshes anchoring them (from blast radius)
- Any range-overlap flags for the fork to coordinate

**That's it.** No per-anchor confirmations, no pre-computed `remove`/`add` commands,
no classification beyond CHANGED/DELETED. The forks own the investigation.

### 7. Check whether forking is worthwhile

If the set of stale meshes is small and simple (e.g., 1–2 meshes, all WholeFile
anchors, no shared files), the overhead of a fork may not be justified. In that
case handle it inline — read the files, run history, confirm, classify, and execute
directly. Skip Phase 2.

Otherwise, hand each component to a fork in Phase 2.

---

## Phase 2 — Execution (one fork per component, all forks in parallel)

Fork one subagent per component. If there is 1 component, you get 1 fork. If there
are N components, N forks run in parallel.

**No worktree isolation** — components are disjoint by construction (if two meshes
shared a file, they'd be in the same component), so forks touch disjoint `.mesh/`
files. They share the main worktree without conflict. Only the main agent commits
at the end.

Dispatch each component with a fork. Forks inherit the full conversation context
(including this skill's instructions), so the prompt only needs to identify which
meshes the fork owns and the structural context the main agent gathered in Phase 1:

```xml
<invoke name="Agent">
<parameter name="description" string="true">Reconcile <component-label> cluster</parameter>
<parameter name="subagent_type" string="true">fork</parameter>
<parameter name="prompt" string="true">
Reconcile these <N> stale meshes (component: <component-label> — connected via <shared-file>). Do not commit.

## <name-1>
- CHANGED: <path>#L<N>-L<M>
- Healthy: <paths>
- Why: <from stale output>

## <name-2>
- CHANGED: <path> — <CHANGED|DELETED>
- Why: <from stale output>

(Context: these meshes share <shared-file>. Non-stale meshes also anchoring it: <list>. <Range-overlap flag if any>.)
</parameter>
</invoke>
```

### Fork procedure

Each fork reads this section from context to know what to do. The main agent's
prompt only designates which meshes — the procedure is shared here.

For each assigned mesh:

1. Read the current bytes at each stale anchor location.
2. Run `git mesh history <name>`; compare `<current>` against anchored content.
3. Write a one-sentence confirmation of the relationship. Stop if you cannot.
4. Classify and execute:

| Category | Action |
|---|---|
| Bytes shifted, meaning preserved | `git mesh remove <name> '<path>#L<old>'` then `git mesh add <name> '<path>#L<new>'` |
| Content updated, same relationship | `git mesh remove <name> '<path>#L<N>'` then `git mesh add <name> '<path>#L<N>'` (re-hash) |
| Content no longer describes relationship | `git mesh remove <name> '<path>#L<N>'` |
| One side of the relationship broke | Fix the code first, then re-anchor (both sides in one commit) |
| Relationship gone entirely | `git mesh delete <name>` |
| Mesh has no why | `git mesh why <name> -m "<one sentence>"` |

*(If deletion syntax is unfamiliar, invoke `git-mesh:git-mesh` — the
command-reference section covers `git mesh delete`. If source code needs
fixing or you need to write a why, invoke `git-mesh:git-mesh` — the
creating-a-mesh section covers why-writing conventions.)*

5. `git mesh stale` — confirm this mesh no longer appears (ignore meshes
   assigned to other components).

**Rules**: Never bulk re-add every anchor to clear the exit code. Each CHANGED
finding requires its own one-sentence confirmation. Coordinate ranges when
multiple meshes in the component anchor the same file. Stop and report if any
finding cannot be confirmed. Do not commit.

### After all forks complete

```bash
git mesh stale     # must exit 0 with "0 stale"
git mesh doctor    # must report "no findings"
git add .mesh && git commit -m "Reconcile stale meshes"
```

If any fork reported a failure, or `git mesh stale` is non-zero, handle the
failing component inline (its meshes are isolated from the successful components
by definition, so only the failed component needs rework).

---

## Git allowlist

When resolving meshes in a shared worktree, restrict to: `git mesh …`, `git add .mesh[/<name>]`, `git commit -m` (never `-a` or `--amend`), `git checkout <commit-ish> -- .mesh/<name>`, and read-only `git status`/`git diff`/`git log`/`git show`. Never touch paths outside `.mesh/` or rewind HEAD.
</instructions>
