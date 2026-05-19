# Terminal statuses

Terminal statuses short-circuit the resolver — no slice math, no diff. Each one
has a specific cause and a specific fix. The real terminal statuses are
`DELETED`, `MERGE_CONFLICT`, and `SUBMODULE`; `CONTENT_UNAVAILABLE(...)` is
covered separately in `./content-unavailable.md`.

## `DELETED`

**Cause.** The anchored path is absent from the content layer being resolved —
the file (or its anchored range) was renamed, moved, or deleted, so there are
no current bytes to compare against the anchored bytes.

**First, check whether the anchored files still exist on disk.** A path that
moved is not the same as one that vanished. Use `ls` (or `Read` for content) on
each anchored path:

```bash
git mesh <name> --oneline        # list anchor paths compactly
ls path/to/file1 path/to/file2   # check existence
```

**When you have located the current state, confirm the relationship still
holds and re-anchor at current bytes.** Do not script a bulk "add every anchor
as-is" loop over `git mesh list --porcelain`; that erases the prompt without
doing the work the prompt exists for. Each mesh needs its own decision.

A user instruction like *"just re-add the anchors"* removes nothing about the
per-mesh confirmation below. If the shorthand sounds like a license to batch,
that is the moment to slow down and surface the conflict, not script the loop.

**Per-mesh process.** For each `DELETED` mesh:

1. **Read the why.** What relationship does this mesh claim?
   ```bash
   git mesh why <name>
   ```
2. **Inspect each current anchor and write the relationship in one sentence.**
   Open the file at the recorded path and line range with `Read` (whole file,
   for whole-file anchors). State in one sentence what relationship the
   *current* bytes at those anchors form. If you cannot write that sentence,
   you have not confirmed; do not re-anchor — inspect further or
   `git mesh delete <name>`.
3. **Decide per the drift rules in `./responding-to-drift.md`:**
   - Relationship still holds at a new location → re-anchor at the new span
     (`git mesh remove <name> <old>` then `git mesh add <name> <new>`).
   - The related code diverged → fix it first, then re-anchor. Both sides land
     in the same commit.
   - The subsystem itself changed → write a new why
     (`git mesh why <name> -m "..."`), then re-anchor.
   - The relationship no longer exists → `git mesh delete <name>`.
4. **Persist:**
   ```bash
   git add .mesh && git commit -m "Re-anchor <name>"
   ```

Bulk loops that re-add every recorded anchor verbatim are an anti-pattern:
they convert "this needs review" into a clean exit code without anyone
confirming the line ranges still bound the right code.

## `MERGE_CONFLICT`

**Cause.** The path has no stage-0 index entry because a merge is in progress
and this file is unresolved.

**Fix.** Finish the merge (resolve conflicts, `git add`, `git commit`). Run
`git mesh stale` again.

## `SUBMODULE`

**Cause.** An anchor points *inside* a submodule. git-mesh does not open
submodules to compare line ranges.

**Fix.** Remove the anchor and re-pin at the appropriate level:
```bash
git mesh remove <name> '<submodule-path>/inner/file.ts#L10-L20'
# Either: whole-file pin on the submodule root
git mesh add <name> <submodule-path>
# Or: pin a parent-repo path that witnesses the same relationship
git add .mesh && git commit -m "Re-anchor <name> off submodule internals"
```

Whole-file anchors on a submodule *root* (the gitlink path) are supported — the
resolver compares gitlink SHAs without opening the submodule.
