---
title: Reconciliation Authority
summary: What to do with drift that `git span drift --fix` leaves behind — follow demonstrated authority, complete gate-authorized transitions, and escalate ambiguous changes.
aliases: [Drift Authority, Docs Follow Source]
tags: [guide, git-span]
keywords: [reconcile, drift, authority, source of truth, fail closed, doc rewrite]
---

# Reconciliation authority

`git span drift --fix` auto-resolves `Moved` and whitespace-equivalent
`Changed` anchors; a `Changed` anchor whose content differs beyond whitespace
is left drifting so it resurfaces for confirmation
([mod.rs](../../packages/git-span/src/cli/mod.rs#L78-L85)). This page governs
that residue — the meaning-altering `Changed` and `Deleted` anchors
([types.rs](../../packages/git-span/src/types.rs#L137-L148)).

Re-anchoring records the current content as the anchored baseline; the tool
performs no semantic check. `add` and `why` (write mode) do end with a scoped
post-write resolver check, and its span-wide line — `0 drift across ...`,
`N anchors drifted — ...`, `state indeterminate`, or `state unverified` — is
the only place span-wide cleanliness is asserted, with drift's 0/1/2 exit
contract (0 clean / 1 drift remains or check errored / 2 index changed,
retryable). The requested-address lines (`added` / `resolved in place` /
`unchanged`) state only the local fact and never assert span health. The
check is mechanical drift detection, not semantic agreement: before
re-anchoring, confirm the coupled artifacts still agree — and when they
don't, edit the disagreeing artifact first. Reconciliation that only touches
span metadata over a live disagreement hides the drift signal without
resolving it.

## Decision rule

When coupled artifacts disagree, decide which side is authoritative, then act
by cost of error:

1. **Locate authority via the why and demonstrated intent.** A confirmed why may
   name an authoritative anchor. `git span drift` reports the
   resolver layers that observed drift, but `HEAD` alone does not prove the
   declaration or content change was committed: a worktree-only declaration
   re-anchor can compare against `HEAD` and produce that source too. Inspect the
   declaration diff and `git span history <name>` timeline
   ([mod.rs](../../packages/git-span/src/cli/mod.rs#L201-L211)); commit or revert
   an uncommitted declaration edit rather than searching for a source commit
   that does not exist. A doc
   drifting behind a deliberate, committed code change means the doc is
   wrong. A code change with no coherent commit story may be a regression —
   the doc may be the truth.
2. **Conform the non-authoritative side automatically.** Validate code changes.
   Without a confirmed contrary authority, docs follow deliberate committed code
   and describe current reality without "we used to" framing.
3. **Complete gate-authorized transitions.** When the named evidence satisfies
   a lifecycle gate, make its behavior change, revise or retire its why, and
   reconcile or retire every superseded anchor. Run the required code checks
   and require scoped zero drift.
4. **Escalate ambiguous authority.** This includes a possible contract whose
   authority is not established and drift with no intentional change behind it.

Fail closed on authority ambiguity, not on editing per se.

## When conforming an anchor

- Show the doc diff in the final report; the user reviews after, not before.
- Commit content and its `.span/` refresh together. Before that commit, anchors on
  uncommitted source appear as `ResolvedPendingCommit`
  ([types.rs](../../packages/git-span/src/types.rs#L140-L142)).
- Keep the span's why across routine re-anchors; write a new one only when
  the subsystem itself changed
  ([mod.rs](../../packages/git-span/src/cli/mod.rs#L138-L140)).
