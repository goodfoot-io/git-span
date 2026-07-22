# Terminal statuses

Terminal statuses short-circuit the resolver — no slice math, no diff. The
real terminal status codes are `DELETED`, `CONFLICT`, and `SUBMODULE`;
`CONTENT_UNAVAILABLE` is covered separately in `./content-unavailable.md`.

## `DELETED`

**Cause.** The anchored path is absent from the content layer being resolved —
renamed, moved, or deleted, so there are no current bytes to compare against
the anchored bytes.

**First, check whether the anchored files still exist on disk.** A path that
moved is not the same as one that vanished:

```bash
git span <name>                  # list anchor paths
ls path/to/file1 path/to/file2   # check existence
```

**Per-span process.** For each `DELETED` span:

1. **Read the why.** `git span why <name>` — what subsystem does this span
   define?
2. **Inspect each current anchor and define the subsystem in one present-tense
   sentence.** Open the file at the recorded path and line range with `Read`
   (whole file, for whole-file anchors). If you cannot write that sentence, you
   have not confirmed — inspect further or `git span delete <name>`.
3. **Decide:**
   - Relationship still holds at a new location → re-anchor at the new extent
     (`git span remove <name> <old>` then `git span add <name> <new>`; see the
     "Re-anchor + retire" recipe in SKILL.md).
   - The related code diverged → fix it first, then re-anchor. Both sides land
     in the same commit.
   - The subsystem itself changed → write a new why
     (`git span why <name> -m "..."`), then re-anchor.
   - The relationship no longer exists → `git span delete <name>`.
   - Several spans need this at once → `references/triage.md`.
4. **Persist:**
   ```bash
   git add .span && git commit -m "Re-anchor <name>"
   ```

A user instruction like *"just re-add the anchors"* does not remove the
per-span confirmation in step 2. Do not script a bulk "add every anchor as-is"
loop over `git span list --porcelain`; that converts "this needs review" into
a clean exit code without anyone confirming the line ranges still bound the
right code.

## `CONFLICT`

**Cause.** The anchored path has no stage-0 index entry because a merge is in
progress and this file is unresolved (`git status` shows it unmerged, e.g.
`UU`).

**Fix.** Resolve the conflict in the **source** file first (`git add` it).
Once every source file an affected span anchors is conflict-free, run
`git span stale --fix` — it re-anchors `Moved` and whitespace-only `Changed`
anchors in place and structurally resolves any `.span/` file git itself left
marker-laden (anchors unioned, re-pointed, re-hashed against the resolved
worktree). You never hand-edit an `rk64:` hash. `--fix` fails closed —
reporting instead of guessing — when:
- a referenced source file still carries conflict markers, or
- the `--why` text diverged between ours and theirs with no merge base.

Finish the merge (`git add .span`, `git commit`) and run `git span stale`
again to confirm clean (0 findings, exit 0). See `./command-reference.md`
§ "Merge conflict resolution" for the optional `merge-driver` accelerator that
collapses the easy conflicts during `git merge` itself, and for the exact
fail-closed shape.

## `SUBMODULE`

**Cause.** An anchor points *inside* a submodule, or a path anchored as a
plain file/directory was later promoted to a submodule (gitlink). git-span
does not open submodules to compare line ranges.

**Fix.**
```bash
git span remove <name> '<submodule-path>/inner/file.ts#L10-L20'
# Either: whole-file pin on the submodule root
git span add <name> <submodule-path>
# Or: pin a parent-repo path that witnesses the same relationship
git add .span && git commit -m "Re-anchor <name> off submodule internals"
```

Whole-file anchors on a submodule *root* (the gitlink path) are supported — the
resolver compares gitlink SHAs without opening the submodule.

**Note.** A line-range anchor whose path already sits inside a submodule at
anchor-creation time is refused by `git span add` itself, so it never reaches
`stale`. A directory that gets promoted to a submodule *after* anchors already
exist inside it is correctly classified as `SUBMODULE` by `stale` — check
`git ls-files -s <path>` for mode `160000` (gitlink) to confirm you're in this
case before applying the fix above.
