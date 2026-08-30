<!-- Generated from skills-src/git-span/git-span/references/why-cleanup-campaign.md.eta by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

# Corpus-wide why cleanup campaign

Apply the why standard across `.span/**`: one or two complete, present-tense
clauses stating the shared relationship plus its decisive nonlocal facts —
authority, intentional difference, invariant, lifecycle state, completion
gate, focused verification — with clear modal or evidentiary force. Labels are
optional but must introduce complete clauses. Prefer a stronger enforceable
mechanism (type, schema, test, lint, CI) over a span when one covers the
requirement. Keep the smallest decision-preserving statement, roughly 15–35
body tokens.
Work has two phases: the main agent triages and partitions; forked subagents
execute — the same fork-per-component mechanism as the reconcile skill. Only
the main agent commits.

Work is partitioned by **file-connected components** — clusters of non-clean
spans that share at least one anchored file. Each component maps to one or more
forks, all running in parallel: an oversized component splits into cohesive
sub-batches by class or topic, as long as no split separates spans sharing a
file. A span sharing no file with any other non-clean span is a component of
size one — still a valid fork unit.

Some steps reference sections of the `git-span:git-span` skill. These are
conditional — invoke the skill only when the topic exceeds what is explained
here. The skill's sections are loaded together when the skill is invoked;
navigate to the named section within it.

---

## Phase 1 — Triage and partition (main agent, read-only)

Only step 2 mutates `.span/`; the remaining steps are read-only.

### 1. Preflight

`git status .span` before starting. Anything already modified is another
session's work, not yours — never attribute it to this batch's diff.

### 2. Auto-fix mechanical drift

`--fix` is global (it touches all spans), so run it once before partitioning:

```bash
git span drift --fix
```

If it changes `.span/`, commit that refresh with any uncommitted anchored source
it records; if the source is already committed, commit `.span/` alone. Use one
commit. Otherwise continue.

### 3. Triage

`git span list` prints every name, anchor, and why — no `git span show` or
`git span why` per span. Classify each span and skip `clean`, using two tiers:

- **list** — decidable from the `list` output alone; assign now.
- **confirm** — flag in triage; the fork assigns after reading current anchor
  bytes, mirroring reconcile's rule that final classification is the fork's job.

| Class | Tier | Signal | Action |
|---|---|---|---|
| clean | list | meets the standard and is accurate at every anchor | skip — don't polish |
| empty | list | why is blank | write one per the standard |
| label-fragment | list | `Label: fragment` without a subject and verb | rewrite as a complete clause; keeping the label is optional |
| work-order | list | generic procedure instead of decision context | remove the procedure; retain decisive nonlocal facts |
| change-history | list | narrates the change story (e.g. "We switched IDs to UUIDs after issue #482") instead of standing state | restate the standing decision in present tense |
| vague | list | true but generic; a leading blank line inside a triple-quoted why is this class too (cosmetic, not meaningful) | tighten / strip the artifact |
| bad-name | list | non-kebab-case or reserved name | `git mv .span/<old> .span/<new>`; grep the repo for the old name first (docs/comments/skills may reference it) |
| single-file | list | every anchor is a range in one file | add the counterparty the why names; delete only if none exists |
| drift-claim | confirm | asserts a fact about code that may have changed (a mechanism, a count, a "fixed" problem) | verify against current anchor bytes; rewrite or use `git span history <name>` if creation-vs-current is unclear |
| lifecycle-gate | confirm | behavior is conditional on named evidence | verify the evidence; preserve behavior and why when unmet, invalidated, or unavailable; when satisfied, make the change, then revise or retire the why and every superseded anchor |
| drift-range | confirm | anchor content shifted but still the same logical site | `drift --fix` (Moved / whitespace-only Changed) or manual re-anchor (real content drift) |
| mis-anchored | confirm | anchor range points at the WRONG code entirely — the why describes something living elsewhere in the file. `drift` reports 0 drift for this (the hash matches the wrong bytes) — it is caught only by reading the anchor against the why's claims, never by `drift` alone | find the real site, then swap the old range for the new one with `git span replace` |
| duplicate/overlap | confirm | two spans assert the same coupling | consolidate (Operations table) |
| generated-output | confirm | a script or generator writes an anchored path and nobody hand-edits it | drop the output anchors, keep the producer↔consumer contract |
| mirror-bundle | confirm | ≥2 basename pairs of *near-identical copies* across two roots differing by one path segment, no anchored enforcer. Surfaces that restate one rule in their own register are distinct roles, not this class | keep ONE span (`add` rejects directory roots). Parity check exists: anchor the normative side's files plus the check. No check: the span *is* the parity mechanism — keep both sides of each pair, name the normative direction in the why, and recommend building a check; dropping the mirror side removes the only drift detection. Tree too large to enumerate (dozens of pairs): anchor one representative pair and say in the why it stands for the tree. Never split per pair, never delete |
| open-set registry | confirm | one anchor's content is a *list* of the other anchors — tells: "and others", "when ⟨members⟩ are added", "enumerating", "documents each" | **advisory, never auto-reject.** Distinguish a shared obligation ("every X must …" — keep) from a listing obligation ("every X is enumerated here" — narrow to the co-varying core, or hand the list to the tooling that owns it) |

Then run `git span drift` once (read-only) to pre-mark remaining drift-range
candidates — `--fix` already cleared Moved and whitespace-only Changed, so what
remains is real content drift. **STOP if a DELETED anchor's file no longer
exists on disk** — a fork cannot investigate a deleted file; the main agent
resolves it inline: remove the anchor if the remaining anchors still describe
the relationship, else delete the span.

The main agent's job is structural, not investigative: record **what** is
wrong; the forks determine **why** and **what to do about it**.

### 4. Build the file-sharing graph

Collect every file that appears in more than one non-clean span, then pass all
of them as roots to a single `tree` call at depth 1 — `tree` accepts multiple
roots in one invocation and separates unrelated roots into distinct top-level
trees in the same output, so there is never a reason to call it once per file:

```bash
git span tree '<shared-file-1>' '<shared-file-2>' '<shared-file-N>' --depth 1
```

The tree output is the adjacency list: each top-level tree covers one shared
file (or a clique of files that co-occur on a span), and each child line
represents one span that anchors it. Non-clean spans under the same top-level
tree are connected — they form one component. A non-clean span whose anchored
files each appear in only one non-clean span is a component of size one. Clean
spans that appear as children are context the fork uses for duplicate/overlap
and sibling-span judgment — include them in the fork prompt, never assign them.

### 5. Assemble the work plan — one per fork unit

For each component, produce a fork unit; split an oversized component (more
than ~3–6 spans) into cohesive sub-batches by class or subsystem, never
separating spans that share a file. For each fork unit, produce:

- Label (shared-file name, sub-batch topic, or "isolated")
- Span names with their `list`-tier classes
- `confirm`-tier flags and drift-range candidates
- Shared files and clean sibling spans (context)
- Any overlap or duplicate-candidate flags for the fork to coordinate

**That's it.** No per-anchor confirmations, no pre-drafted whys, no pre-computed
commands. The forks own the investigation.

### 6. Check whether forking is worthwhile

If the corpus is small and simple (1–2 spans, no shared files), the overhead of
a fork may not be justified — handle it inline and skip Phase 2. Otherwise hand
each unit to a fork.

---

## Phase 2 — Execution (one subagent per fork unit, all in parallel)

Spawn one subagent per fork unit from step 5. If there are N fork units, N
subagents run in parallel.

**No worktree isolation** — fork units are disjoint by construction (spans
sharing a file are never split across units), so subagents touch disjoint
`.span/` files. They share the main worktree without conflict. Only the main
agent commits.

Dispatch each fork unit with `spawn_agent`, setting `fork_turns: "all"`.
Forked subagents inherit the full conversation context (including this
reference and the why standard), so the `message` only needs to identify
which spans the subagent owns and the structural context the main agent
gathered in Phase 1:

```json
{
  "task_name": "cleanup-<label>-whys",
  "message": "Bring these <N> spans' whys up to the why standard inlined above (component: <label> — connected via <shared-file>). Do not commit.\n\n## <name-1>\n- Class: <list-tier class from triage>\n- Why: <from git span list>\n- Anchors: <paths> — verify current bytes before rewriting\n\n(Context: these spans share <shared-file>. Clean sibling spans also anchoring it: <list>. <Overlap or duplicate-candidate flag if any>.)",
  "fork_turns": "all"
}
```

### Fork procedure

Each spawned subagent reads this section from context to know what to do. The
main agent's `message` only designates which spans — the procedure is shared
here.

For each assigned span:

1. **Confirm the class.** Read current bytes at the anchors in one parallel
   batch. For whole-file or near-whole-file ranges (hundreds+ lines), skip full
   reads: check the header/doc comment plus `grep` for the why's specific nouns
   (function/counter names) instead of reading it all. Run
   `git span history <name>` once only when provenance is unclear.
2. **Verify and draft.** Verify every clause against current anchors or the
   evidence a gate names, and confirm: each label introduces a complete
   clause, every named source or command exists and is current, no stronger
   mechanism should replace the span, and activation from any anchor preserves
   the decision and leaves meaning and anchors accurate. Draft per the
   standard inlined above. Stop if a claim cannot be confirmed — report
   instead.
3. **Apply.** All `git span why <name> "..."` writes in one chained command,
   then comment edits, then re-anchoring (comments before re-anchoring so one
   pass covers both). A comment edit that shifts an anchor's line count needs
   its own re-anchor check immediately after — don't assume a later blanket
   `--fix` will catch it.
4. **Verify scoped.** `git span drift <name>` per span — exit 0. Scope by span
   names, not touched paths — path-scoping surfaces unrelated spans that merely
   share a file and reads as false drift.
5. **Lifecycle gates.** A gate transition has three independent obligations:
   make the authorized behavior change, revise or retire the substantive why,
   and reconcile or retire every superseded anchor. Passing one does not imply
   the others passed. When evidence is unmet, invalidated, or unavailable,
   preserve behavior and why. Stop on ambiguity.
6. **Do not commit.**

For deletion syntax or why rules beyond what is explained here, invoke the
corresponding `git-span:git-span` section.

### After all forks complete

```bash
git span drift     # must exit 0 with "0 drift"
git span doctor    # must report "no findings"
git add <changed-anchor-paths> .span
git commit -o .span <changed-anchor-paths> -m "Bring span whys up to the writing standard"
```
Omit content paths when no anchor changed. Run repository validation for every
behavior change and surface every anchor diff and rewritten why in the report.

If any fork reported a failure, or `git span drift` is non-zero, handle the
failing fork unit inline — its spans are isolated from the successful units by
definition, so only the failed unit needs rework.

---

## Gotchas

- `drift --fix` reconciles every span anchored to the file it touches, not
  just the one you're fixing — diff the full set of spans it reports, not
  only your target. Unit disjointness keeps its effect inside your unit;
  never run it outside it.
- `drift --fix` no-ops ("Reconciled 0 spans") on a non-trivial change even
  when it *looks* like a pure shift — with no work done it prints no summary
  line (the `0 drift` line covers the clean case) — don't retry it; re-anchor
  manually (swap the old range for the new one with `git span replace`) once.
- Anchor ranges can shift between your inspect step and your fix step (usually
  your own earlier comment edit) — re-run `git span show <name>` immediately
  before `git span remove` to get the live range, don't reuse a range noted
  earlier.
- Re-anchoring a range doesn't imply the why is still accurate — if the range
  change was needed because the code moved or changed, re-check the why's
  factual clauses in the same pass.
- Repeated anchors across *sibling spans* documenting one doc/subsystem family
  are by design, not a duplicate/overlap smell. Repeated *instances of one kind
  inside a single span* are the smell — see the mirror-bundle and single-file rows.
- A span shown modified in `git status` with an empty `git diff HEAD -- <path>`
  is inert noise from another session, not a finding.
- The main agent must not touch `.span/` while forks run.

## Operations

| Operation | Command |
|---|---|
| Rewrite/write why | `git span why <name> "..."` |
| Re-anchor, pure line-shift | `git span drift --fix` |
| Refresh changed content at the same logical address | `git span add <name> <path#Lsame>` — preserve the exact existing anchor shape |
| Re-anchor, path/range identity changed | `git span replace <name> <path#Lold> <path#Lnew>` — one atomic swap, or nothing |
| Re-hash whole-file anchor | `git span add <name> <path>` |
| Consolidate duplicates | `git span add` the loser's anchors onto the keeper, then `git span delete <loser>`; merge the whys into one definition |
| Rename | `git mv .span/<old> .span/<new>` |
| Delete | `git span delete <name>` when no real coupling remains; keep it only if you can confirm the relationship |

## Validation

- Why, `.span/**`, and comment-only edits require no package checks; scoped
  `git span drift <name>` must still exit 0 after every unit.
- Behavioral changes require the repository's code validation.
- End of campaign: full `git span drift` exit 0 and `git span doctor` clean.

## Report

Per span: classification → action (old why → new why for rewrites). List every
file touched, including source files touched only for comment retrofits.

## Git allowlist

When resolving spans in a shared worktree, restrict to: `git span …`, edits to
assigned anchors when a confirmed authority or satisfied gate decides them,
required tests, `git add .span[/<name>]`, `git add <assigned-anchor>`,
`git commit -o .span[/<name>] <assigned-anchor> -m` (never `-a` or `--amend`),
`git checkout <commit-ish> -- .span/<name>`, and read-only
`git status`/`git diff`/`git log`/`git show`. Never touch unrelated paths or
rewind HEAD.
