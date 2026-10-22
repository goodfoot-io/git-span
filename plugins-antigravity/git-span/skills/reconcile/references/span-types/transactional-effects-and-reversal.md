# Transactional effects and reversal

Scope: reassess an existing span before refreshing it using transactional effects and reversal.

## When to use this type

Failure, cancellation, rollback or retry could leave partial or duplicated effects. Do not claim all-or-nothing behavior for external effects that only support best-effort compensation.

## Information and anchors

Name prepare/commit boundaries, actual atomicity limits, durable recovery evidence and permitted compensation or replay behavior.

Candidate anchor roles: candidate construction/validation; first durable effect; abort/undo/retry path; history or receipt consumer. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Reassess and reconcile

1. Use the current why, anchor bytes and history from stage 3 of [the procedure](../procedure.md). Check whether an edit moves persistence earlier, records attempted work as complete, or reorders reversal independently of applied history.
2. Confirm authority and meaning before refreshing content. Preserve unresolved disagreements; return behavior findings to the owner.
3. Select evidence appropriate to the semantic change: Trace failure before and after the commit point, cancellation and a repeated request; inspect remaining effects and truthful history.
4. Refresh unchanged identities or atomically replace moved paths/ranges under the procedure. Revise the why when its rule or scope changes; extend, split or consolidate only when the information requires it.
5. Retain useful explanation even when tested or reduced to one anchor. Retire only when the relationship/reminder is obsolete or adds no useful decision context. Require scoped zero drift; delegated work stays unstaged for the owner.

## Illustrative why

> Validation evaluates the complete candidate; rejection leaves stored state unchanged and persistence follows successful validation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [phase ordering](phase-order-and-evidence-gates.md) for a prerequisite without partial-effect recovery; use [state lifecycle](state-lifecycle-and-recovery.md) for continuity rather than commit, compensation or replay.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
