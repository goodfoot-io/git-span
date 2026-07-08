---
name: reconcile-stale-meshes
description: Reconcile stale git meshes surfaced by `git mesh stale`. Use when asked to "reconcile stale meshes", "fix stale meshes", "resolve mesh drift", "clean up stale meshes", or when `git mesh stale` exits non-zero with drift.
---

<instructions>

## 1. Run `git mesh stale --fix` first

```bash
git mesh stale --fix
```

This re-anchors MOVED anchors in place. `--fix` handles every MOVED anchor and whitespace-equivalent CHANGED anchor automatically. Two cases require manual review in Step 3:
- **CHANGED beyond whitespace** — the stored hash gates on content-equivalence. A `Changed` anchor whose content differs beyond whitespace is intentionally left drifting so the coupling resurfaces for human confirmation. The mesh file is untouched.
- **Anchored file has uncommitted changes that shift the anchored lines** — `--fix` re-anchors against the shallowest layer (HEAD) and preserves the original hash for in-file MOVED anchors, producing a consistent mesh file. `git mesh stale` reports `resolved, pending commit` — the mesh file is correct; commit the source file to converge fully. (Uncommitted edits on lines outside the anchored range don't cause issues in the first place.)

Commit the `--fix` results before proceeding:

**If `git mesh stale` reports `resolved, pending commit`**, the mesh file is consistent but source files have uncommitted changes. Commit the source files first, then the mesh:

```bash
git add <source-files> && git commit -m "Commit shifted source files"
git add .mesh && git commit -m "Re-anchor moved mesh anchors"
```

**Otherwise** (no `resolved, pending commit`), commit the mesh directly:

```bash
git add .mesh && git commit -m "Re-anchor moved mesh anchors"
```

## 2. Run `git mesh stale` again

The remaining findings are CHANGED (beyond whitespace), DELETED, and any `resolved, pending commit` anchors that `--fix` intentionally leaves for human confirmation. Group them by mesh name.

## 3. Resolve CHANGED anchors

For each CHANGED finding, confirm the relationship before touching the mesh:

1. Read the why: `git mesh why <name>`
2. Read the current bytes at the anchored location with the Read tool.
3. Read the anchored bytes: `git mesh history <name>` shows the original content under `<commit>` entries.
4. **Write one sentence** stating what relationship the current bytes form. If you cannot write it, stop — inspect further or delete the mesh.

Decision:
- **Bytes shifted, meaning preserved** → re-anchor: `git mesh add <name> '<path>#L<start>-L<end>'`
- **Content no longer describes the relationship** → remove the anchor: `git mesh remove <name> '<path>#L<start>-L<end>'`
- **One side of the relationship broke** → fix the broken code first, then re-anchor. Both sides in one commit.
- **Relationship gone entirely** → `git mesh delete <name>`

**STOP** — never bulk re-add every anchor to clear the exit code. Each CHANGED finding requires its own one-sentence confirmation.

## 4. Resolve DELETED anchors

For each DELETED finding:

- **File still exists but is shorter** → the anchored range was rewritten away. The logic may have moved. Read the file; if you find the equivalent code at new line numbers, remove the old anchor and add the new one:
  ```bash
  git mesh remove <name> '<path>#L<old-start>-L<old-end>'
  git mesh add <name> '<path>#L<new-start>-L<new-end>'
  ```
- **File deleted entirely** → read the remaining anchors. If the relationship survives without this anchor, remove it. If the relationship is gone, delete the mesh.

## 5. Commit and verify

```bash
git add .mesh && git commit -m "Reconcile stale meshes"
git mesh stale     # must exit 0 with no output
git mesh doctor    # must report "no findings"
```

**STOP** — if `git mesh stale` still exits non-zero, return to Step 3.

## Git allowlist

When resolving meshes in a shared worktree, restrict to: `git mesh …`, `git add .mesh[/<name>]`, `git commit -m` (never `-a` or `--amend`), `git checkout <commit-ish> -- .mesh/<name>`, and read-only `git status`/`git diff`/`git log`/`git show`. Never touch paths outside `.mesh/` or rewind HEAD.
</instructions>
