---
name: reconcile-stale-meshes
description: Reconcile stale git meshes surfaced by `git mesh stale`. Use when asked to "reconcile stale meshes", "fix stale meshes", "resolve mesh drift", "clean up stale meshes", or when `git mesh stale` exits non-zero with drift.
---

<instructions>

This skill splits into two phases with a hard boundary at the fork point: **research** (read-only, requires judgment — main agent) and **execution** (mutating `.mesh/` files, deterministic once decisions are made — forked subagent in an isolated worktree). The fork happens after every one-sentence confirmation is written and the exact commands are known, before the first `git mesh remove`.

---

## Phase 1 — Research (main agent, read-only)

Do not mutate any file. Every command in this phase is read-only.

### 1. Run `git mesh stale` (no `--fix`)

```bash
git mesh stale
```

Group findings by mesh name. Identify which anchors are CHANGED, DELETED, or `resolved, pending commit`.

### 2. Survey blast radius

For every file that appears in a stale anchor:

```bash
# Which meshes anchor this file? Cross-check you aren't missing a stale anchor.
git mesh list '<stale-file-path>'

# What else does each affected mesh anchor? Scope to the files involved —
# don't dump `tree '**'`. Depth 2 shows: the file, its sibling anchors, and
# one hop beyond (files those siblings co-anchor with elsewhere).
git mesh tree '<stale-file-path>' --depth 2
```

### 3. Confirm each CHANGED anchor

For each CHANGED finding:

1. Read the why: `git mesh why <name>`. Note if it's empty.
2. Read the current bytes at the anchored location with the Read tool.
3. Read the anchored bytes from history — start with just the `<current>` entry of `git mesh history <name>`, which compares HEAD against the working tree. Fetch full history only when the current-vs-anchored comparison is ambiguous.
4. **Write one sentence** stating what relationship the current bytes form relative to the mesh's purpose. If you cannot write it, stop — inspect further or plan to delete the mesh.

Classify each finding into exactly one category, and write the exact commands:

| Category | Commands |
|---|---|
| Bytes shifted, meaning preserved | `git mesh remove <name> '<path>#L<old>'` then `git mesh add <name> '<path>#L<new>'` |
| Content updated, same relationship | `git mesh remove <name> '<path>#L<N>'` then `git mesh add <name> '<path>#L<N>'` (same range, re-hash) |
| Content no longer describes relationship | `git mesh remove <name> '<path>#L<N>'` |
| One side of the relationship broke | Fix the code first, then re-anchor (both sides in one commit) |
| Relationship gone entirely | `git mesh delete <name>` |
| Mesh has no why | `git mesh why <name> -m "<one sentence>"` (write during execution) |

### 4. Confirm each DELETED anchor

For each DELETED finding:

- **File still exists but is shorter** → the anchored range was rewritten away. Read the file; if you find the equivalent code at new line numbers, record the remove-old/add-new commands.
- **File deleted entirely** → read the remaining anchors. If the relationship survives, plan to remove this anchor. If the relationship is gone, plan to delete the mesh.

### 5. Assemble the work plan

Before forking, you must have for every stale mesh:

- The mesh name
- Every CHANGED or DELETED anchor classified into one of the categories above
- The exact `git mesh remove` / `git mesh add` / `git mesh delete` / `git mesh why` commands to run, in mesh-at-a-time order
- The commit message

**STOP here if any finding lacks a one-sentence confirmation.** Do not fork until every anchor has one.

---

## Phase 2 — Execution (forked subagent, worktree isolation)

Fork a subagent with `isolation: "worktree"`. The worktree starts from a clean HEAD — the research phase didn't touch any files, so HEAD matches the working tree the research was based on.

The fork prompt must include the complete work plan: every command to run, the serial order, the verification check after each mesh, and the final commit message. The subagent does not redo research — it executes the plan.

```markdown
Execute the following stale-mesh reconciliation plan. Run commands in the
exact order given. Verify with `git mesh stale` after each mesh completes
before moving to the next. If any verification fails, stop and report the
failure — do not continue to the next mesh.

## 1. Auto-fix

```bash
git mesh stale --fix
```

If `--fix` changed nothing, note it. If it changed meshes:
- If `resolved, pending commit`: `git add <source-files> && git commit -m "..."` then `git add .mesh && git commit -m "..."`
- Otherwise: `git add .mesh && git commit -m "Re-anchor moved mesh anchors"`

Then `git mesh stale` again to confirm the remaining findings match the work plan.

## 2. Execute planned mutations

Process each mesh to completion before starting the next:

### Mesh: <name>
- [ ] `git mesh remove <name> '<path>#L<old>'`
- [ ] `git mesh add <name> '<path>#L<new>'`
- [ ] `git mesh why <name> -m "..."` (if needed)
- [ ] `git mesh stale` — confirm this mesh no longer appears

### Mesh: <name>
...

## 3. Final verification

```bash
git mesh stale     # must exit 0 with "0 stale"
git mesh doctor    # must report "no findings"
```

## 4. Commit

```bash
git add .mesh && git commit -m "Reconcile stale meshes"
```
```

The fork returns its result. If it succeeded, the main agent runs `git log --oneline -1` to confirm the commit landed.

---

## Git allowlist

When resolving meshes in a shared worktree, restrict to: `git mesh …`, `git add .mesh[/<name>]`, `git commit -m` (never `-a` or `--amend`), `git checkout <commit-ish> -- .mesh/<name>`, and read-only `git status`/`git diff`/`git log`/`git show`. Never touch paths outside `.mesh/` or rewind HEAD.
</instructions>
