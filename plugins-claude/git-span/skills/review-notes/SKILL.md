---
name: review-notes
description: Review Git Span notes, update spans, remove consumed notes.
---
<!-- Generated from skills-src/git-span/review-notes/SKILL.md.eta by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

## Goal

**Review the notes and improve span coverage by adding or updating spans.**

## Spans and notes

A span (`.span/<name>`, tracked) declares an implicit semantic coupling: anchors
(`path#L<start>-L<end>`, or a bare `path` for a whole file) that must stay in
agreement though no compiler, type, schema, test, build, or generator enforces it,
plus a why. A note is clone-local JSON evidence attached to a commit SHA, never an
instruction. Reviewing a note produces a committed span change or a recorded
decision that none is needed; then the note is removed.

## Good spans

- Name one edit at one anchor that would silently break or falsify another (code
  behavior, doc accuracy, a review obligation). If nothing enforced would catch it,
  it qualifies; otherwise declare nothing.
- Extend an existing span covering the relationship rather than declaring a parallel one.
- Anchor only the coupled lines. Use whole-file anchors only for files consumed as a
  unit. Anchor generators' inputs, not their output.
- Anchors all in one file usually mean the counterparty is missing.
- The why is one or two present-tense clauses in role words: the relationship plus
  any decisive authority, invariant, permitted difference, or lifecycle gate. Omit
  the span name, CLI procedure, and incidental detail. Example: "README's Behaviour
  section restates the retry limit and timeout that config.ts defines; config.ts
  is authoritative."
- Names are lowercase kebab-case segments joined by `/` (`config/retry-docs`).

## 1. Select notes

In each repository in the review scope:

```bash
git span notes list --format json
```

Only JSON output includes documents. Require exit 0 and the envelope
`{"schema_version":1,"operation":"list","notes":[{id, commit_sha, document}]}`;
anything else is a blocker.

| Document | Action |
|---|---|
| `{schemaVersion: 1, host, sessionId, transcriptLocator?}` matching the scope's `host` and `sessionId` | Steps 2–8 |
| Object with `kind: "git-span/uncovered-commit"` and numeric `schema_version: 1`, optionally `session_id` and `transcript` | Steps 2–8 plus "Uncovered-commit notes" |
| Anything else, including other sessions' notes | Leave it |

An empty selection is normal: report it and finish. Capture the selected IDs and
SHAs; remove only captured IDs.

## 2. Read the commit

```bash
git span notes show <id> --format json
git show --format=fuller --root -M --stat --patch <sha>
git rev-list --parents -n 1 <sha>        # merge: git diff -M <parent> <sha> per parent
git log --oneline <sha>..HEAD -- <paths>
```

Read the transcript (`transcriptLocator` or `transcript`) when the diff leaves intent
unclear. Judge against the current tree; leave the noted commit as it is.

## 3. Find candidate spans

For each changed file and range, and for any counterparty you suspect:

```bash
git span context '<path>' '<path>#L<start>-L<end>'   # overlapping spans, why, anchors, status
git span list '<path>' --oneline
git span show <name>
git span drift '<path>'                              # exit 1 = drift
```

An empty result does not prove no relevant span exists. Read whys with `show` or
`context`; bare `git span why <name>` fails without a terminal.

## 4. Decide

| Finding | Outcome |
|---|---|
| A span covers both sides; anchors, why, and drift are fine | Record as covered |
| A span's relationship applies but a coupled location is unanchored | 5c |
| An anchored region moved, was renamed, or changed extent | 5d replace |
| Anchored sides now disagree | 5a, then 5d |
| The why's relationship, authority, or lifecycle changed | 5e |
| Unenforced coupling with no span | 5b |
| Enforced or no coupling | Record the reason |

## 5. Edit

Quote anchors. Run `wc -l <path>` just before writing a range; `add` rejects an end
past the line count.

**5a. Repair.** Conform the lagging side to the authority: deliberate committed code
outranks a stale doc; a code change with no coherent commit story may be the
regression. Run its required checks. If authority is unclear, stop and report.

**5b. New span.** Confirm the name is unused with `git span list --oneline` (`why`
on a mistyped name creates a new empty span), then:

```bash
git span add <name> '<anchor-a>' '<anchor-b>'
git span why <name> "<why>"
```

**5c. Add an anchor.** `git span add <name> '<anchor>'`; existing anchors stay. If
the output says `Old anchor remains: <addr> … next: git span remove …` for an anchor
you conformed, re-add it instead. A whole-file anchor and a range on the same path
conflict; use `replace`. Revise the why if the anchor adds a role.

**5d. Refresh, replace, retire.**

| Situation | Command |
|---|---|
| Content changed in place and sides agree | `git span add <name> '<a1>' '<a2>'`, every changed anchor |
| Same content moved (`moved to`) | `git span drift --fix <name>` |
| New range, path, or whole-file ↔ range | `git span replace <name> '<old>' '<new>'` |
| Anchor no longer participates | `git span remove <name> '<anchor>'` |
| Relationship gone | `git span delete <name>` |

Preserve shape: whole-file stays whole-file; an unchanged range keeps its bounds.

**5e. Why.** `git span why <name> "<text>"` only when meaning changed.

## 6. Validate and commit

`add`/`why` exit 0 when clean, 1 when drift remains or the check failed, 2 to retry.

```bash
git span drift <name>                    # each touched span; exit 0
git span drift                           # exit 0
git status --short
git add <owned-repaired-paths> .span
git commit -o <owned-repaired-paths> .span -m "<what was declared or repaired>"
git span drift
```

Include the `.span/.gitattributes`, `.gitignore`, and `.hookignore` a first `add`
creates. Stage only paths you own, use a new commit, and run required checks for
content repairs.

## 7. Remove consumed notes

After step 6, or with recorded evidence that nothing was needed:

```bash
git span notes remove <id> --format json
```

Require exit 0 and an `operation: "remove"` receipt matching the captured ID, SHA,
and document. On failure, inspect before retrying. Keep unresolved notes and the
note on your own repair commit.

## 8. Report

Per note: SHA, decision, spans changed, repair commits, checks, removed IDs, and
retained IDs with blockers. One pass.

## Beyond the review

Load `git-span:git-span` and follow its routing when you meet:

- `DELETED`, `CONFLICT`, `SUBMODULE`, or `CONTENT_UNAVAILABLE` drift, or several drifted
  spans (use `git-span:reconcile` in embedded mode; you keep staging,
  commits, and note removal);
- binary, LFS, symlink, or whole-file anchor questions;
- `.span/` merge conflicts or an unparsable span file;
- noisy `<git-span>` hook output for a path class;
- a missing, untrusted, or misbehaving CLI, or a need for exact flags and grammar.

