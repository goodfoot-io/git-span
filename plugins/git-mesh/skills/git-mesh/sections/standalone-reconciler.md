# Standalone mesh reconciler agent

This section describes how to reconcile meshes when you are spawned as a
standalone agent from the dispatcher. You run unattended and detached, with no
user to answer questions or review output. You load the `git-mesh` skill for
command mechanics, and you operate inside a detached scratch worktree that the
dispatcher created for you.

## Context

The dispatcher already ran `git mesh stale --porcelain --batch` and
`git mesh list --porcelain --batch` against the record's anchors in the scratch
worktree. The findings are handed to you as part of your prompt. You never run
detection yourself.

Your job is judgment-only: reconcile stale anchors, create meshes for uncovered
writes, extend or prune related meshes, and write whys. The dispatcher handles
branch resolution, branch tips, commit ref publication, and retry.

## Your working directory

The dispatcher sets your cwd to the repository's **main/root worktree** (the
original clone, never a linked worktree that might be deleted).

You operate on the detached scratch worktree explicitly via `git -C
<scratch-path> ...`. Never `cd` into the scratch path — always use the `-C`
flag with `git` commands. This ensures your process does not depend on any
worktree path staying alive.

The scratch worktree is at a path like
`<git-common-dir>/git-mesh/scratch/<uuid>`. It is a detached checkout of the
resolved target commit. Your prompt includes this path.

## Allowed commands

All `git` commands must use `git -C <scratch-path> ...`. The following
restrictions apply:

### Allowed
- `git -C <scratch-path> mesh stale` — examine drift (read-only)
- `git -C <scratch-path> mesh list` — list meshes (read-only)
- `git -C <scratch-path> mesh show <name>` — view mesh details (read-only)
- `git -C <scratch-path> mesh why <name> -m "<why>"` — write/update a why
- `git -C <scratch-path> mesh add <name> <anchor> [<anchor> ...]` — add/re-anchor
- `git -C <scratch-path> mesh remove <name> <anchor>` — remove an anchor
- `git -C <scratch-path> mesh delete <name>` — retire a mesh
- `git -C <scratch-path> mesh move <old> <new>` — rename a mesh
- `git -C <scratch-path> add .mesh/<name>` — stage a mesh file
- `git -C <scratch-path> status` — inspect working tree state (read-only)
- `git -C <scratch-path> diff` — inspect changes (read-only)
- `git -C <scratch-path> log` — inspect history (read-only)

### Forbidden (error if attempted)
- Any shell command outside the patterns above.
- `git -C <scratch-path> add .` (stages source files)
- `git -C <scratch-path> commit -a` or `--amend`
- `git -C <scratch-path> reset` (any form)
- `git -C <scratch-path> checkout` / `git -C <scratch-path> restore` with
  non-`.mesh/<name>` pathspec.
- `git -C <scratch-path> clean`, `git -C <scratch-path> stash`,
  `git -C <scratch-path> rm`.
- Any `git push` variant.
- Any `Edit` or `Write` tool call touching a path outside the resolved mesh
  directory (the `.mesh/` directory or its configured equivalent).

## Commit boundary

- **Never touch source files.** Your work is confined to `.mesh/` files.
- **Commit only `.mesh` changes.** Your commit must include only mesh files.
- **Commit once per session.** After all reconciliations for the record are
  complete, stage and commit the `.mesh/` changes in a single commit.
- **Commit only once every file each anchor targets is already committed.**
  Because detection ran against a committed SHA, this invariant holds at the
  moment you start. If you add a new anchor that references a source file that
  is not yet committed in the scratch worktree, the mesh will be born stale.
  New anchors must reference files that exist in the resolved target commit.
- **One commit command:**
  ```
  git -C <scratch-path> add .mesh
  git -C <scratch-path> commit -m "<summary>"
  ```
  The dispatcher expects exactly one new commit on the scratch worktree's HEAD
  after you exit.

## Workflow

The dispatcher already classified the findings into one or more of these
categories and included them in your prompt:

### Stale meshes

`CHANGED` or `MOVED` anchors in the record's existing meshes. Follow the
standard reconcile workflow in `./responding-to-drift.md`:

1. Confirm the relationship still holds (read the anchored bytes in the scratch
   worktree, write one sentence stating what the current bytes form).
2. Re-anchor, reshape (add/remove anchors), or rewrite the why as needed.
3. If the relationship no longer exists, `delete` the mesh.

### Uncovered writes

Touched paths that are not covered by any existing mesh. Decide whether each
write represents an implicit dependency that should be tracked:

1. **Good mesh candidate** — the file was edited as part of a cross-boundary
   change (e.g., a request shape and its parser), or the edit introduced a
   dependency that a future collaborator needs to know about. Create a mesh
   with those anchors. See `./creating-a-mesh.md` for naming and anchor
   guidelines.
2. **Not a mesh** — the write was an isolated change with no cross-file
   implications. Leave it uncovered.

### Related meshes

Meshes that share one or more anchor paths with the record but were not
themselves flagged as stale. These may need extending (adding the new anchor
to an existing mesh) or pruning (removing an anchor that no longer belongs).

## Exit

After committing, exit normally. The dispatcher will:

1. Read the HEAD commit SHA from the scratch worktree.
2. Attempt an atomic compare-and-swap (`git update-ref`) to land your commit
   on the resolved target branch.
3. If the branch moved underneath the attempt, the dispatcher re-resolves,
   rebases your commit onto the new tip, and retries (bounded).
4. On success, the dispatcher deletes the claimed record and removes the
   scratch worktree.
5. If landing fails or the branch is no longer reachable, the dispatcher
   releases the record for a future retry and removes the scratch worktree.

## Best practices

- **Check state via `git -C <scratch-path> status` and `diff` before any
  mutation.** You operate detached and unattended; a mistake means the record
  is released for a future retry rather than being corrected interactively.
- **Prefer `git mesh show <name>` over reading `.mesh/<name>` directly.**
  `show` resolves config and renders anchors in their canonical form.
- **One mesh per `git mesh add` call** unless the mesh already has the anchors
  you are editing (use one `add` call to pass multiple anchors to one mesh).
- **Do not parallelize `git mesh add` against the same mesh name.** `add` has
  no locking around its read-modify-write of the mesh file.
- **Write a why for every new mesh.** `git mesh why` writes a durable
  definition of the subsystem the anchors form.
- **Do not rewrite a why on routine re-anchor.** Only rewrite when the
  subsystem itself changes.
- **Keep the commit summary short but descriptive.** The dispatcher logs the
  summary; it is the record of what this reconciliation did.

## Error handling

If something goes wrong — a command fails, the scratch worktree state is
unexpected — do not attempt to recover creatively. Log the issue via your exit
code (non-zero) and let the dispatcher release the record for a future retry.
Do not delete or discard the record yourself.
