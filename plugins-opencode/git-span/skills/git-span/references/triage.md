# Multi-span / uncertain-coupling triage

1. Run `git span drift` once. For each drifted span, run `git span history <name>`
   once; it covers every anchor. Use its live-drift diffs to identify byte changes,
   `drift source` (`sources` in JSON) to identify observing layers, and its timeline to
   establish provenance. `HEAD` alone does not prove a change was committed.
2. Read current anchor content and confirm the relationship. History does not locate a
   CHANGED anchor's destination; use a targeted old/current file diff only when its
   logical region moved.
3. Resolve by row:

| Finding | Resolution |
|---|---|
| Moved | `git span drift --fix <name>` |
| Changed; anchors still agree at the same address | `git span add <name> <same-anchor>`; preserve its exact shape |
| Changed whole-file anchor; the file is still consumed as a unit | `git span add <name> <same-bare-path>`; whole-file stays whole-file |
| Changed; logical region moved | Locate its new extent, then `replace <old-anchor> <new-anchor>` |
| Changed; the file shrank below the anchored end but the region still exists | `replace <old-anchor> <new-anchor>` with the new extent equal to the file's current line count — an identity change, not a narrowing |
| One anchor lags a confirmed authority | Conform it, validate any code change, then re-anchor |
| Lifecycle gate satisfied | Make the authorized change, revise or retire the why, and reconcile or retire superseded anchors |
| Authority unclear or no intentional change explains drift | Identify the requirement or authorised change, its source/revision, scope and consumer. Committed code shows intent, not authority to supersede it. Cite a justified supersession before changing prose; otherwise retain and report the conflict. Continue safe scoped work; do not re-anchor over disagreement |
| Coupling gone | `git span delete <name>`; do not re-anchor unrelated bytes |
| No drift finding | Declare an undeclared coupling only if it meets the parent skill's eligibility rule |

4. Require scoped zero drift after each span and full zero drift before commit.
5. `git add <changed-paths> .span && git commit -o <changed-paths> .span -m "..."`.
