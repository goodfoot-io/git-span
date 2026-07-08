# Standalone mesh reconciler agent

This section describes how to reconcile meshes when you are spawned as a
standalone agent from the dispatcher. You run unattended and detached, with no
user to answer questions or review output. You load the `git-mesh` skill for
command mechanics.

One agent handles the **entire** `post-commit/` backlog for this dispatcher
invocation, not a single record. You claim your own work, enter your own
worktree, run your own detection, and land your own commits — the dispatcher's
job ends at spawning you and sweeping up whatever you didn't finish.

## Context

Your prompt tells you four paths: the repo root, the resolved mesh directory,
the absolute `post-commit/` directory, and your own claim directory
(`post-commit/claimed/<claim-id>/`, empty when you start). Nobody else can
touch a file once it is inside your claim directory — that move *is* the
claim. The dispatcher did not run detection for you; you run `git mesh stale`
and `git mesh list` yourself, per record, after checking out that record's
commit.

## Step 1: Claim your work

List `.json` files in the `post-commit/` directory from your prompt. Move the
ones you intend to work on into your claim directory:

```
mv <post-commit-dir>/<record>.json <claim-dir>/
```

Once a file is in your claim directory, it is yours until you either delete it
(resolved) or leave it there when you exit (dispatcher returns it to
`post-commit/` for a future run). Claim as many records as you can reasonably
finish within your session — leaving some unclaimed in `post-commit/` for a
later run is fine and expected under load.

## Step 2: Enter your worktree

Call `EnterWorktree` **once** for the whole session — a single shared worktree,
not one per record. It branches off the repository root's current branch. You
will `git checkout <sha>` inside it per record (see Step 3), so the worktree's
starting branch is just a landing pad, not a per-record concern.

## Step 3: Reconcile each claimed record

For each record file in your claim directory, in turn:

1. `git checkout <record.sha>` inside your worktree (detached HEAD — this is a
   past commit, not the tip of your new branch).
2. Run `git mesh stale --porcelain --batch` and `git mesh list --porcelain
   --batch`, filtered to the record's anchors (pipe the anchor lines on
   stdin — see `./command-reference.md` for `--batch` usage).
3. Reconcile what you find:
   - **Stale meshes** (`CHANGED`/`MOVED` anchors) — follow
     `./responding-to-drift.md`: confirm the relationship still holds,
     re-anchor/reshape/rewrite the why, or `delete` the mesh if the coupling
     no longer exists.
   - **Uncovered writes** (anchor paths with no covering mesh) — create a mesh
     if the write is a genuine cross-file coupling (see `./creating-a-mesh.md`
     for naming/anchor guidelines); otherwise leave it uncovered.
   - **Related meshes** (share an anchor path but weren't flagged stale) —
     extend or prune as appropriate.
4. Commit: exactly one commit for this record's `.mesh/` changes.
   ```
   git add .mesh/**
   git commit -m "<summary>"
   ```
   Never stage or commit anything outside `.mesh/`.

## Step 4: Land it yourself

You are responsible for publishing your commit — there is no dispatcher-side
landing step anymore.

1. Rebase your `.mesh` commit onto the current tip of the record's target
   branch (`record.branch`).
2. Fast-forward the branch onto your rebased commit
   (`git checkout <branch> && git merge --ff-only <your-commit>`).
3. If the fast-forward fails because the branch moved again, retry the
   rebase once against the new tip. If it still fails, **do not force** —
   leave the record's file in your claim directory and move on to your next
   claimed record. A future dispatcher run will retry it.
4. On a successful land, delete the record's `.json` file from your claim
   directory — it is fully resolved.

Repeat Steps 3–4 for every record in your claim directory before exiting.

## Step 5: Exit

Call `ExitWorktree` to clean up your worktree, then exit. Anything still
sitting in your claim directory when you exit — because you didn't get to it,
or landing failed — is swept back to `post-commit/` by the dispatcher
unconditionally. You do not need to (and should not try to) do this yourself
as a separate step; just leave unresolved records where they are.

## Allowed commands

The agent shell is confined by these allowlist patterns from `dispatcher.ts`:

```
EnterWorktree
ExitWorktree
Bash(git checkout *)
Bash(git mesh *)                              # all mesh subcommands (add, stale, list, why, remove, delete, move, show, …)
Bash(git add .mesh/**)                        # stage .mesh files only
Bash(git commit *)
Bash(git rebase *)
Bash(git merge *)
Bash(git status)
Bash(git diff)
Bash(git log)
Bash(mv <post-commit-dir>/*.json <claim-dir>/)  # claim
Bash(mv <claim-dir>/*.json <post-commit-dir>/)  # release (rarely needed — prefer just leaving it)
Bash(rm <claim-dir>/*.json)                    # mark resolved
```

`<post-commit-dir>` and `<claim-dir>` are the exact absolute paths from your
prompt — the patterns only match those two directories, not arbitrary paths.
Edit/Write tool calls are scoped to `.mesh/**` inside any worktree under
`.claude/worktrees/` of this repo.

### Forbidden (error if attempted)
- Any shell command outside the patterns above.
- `git add .` (stages source files) or any `git commit -a`/`--amend`.
- `git reset` (any form), `git clean`, `git stash`, `git rm`.
- `git checkout`/`git restore` with a non-`.mesh/<name>` pathspec against
  anything other than switching commits/branches for landing.
- Any `git push` variant.
- Any `Edit`/`Write` call touching a path outside `.mesh/` in your worktree.

## Best practices

- **Check state via `git status`/`git diff` before any mutation.** You operate
  detached and unattended; a mistake means the record stays claimed (and gets
  swept back) rather than being corrected interactively.
- **Prefer `git mesh show <name>` over reading `.mesh/<name>` directly.**
  `show` resolves config and renders anchors in their canonical form.
- **One mesh per `git mesh add` call**, unless the mesh already has the
  anchors you're editing (pass multiple anchors to one `add` call instead).
- **Do not parallelize `git mesh add` against the same mesh name** — `add` has
  no locking around its read-modify-write of the mesh file. This matters more
  now than before: you may be processing several records that touch the same
  mesh within one session, so serialize your own `add` calls against it.
- **Write a why for every new mesh.** Only rewrite an existing why when the
  subsystem itself changed, not on a routine re-anchor.
- **Keep commit summaries short but descriptive** — they land on real branch
  history now, not just a dispatcher log line.

## Error handling

If something goes wrong on a record — a command fails, the worktree state is
unexpected, landing can't be made to succeed — do not attempt to recover
creatively and do not delete the record. Leave it in your claim directory and
move on to the next one; the dispatcher's post-exit sweep returns it to
`post-commit/` for a future run to retry.
