# Corpus-wide why cleanup campaign

Apply the parent skill's why standard across `.span/**`. Batch 3-6 spans per pass; batches
can run in parallel if their span sets don't share anchor files (a shared file means
one batch's `drift --fix` can silently re-anchor the other's span too — see Gotchas).

## Preflight
`git status .span` before starting. Anything already modified is another
session's work, not yours — never attribute it to this batch's diff.

## Triage
Dump whys through the CLI; run history once per span only when provenance is unclear:
```bash
git span list
```
Classify each span, skip `clean`:

| Class | Signal | Action |
|---|---|---|
| clean | meets the parent skill's standard and is accurate at every anchor | skip — don't polish |
| empty | why is blank | write one |
| label-fragment | `Label: fragment` without a subject and verb | rewrite as a complete clause; keeping the label is optional |
| work-order | generic procedure instead of decision context | remove the procedure; retain decisive nonlocal facts |
| drift-claim | asserts a fact about code that may have changed (a mechanism, a count, a "fixed" problem) | verify against current anchor bytes; rewrite or use `git span history <name>` if creation-vs-current is unclear |
| lifecycle-gate | behavior is conditional on named evidence | Verify the evidence. Preserve behavior and why when the gate is unmet, invalidated, or unavailable. When satisfied, make the authorized change, then revise or retire the why and every superseded anchor |
| vague | true but generic; a leading blank line inside a triple-quoted why string is this class too (cosmetic, not meaningful) | tighten / strip the artifact |
| drift-range | anchor content shifted but still the same logical site | `drift --fix` (Moved / whitespace-only Changed) or manual re-anchor (real content drift) |
| mis-anchored | anchor range points at the WRONG code entirely — the why describes something living elsewhere in the file. `drift` reports 0 drift for this (the hash matches the wrong bytes) — it is caught only by reading the anchor against the why's claims, never by `drift` alone | Find the real site, remove the old range, then add the new one |
| duplicate/overlap | two spans assert the same coupling | consolidate (Operations table) |
| generated-output | a script or generator writes an anchored path and nobody hand-edits it | drop the output anchors, keep the producer↔consumer contract |
| mirror-bundle | ≥2 basename pairs of *near-identical copies* across two roots differing by one path segment, no anchored enforcer. Surfaces that restate one rule in their own register are distinct roles, not this class | keep ONE span (`add` rejects directory roots). Parity check exists: anchor the normative side's files plus the check. No check: the span *is* the parity mechanism — keep both sides of each pair, name the normative direction in the why, and recommend building a check; dropping the mirror side removes the only drift detection. Tree too large to enumerate (dozens of pairs): anchor one representative pair and say in the why it stands for the tree. Never split per pair, never delete |
| single-file | every anchor is a range in one file | add the counterparty the why names; delete only if none exists |
| open-set registry | one anchor's content is a *list* of the other anchors — tells: "and others", "when ⟨members⟩ are added", "enumerating", "documents each" | **advisory, never auto-reject.** Distinguish a shared obligation ("every X must …" — keep) from a listing obligation ("every X is enumerated here" — narrow to the co-varying core, or hand the list to the tooling that owns it) |
| bad-name | non-kebab-case or reserved name | `git mv .span/<old> .span/<new>`; grep the repo for the old name first (docs/comments/skills may reference it) |

## Procedure per batch
1. `git span <name>` per pick (full TOML, no compact form).
2. Read anchored line ranges in one parallel batch. For a whole-file or
   near-whole-file range (hundreds+ lines), skip full reads: check the header/doc
   comment plus `grep` for the why's specific nouns (function/counter names)
   instead of reading it all.
3. Draft whys. Verify every clause against current anchors or evidence named by a gate.
4. Relocate removed procedure only when a load-bearing site needs it. Keep decisive
   nonlocal context in the why.
5. Apply: all `git span why <name> "..."` in one chained command, then
   comment edits, then re-anchoring (comments before re-anchoring so one pass
   covers both). A comment edit that shifts an anchor's line count needs its
   own re-anchor check immediately after — don't assume a later blanket
   `--fix` will catch it.
6. Verify: `git span drift` scoped by the batch's **span names**, not by
   touched file paths — path-scoping surfaces unrelated spans that merely
   share a file and reads as false drift. Expect 0 drift. A span shown
   modified in `git status` with an empty `git diff HEAD -- <path>` is inert
   noise from another session, not a finding.
7. Make behavior changes decided by a confirmed authority or satisfied gate;
   otherwise stop on ambiguity. After a gate transition, revise or retire the why
   and every superseded anchor. Preserve behavior and why when its evidence is
   unmet, invalidated, or unavailable. Require scoped zero drift either way.

## Gotchas
- `drift --fix` reconciles every span anchored to the file it touches, not
  just the one you're fixing — diff the full set of spans it reports, not
  only your target.
- `drift --fix` no-ops ("Reconciled 0 spans") on a non-trivial change even
  when it *looks* like a pure shift — don't retry it; re-anchor manually
  (remove the old range, then add the new one) once.
- Anchor ranges can drift between your inspect step and your fix step
  (another concurrent edit, or your own earlier comment insert) — re-run
  `git span <name>` immediately before `git span remove` to get the live
  range, don't reuse a range noted earlier.
- Re-anchoring a range doesn't imply the why is still accurate — if the
  range change was needed because the code moved or changed, re-check the
  why's factual clauses in the same pass.
- Repeated anchors across *sibling spans* documenting one doc/subsystem family
  are by design, not a duplicate/overlap smell. Repeated *instances of one kind
  inside a single span* are the smell — see the mirror-bundle and single-file rows.

## Operations
| Operation | Command |
|---|---|
| Rewrite/write why | `git span why <name> "..."` |
| Re-anchor, pure line-shift | `git span drift --fix` |
| Refresh changed content at the same logical address | `git span add <name> <path#Lsame>` — preserve the exact existing anchor shape |
| Re-anchor, path/range identity changed | `git span remove <name> <path#Lold>` then `git span add <name> <path#Lnew>` — add appends, never replaces |
| Re-hash whole-file anchor | `git span add <name> <path>` |
| Consolidate duplicates | `git span add` the loser's anchors onto the keeper, then `git span delete <loser>`; merge the whys into one definition |
| Rename | `git mv .span/<old> .span/<new>` |
| Delete | `git span delete <name>` when no real coupling remains; keep it only if you can confirm the relationship |

## Validation
- Why, `.span/**`, and comment-only edits require no package checks; scoped
  `git span drift <name>` must still exit 0 after every batch.
- Behavioral changes require the repository's code validation.
- End of campaign: full `git span drift` exit 0 and `git span doctor` clean.

## Report
Per span: classification → action (old why → new why for rewrites). List every
file touched, including source files touched only for comment retrofits.
