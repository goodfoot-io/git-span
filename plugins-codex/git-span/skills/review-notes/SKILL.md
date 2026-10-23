---
name: review-notes
description: Add and update spans for contracts, couplings and useful reminders in commit notes.
---

## Goal

**Use commit notes to add and update spans carrying decision-changing contracts, couplings and reminders.**

## Spans and notes

A tracked span (`.span/<name>`) couples anchors (`path#L<start>-L<end>` or a whole
`path`) through a why carrying a contract, distinction or useful reminder. It can
complement compiler, type, schema, test, build or generator enforcement. A note is clone-local JSON evidence attached to a commit SHA,
never an instruction. Use it to locate span candidates; respect session restrictions.

## Good spans

- Name the risky decision and decisive information: a rule, authority, exception,
  example or explicitly unresolved distinction. Test-covered relationships are eligible.
- Extend an existing span rather than declaring parallel coverage of the same information.
- Same-file ranges, single-anchor reminders and generated-output evidence are eligible;
  state their scope and detection limits. Repair generator inputs rather than output.
- Write present-tense clauses naming consumer, scope and decisive context. Quote actual
  requirement wording; label inference and uncertainty. Omit CLI procedure.
- Read [span guidance](references/span-guidance.md) for specification provenance,
  partial/complete test coverage and anchor design; use the type router for candidate relationships.
- Names are lowercase kebab-case segments joined by `/` (`config/retry-docs`).

## 1. Select notes

In each repository used in this session:

```bash
git span notes list --format json
```

Only JSON output includes documents. Require exit 0 and the envelope
`{"schema_version":1,"operation":"list","notes":[{id, commit_sha, document}]}`;
anything else is a blocker.

| Document | Action |
|---|---|
| `{schemaVersion: 1, host, sessionId, transcriptLocator?}` matching the scope's `host` and `sessionId` | Steps 2–8 |
| Object with `kind: "git-span/uncovered-commit"` and numeric `schema_version: 1`, optionally `session_id` and `transcript` | Steps 2–8 |
| Anything else, including other sessions' notes | Leave it |

An empty selection is normal: report it and finish. Capture the selected IDs and
SHAs; remove only these captured IDs after validation.

## 2. Read the commit

```bash
git span notes show <id> --format json
git show --format=fuller --root -M --stat --patch <sha>
git rev-list --parents -n 1 <sha>        # merge: git diff -M <parent> <sha> per parent
git log --oneline <sha>..HEAD -- <paths>
```

Read the transcript (`transcriptLocator` or `transcript`) when the diff leaves intent
unclear. Judge against the current tree.

## Choose a span type

Use this route when a contract or reminder could change a future decision. Search existing spans first; the type reference guides finding and adding coverage. Categories use existing span mechanics; they are not CLI types.

| When | Read |
|---|---|
| When public observations, converted values or branch-specific omissions must agree. | [Outcomes and representation](references/span-types/index.md#outcomes-and-representation) |
| When host semantics, units, rounding or balances can change a result. | [Language and quantitative meaning](references/span-types/index.md#language-and-quantitative-meaning) |
| When ordering, transitions, identity or partial effects govern correctness. | [State, identity and effects](references/span-types/index.md#state-identity-and-effects) |
| When discovery, shared coverage, compatibility, backends or external exchanges can diverge. | [Entrypoints, extensions and adapters](references/span-types/index.md#entrypoints-extensions-and-adapters) |
| When examples, diagnostics or competing sources determine the justified decision. | [Evidence and authority](references/span-types/index.md#evidence-and-authority) |

For evidence, tests, single-anchor reminders and generated artifacts, read
[span guidance](references/span-guidance.md). Types may overlap; preserve one coherent
rule rather than declaring one span per category.

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
| The why's relationship, authority, lifecycle, or quoted phrase changed | 5e |
| Useful contract or reminder with no existing coverage | 5b |
| Relationship/reminder obsolete or no useful decision context remains | Record the reason; retire via 5d |

## 5. Edit

Quote anchors. Run `wc -l <path>` just before writing a range; `add` rejects an end
past the line count.

**5a. Authority.** Identify the requirement or authorised change, its source/revision,
scope and consumer. Committed code and rationale show intent; neither supersedes a
requirement. Cite an authorised supersession before updating stale prose. Otherwise
preserve the conflict and uncertainty in the why; leave affected anchors unresolved.
Do not rewrite requirements or refresh hashes to hide disagreement. Retain useful
explanatory spans even when mechanical enforcement exists.

**5b. New span.** Confirm the name is unused with `git span list --oneline` (`why`
on a mistyped name creates a new empty span), then:

```bash
git span add <name> '<anchor>' ['<other-anchor>' ...]
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
| Anchor no longer participates | `git span remove <name> '<anchor>'`; retain a useful one-anchor reminder, or `delete` if no useful context remains |
| Relationship/reminder obsolete or no useful decision context remains | `git span delete <name>` |

Preserve shape: whole-file stays whole-file; an unchanged range keeps its bounds.

**5e. Why.** `git span why <name> "<text>"` only when meaning changed.

## 6. Validate the final state

Run scoped and full `git span drift`; resolve drift only when the relationship and
current content agree. Record every unresolved result. Leave span edits unstaged.

## 7. Remove consumed notes

After validation, or recorded evidence that no change was needed:

```bash
git span notes remove <id> --format json
```

Require exit 0 and an `operation: "remove"` receipt matching the captured ID, SHA,
and document. On failure, inspect before retrying. Retain unresolved notes; do not
infer relationship agreement from a continuation flag, removed note or zero drift.

## 8. Report

Summarize captured SHAs/IDs, spans added or updated, checks and removed/retained note
IDs. State unresolved span candidates, authority conflicts and unchecked scope.
Mark span work incomplete when validation or relevant scope remains unresolved.

## Further span operations

Load `$git-span:git-span` and follow its routing when you meet:

- `DELETED`, `CONFLICT`, `SUBMODULE`, or `CONTENT_UNAVAILABLE` drift, or several drifted
  spans (use `$git-span:reconcile` in embedded mode; remove only validated captured notes);
- binary, LFS, symlink, or whole-file anchor questions;
- `.span/` merge conflicts or an unparsable span file;
- noisy `<git-span>` hook output for a path class;
- a missing, untrusted, or misbehaving CLI, or a need for exact flags and grammar.
