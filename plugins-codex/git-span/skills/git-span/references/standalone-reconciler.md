# Standalone span reconciler agent

This section describes how spans are reconciled when you are spawned as a
standalone agent from the post-commit dispatcher. You run unattended and
detached, with no user to answer questions or review output. Your spawn prompt
is authoritative for procedure — if this section and the prompt disagree, the
prompt wins. Load the rest of the `git-span` skill for judgment calls:
`SKILL.md`'s core gotchas and recipes for single-span work, `references/triage.md`
for classifying multiple drifted/uncertain spans.

One agent handles the `post-commit/` backlog for a dispatcher invocation, not
a single record. You claim your own work, enter your own worktree, run your
own detection, and land your own commits — the dispatcher's job ends at
spawning you and sweeping up whatever you didn't finish.

## Context

Your prompt tells you four paths: the repo root, the resolved span directory,
the absolute `post-commit/` directory, and your own claim directory
(`post-commit/claimed/<claim-id>/`). Nobody else touches a record once it is
inside your claim directory — that move *is* the claim. Records are JSON:
`{anchors, created_at, sha, branch}`. The anchor ranges are the union of lines
a session touched, not the commit's diff — hints, not exact extents. Extract
fields with `jq -r` rather than hand-copying SHAs.

## Claim, then work at the branch tip

Read the pending records first, group them by `branch`, and claim whole branch
groups (`mv` into your claim directory). Claim what you can finish; anything
left in `post-commit/` stays available for later runs.

Call `EnterWorktree` **once** for the whole session. Work each group at the
**tip of its branch** (`git checkout --detach <branch>`), not at any record's
`sha`:

- The tip has the current `.span` tree. Detection at an old `sha` cannot see
  spans landed since, so you would re-create coverage that already exists.
- `git span add` hashes anchors against HEAD, so anchors added at the tip are
  fresh where they land — a span committed at an old `sha` can be born stale
  at the tip.

The record's `sha` is still useful — as an ancestry check
(`git merge-base --is-ancestor <sha> <branch>`; leave non-ancestor records in
your claim directory untouched) and as a pointer to what the commit changed.

## Detect, reconcile, verify

Dedupe the group's anchor paths and run, with paths as explicit arguments
(no `#L` ranges on `stale` — a path with a `#L` suffix errors as untracked;
pass bare paths only):

```
git span stale --fix -- <paths>          # auto-repair moved/whitespace drift
git span stale --format porcelain -- <paths>
git span list <paths> --oneline
```

Both `stale` commands print a summary line and exit 0 when clean — exit 0 is
not silence, it's the confirmation. `stale --fix` exits non-zero whenever any
finding survives, even after it repairs others; judge by the printed output
(what's still reported), not the exit code alone.

Classify into **stale anchors**, **related spans** (an existing span anchors
one of the paths), and **uncovered writes** (no span anchors the path), then
resolve using `references/triage.md`'s classification table (Moved / Changed+
still-coupled / Changed+feature-gone / undeclared) and, for undeclared
coupling, `SKILL.md`'s "Declare a new coupling" recipe. Most uncovered writes
correctly produce nothing. A record none of whose paths produced a finding is
resolved — delete its file from your claim directory immediately.

Re-run `git span stale --format porcelain -- <paths>` and confirm your paths
are clean before committing.

## Commit and land it yourself

One commit per branch group, `.span/` paths only:

```
git add .span && git commit -m "<summary>"
```

Then publish it — there is no dispatcher-side landing step:

1. If the branch moved while you worked, `git rebase <branch>`. On a `.span/`
   conflict: confirm the anchored sources are conflict-free, run
   `git span stale --fix`, continue, and re-check staleness after.
2. Fast-forward: `git checkout <branch> && git merge --ff-only <commit>`.
   When checkout is refused because the branch is checked out at the repo
   root (the usual case for the default branch), run
   `git -C <repo-root> merge --ff-only <commit>` instead.
3. If the fast-forward fails, retry once from step 1; then **do not force** —
   leave the group's remaining record files in your claim directory and move
   on. A future dispatcher run retries them.
4. On success, delete the group's record files from your claim directory.

## Exit

Call `ExitWorktree` with `action: "remove"`. You finish on a detached HEAD, so
it may refuse to remove; confirm your commit is on the branch
(`git merge-base --is-ancestor <commit> <branch>`), then re-invoke with
`discard_changes: true`. Anything still in your claim directory when you exit
is swept back to `post-commit/` by the dispatcher — leave unresolved records
where they are.

## Constraints

You are spawned with a permission deny list (see `buildClaudeArgs` in
`packages/agent-hooks/src/dispatcher.ts`) — there is no shell allowlist; the
prompt itself is what confines you. The standing rules:

- Never modify, stage, or commit anything outside `.span/`. No `git add .`,
  no `-a`, no `--amend`, no `reset`/`clean`/`stash`, no push.
- **Concurrent `git span add` calls against the same span name are NOT safe
  in this build** — a known read-modify-write race can silently drop an
  anchor when two `add` calls race on the same span file (no lock protects
  it). Never issue overlapping `add` calls against one span name, including
  across separate reconciler instances that might touch the same span:
  batch every anchor for a span into a single `git span add <name> <anchor1>
  <anchor2> ...` call instead of several.
- Write a why for every span you create; rewrite an existing why only when the
  subsystem itself changed.
- If a command fails in a way you cannot cleanly resolve, or you cannot
  confirm a relationship either way, do not improvise — leave the record in
  your claim directory and move on.
