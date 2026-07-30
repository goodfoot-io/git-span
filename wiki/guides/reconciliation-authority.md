---
title: Reconciliation Authority
summary: How to decide, when a stale span reveals that coupled artifacts disagree, which side is the source of truth and whether to conform the other side automatically or pause for the user. Authority goes to demonstrated intent (git history); docs follow intentional code changes automatically; code edits and contract-doc ambiguity escalate.
aliases: [Drift Authority, Docs Follow Source]
tags: [guide, git-span]
keywords: [reconcile, stale, drift, authority, source of truth, fail closed, doc rewrite]
---

# Reconciliation authority

A span is a claim that its anchored artifacts agree. Staleness is the symptom;
**disagreement between the artifacts is the disease**. Re-anchoring a span onto
content that contradicts its other anchors certifies a falsehood — genuine
reconciliation must be allowed to edit the artifacts themselves, not only
`.span/` metadata. The reconcile skill's classification table already crosses
this line in one place
([SKILL.md](../../plugins-claude/git-span/skills/reconcile/SKILL.md#L214-L221)):
"one side of the relationship broke → fix the code first, then re-anchor."

## The decision rule

When coupled artifacts disagree, exactly one question matters: **which side is
authoritative?** Answer it with evidence of intent, then act by cost of error:

1. **Authority goes to demonstrated intent.** Code changed by a deliberate,
   committed change is authoritative — it is what runs, and its change was
   chosen. Check git history before conforming anything: a doc drifting behind
   an intentional code change means the doc is wrong; a code change with no
   coherent commit story may be a regression, and the doc may be the truth.
2. **Docs follow authoritative code automatically.** Conforming a descriptive
   doc to intentionally changed code is reversible, evidence-preserving, and
   records a truth already established elsewhere. Do it without asking.
   Rewrite the doc to describe current reality — no "we used to" framing.
3. **Escalate when authority is ambiguous or the edit changes behavior.**
   Pause for the user when: the fix requires editing code; the doc is a
   contract or spec that may be the intended truth rather than a description;
   or the drift has no corresponding intentional commit.

This is fail-closed applied to the right variable: fail closed on **authority
ambiguity**, not on editing per se. Blanket read-only blocks the safe, common
case (doc drift) and lets the contradiction persist — itself a failure.

## Autonomy boundary

Proceed exactly as far as the evidence decides the question; stop exactly where
it does not. A doc drift whose code-side change is visible and deliberate in
history is fully decidable from the repo — resolve it without asking. A drift
with no intent trail is undecidable from the repo — asking is correct, not a
failure of nerve.

## Hygiene when conforming a doc

- Show the doc diff in the final report; the user reviews after, not before.
- Commit doc rewrites separately from span re-anchors (content files first,
  then `.span/` — the same ordering as `resolved, pending commit` in
  [SKILL.md](../../plugins-claude/git-span/skills/reconcile/SKILL.md#L28-L37)).
- Re-anchor the span onto the rewritten doc and update its why if the coupling
  itself changed shape.

One sentence: reconciliation is conflict resolution between coupled artifacts;
authority goes to the side with demonstrated intent; conform the other side
automatically when history makes authority evident, and escalate when it
doesn't.
