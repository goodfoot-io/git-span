---
title: Reconciliation Authority
summary: What to do with the stale anchors `git span stale --fix` leaves drifting — decide which coupled artifact is the source of truth via git history, conform docs to intentional code changes automatically, and escalate to the user when the fix requires editing code or authority is ambiguous.
aliases: [Drift Authority, Docs Follow Source]
tags: [guide, git-span]
keywords: [reconcile, stale, drift, authority, source of truth, fail closed, doc rewrite]
---

# Reconciliation authority

`git span stale --fix` auto-resolves `Moved` and whitespace-equivalent
`Changed` anchors; a `Changed` anchor whose content differs beyond whitespace
is left drifting so it resurfaces for confirmation
([mod.rs](../../packages/git-span/src/cli/mod.rs#L70-L77)). This page governs
that residue — the meaning-altering `Changed` and `Deleted` anchors
([types.rs](../../packages/git-span/src/types.rs#L133-L144)).

Re-anchoring records the current content as the anchored baseline; the tool
performs no semantic check. So before re-anchoring, confirm the coupled
artifacts still agree — and when they don't, edit the disagreeing artifact
first. Reconciliation that only touches span metadata over a live
disagreement hides the drift signal without resolving it.

## Decision rule

When coupled artifacts disagree, decide which side is authoritative, then act
by cost of error:

1. **Locate authority via demonstrated intent.** `git span stale` reports the
   resolver layers that observed drift, but `HEAD` alone does not prove the
   declaration or content change was committed: a worktree-only declaration
   re-anchor can compare against `HEAD` and produce that source too. Inspect the
   declaration diff and `git span history <name>` timeline
   ([mod.rs](../../packages/git-span/src/cli/mod.rs#L184-L194)); commit or revert
   an uncommitted declaration edit rather than searching for a source commit
   that does not exist. A doc
   drifting behind a deliberate, committed code change means the doc is
   wrong. A code change with no coherent commit story may be a regression —
   the doc may be the truth.
2. **Docs follow authoritative code automatically.** Rewrite the doc to
   describe current reality — no "we used to" framing — without asking.
3. **Escalate to the user** when the fix requires editing code, when the doc
   is a contract or spec that may be the intended truth rather than a
   description, or when the drift has no intentional commit behind it.

Fail closed on authority ambiguity, not on editing per se.

## When conforming a doc

- Show the doc diff in the final report; the user reviews after, not before.
- Commit content files first, then the re-anchored spans — anchors on
  uncommitted source sit at `ResolvedPendingCommit` until the source commit
  lands ([types.rs](../../packages/git-span/src/types.rs#L136-L138)).
- Keep the span's why across routine re-anchors; write a new one only when
  the subsystem itself changed
  ([mod.rs](../../packages/git-span/src/cli/mod.rs#L116-L118)).
