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

For each stale mesh, enumerate its anchors:

```bash
git mesh show <name>
```

*(If the `show` output format is unfamiliar, invoke `git-mesh:git-mesh` — the inspecting-meshes section covers the TOML schema.)*

Build a graph:
- **Nodes** = stale meshes
- **Edges** = two meshes share at least one anchored file path (regardless of line range)

Find the connected components of this graph. Each component is one unit of work.

*Example: `wiki/meta/update-order`, `git-mesh-touchpoints/cli-config`, and `wiki/meta/command-behavior-source-of-truth` all anchor `cli/mod.rs` — they form one component. `docs/merge-conflict-fix-contract` anchors only `command-reference.md` and `terminal-statuses.md`, which no other stale mesh anchors — it forms a second component. These two components can be forked in parallel.*

### 4. Survey blast radius per component

For the files that connect each component, understand what else touches them:

```bash
# For the shared files within a component — don't dump `tree '**'`
git mesh tree '<shared-file>' --depth 2
```

*(If the tree output format is unfamiliar, invoke `git-mesh:git-mesh` — the inspecting-meshes section covers the nested markdown-list schema.)*

This confirms which meshes outside the component also anchor these files (they aren't stale, but they set context for what the correct range should be).

### 5. Confirm each CHANGED anchor

For each CHANGED finding, within its component:

1. The why is printed inline in the stale output — note if it's empty. (`git mesh stale` already shows the why for each mesh that has one; running `git mesh why <name>` separately to *read* is redundant.)
2. Read the current bytes at the anchored location with the Read tool.
3. Read the anchored bytes from history — start with just the `<current>` entry of `git mesh history <name>`, which compares HEAD against the working tree. Fetch full history only when the current-vs-anchored comparison is ambiguous. *(If the XML output format or drift-status labels are unfamiliar, invoke `git-mesh:git-mesh` — the inspecting-meshes section covers the history schema and the reading-stale-output section defines CHANGED/MOVED/DELETED.)*
4. **Write one sentence** stating what relationship the current bytes form relative to the mesh's purpose. If you cannot write it, stop — inspect further or plan to delete the mesh.

**When multiple meshes in the same component anchor the same file**, reconcile their ranges together. If mesh A widens `cli/mod.rs` to L38-L181 but mesh B narrows to L38-L108, decide which is correct and make them consistent — the component's forks will coordinate this.

Classify each finding into exactly one category, and write the exact commands:

| Category | Commands |
|---|---|
| Bytes shifted, meaning preserved | `git mesh remove <name> '<path>#L<old>'` then `git mesh add <name> '<path>#L<new>'` |
| Content updated, same relationship | `git mesh remove <name> '<path>#L<N>'` then `git mesh add <name> '<path>#L<N>'` (same range, re-hash) |
| Content no longer describes relationship | `git mesh remove <name> '<path>#L<N>'` |
| One side of the relationship broke | Fix the code first, then re-anchor (both sides in one commit) |
| Relationship gone entirely | `git mesh delete <name>` |
| Mesh has no why | `git mesh why <name> -m "<one sentence>"` (write during execution) |

*If a mesh needs to be deleted, invoke `git-mesh:git-mesh` — the command-reference section covers the `git mesh delete` contract. If source code needs fixing or you need to write a why, invoke `git-mesh:git-mesh` — the creating-a-mesh section covers the full create/update workflow and why-writing conventions.*

### 6. Confirm each DELETED anchor

For each DELETED finding:

- **File still exists but is shorter** → the anchored range was rewritten away. Read the file; if you find the equivalent code at new line numbers, record the remove-old/add-new commands.
- **File deleted entirely** → read the remaining anchors. If the relationship survives, plan to remove this anchor. If the relationship is gone, plan to delete the mesh. *(If deletion syntax is unfamiliar, invoke `git-mesh:git-mesh` — the command-reference section covers `git mesh delete`.)*

### 7. Assemble the work plan — one per component

For each component, you must have:

- Every mesh in the component
- Every CHANGED or DELETED anchor classified into one of the categories above
- Coordinated ranges for any file anchored by multiple meshes in the component
- The exact `git mesh remove` / `git mesh add` / `git mesh delete` / `git mesh why` commands to run, sorted mesh-at-a-time within the component
- The commit message for the final commit

**STOP here if any finding lacks a one-sentence confirmation.** Do not fork until every anchor has one.

---

## Phase 2 — Execution (one fork per component, all forks in parallel)

Fork one subagent per component. If there is 1 component, you get 1 fork. If there are N components, N forks run in parallel.

**No worktree isolation** — components are disjoint by construction (if two meshes shared a file, they'd be in the same component), so forks touch disjoint `.mesh/` files. They share the main worktree without conflict. Only the main agent commits at the end.

The fork prompt for each component:

```markdown
You are assigned one file-connected component of stale meshes to reconcile.
Only touch `.mesh/` files for the meshes listed below. Do not commit — the
main agent commits once after all components complete.

## Your meshes (component: <component-label>)
- <name-1>
- <name-2>

These meshes share anchored files. If they anchor the same file, coordinate
their ranges — they must be consistent.

## For each mesh

1. The why is in the stale output — note if empty. (Do not run `git mesh why <name>` to read it.)
2. Read current bytes at each stale anchor location
3. `git mesh history <name>` — compare `<current>` against anchored content
4. Write a one-sentence confirmation of the relationship
5. Classify and execute: remove old anchor, add new anchor at correct range (or
   same range to re-hash), delete the mesh, or report that code needs fixing first
6. `git mesh stale` — confirm this mesh no longer appears in output (ignore
   meshes assigned to other components)

## Rules
- Never bulk re-add every anchor to clear the exit code
- Each CHANGED finding requires its own one-sentence confirmation
- If multiple meshes anchor the same file, coordinate their ranges
- Stop and report if any finding cannot be confirmed
- Do NOT commit
```

### After all forks complete

```bash
git mesh stale     # must exit 0 with "0 stale"
git mesh doctor    # must report "no findings"
git add .mesh && git commit -m "Reconcile stale meshes"
```

If any fork reported a failure, or `git mesh stale` is non-zero, handle the failing component inline (its meshes are isolated from the successful components by definition, so only the failed component needs rework).

---

## Git allowlist

When resolving meshes in a shared worktree, restrict to: `git mesh …`, `git add .mesh[/<name>]`, `git commit -m` (never `-a` or `--amend`), `git checkout <commit-ish> -- .mesh/<name>`, and read-only `git status`/`git diff`/`git log`/`git show`. Never touch paths outside `.mesh/` or rewind HEAD.
</instructions>
