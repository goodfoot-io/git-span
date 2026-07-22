# Corpus-wide why cleanup campaign

For sweeping every span in `.span/**` up to the writing-span-whys standard (one
present-tense sentence, subject+verb, role words, no rules/warnings/review steps —
those live in comments at anchor sites). Batch 3-6 spans per pass; multiple batches
can run in parallel if their span sets don't share anchor files (a shared file means
one batch's `stale --fix` can silently re-anchor the other's span too — see Gotchas).

## Preflight
`git status .span` before starting. Anything already modified is another
session's work, not yours — never attribute it to this batch's diff.

## Triage
Dump whys in one pass, batch history lookups by path class (not per file):
```bash
cd .span && for f in $(find . -type f ! -name "*.sh" ! -name ".*" ! -name dispatcher.log); do
  echo "=== $f ==="; awk 'flag{print} /^$/{flag=1}' "$f"; done
```
Classify each span, skip `clean`:

| Class | Signal | Action |
|---|---|---|
| clean | complete present-tense sentence, factually accurate, no colon/rules | skip — don't polish wording for its own sake |
| empty | why is blank | write one |
| label-colon | `Label: description` instead of a sentence | rewrite as subject+verb |
| work-order | carries invariants, "must change/stay in sync", review triggers — even as a trailing clause on an otherwise-clean sentence | trim the instruction, keep only the definition |
| stale-claim | asserts a fact about code that may have changed (a mechanism, a count, a "fixed" problem) | verify against current anchor bytes; rewrite or use `git span history <name>` if creation-vs-current is unclear |
| vague | true but generic; a leading blank line inside a triple-quoted why string is this class too (cosmetic, not meaningful) | tighten / strip the artifact |
| stale-range | anchor content shifted but still the same logical site | `stale --fix` (Moved / whitespace-only Changed) or manual re-anchor (real content drift) |
| mis-anchored | anchor range points at the WRONG code entirely — the why describes something living elsewhere in the file. `stale` reports 0 drift for this (the hash matches the wrong bytes) — it is caught only by reading the anchor against the why's claims, never by `stale` alone | `grep -n <symbol from the why>` in the target file to find the real site, then re-anchor (add new range, remove old) |
| duplicate/overlap | two spans assert the same coupling | consolidate (Operations table) |
| bad-name | non-kebab-case or reserved name | `git mv .span/<old> .span/<new>`; grep the repo for the old name first (docs/comments/skills may reference it) |

## Procedure per batch
1. `git span <name>` per pick (full TOML, no compact form).
2. Read anchored line ranges in one parallel batch. For a whole-file or
   near-whole-file range (hundreds+ lines), skip full reads: check the header/doc
   comment plus `grep` for the why's specific nouns (function/counter names)
   instead of reading it all.
3. Draft whys. Check every factual clause against current anchor bytes.
4. Comment retrofit for a work-order tail's dropped rule: necessary only if
   NO anchor and no doc already states that specific rule (not just related
   context). If the anchor's file format can't carry comments (JSON, etc.),
   the retrofit must land on a sibling anchor or an already-documenting file —
   confirm one exists rather than skipping silently.
5. Apply: all `git span why <name> -m "..."` in one chained command, then
   comment edits, then re-anchoring (comments before re-anchoring so one pass
   covers both). A comment edit that shifts an anchor's line count needs its
   own re-anchor check immediately after — don't assume a later blanket
   `--fix` will catch it.
6. Verify: `git span stale` scoped by the batch's **span names**, not by
   touched file paths — path-scoping surfaces unrelated spans that merely
   share a file and reads as false drift. Expect 0 stale. A span shown
   modified in `git status` with an empty `git diff HEAD -- <path>` is inert
   noise from another session, not a finding.
7. A behavioral code fix is out of scope — report it, don't make it.

## Gotchas
- `stale --fix` reconciles every span anchored to the file it touches, not
  just the one you're fixing — diff the full set of spans it reports, not
  only your target.
- `stale --fix` no-ops ("Reconciled 0 spans") on a non-trivial change even
  when it *looks* like a pure shift — don't retry it; re-anchor manually
  (`add` new range, `remove` old) once.
- Anchor ranges can drift between your inspect step and your fix step
  (another concurrent edit, or your own earlier comment insert) — re-run
  `git span <name>` immediately before `git span remove` to get the live
  range, don't reuse a range noted earlier.
- Re-anchoring a range doesn't imply the why is still accurate — if the
  range change was needed because the code moved or changed, re-check the
  why's factual clauses in the same pass.
- Repeated anchors across sibling spans documenting one doc/subsystem family
  are by design, not a duplicate/overlap smell.

## Operations
| Operation | Command |
|---|---|
| Rewrite/write why | `git span why <name> -m "..."` |
| Re-anchor, pure line-shift | `git span stale --fix` |
| Re-anchor, range/content changed | `git span add <name> <path#Lnew>` then `git span remove <name> <path#Lold>` — add appends, never replaces |
| Re-hash whole-file anchor | `git span add <name> <path>` |
| Consolidate duplicates | `git span add` the loser's anchors onto the keeper, then `git span delete <loser>`; merge the whys into one definition |
| Rename | `git mv .span/<old> .span/<new>` |
| Delete | `git span delete <name>` when no real coupling remains — if you can write the definition sentence after inspecting the anchors, keep it instead |

## Validation
- Why rewrites and `.span/**` edits: no validation.
- Comment-only source edits: no validation.
- Any behavioral code change: out of scope — flag it instead.
- End of campaign: full `git span stale` exit 0 and `git span doctor` clean.

## Report
Per span: classification → action (old why → new why for rewrites). List every
file touched, including source files touched only for comment retrofits.
