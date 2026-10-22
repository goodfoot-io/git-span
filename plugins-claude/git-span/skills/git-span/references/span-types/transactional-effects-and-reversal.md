# Transactional effects and reversal

Scope: declare a useful span using transactional effects and reversal.

## When to use this type

Failure, cancellation, rollback or retry could leave partial or duplicated effects. Do not claim all-or-nothing behavior for external effects that only support best-effort compensation.

## Information and anchors

Name prepare/commit boundaries, actual atomicity limits, durable recovery evidence and permitted compensation or replay behavior.

Candidate anchor roles: candidate construction/validation; first durable effect; abort/undo/retry path; history or receipt consumer. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Trace failure before and after the commit point, cancellation and a repeated request; inspect remaining effects and truthful history.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> Validation evaluates the complete candidate; rejection leaves stored state unchanged and persistence follows successful validation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [phase ordering](phase-order-and-evidence-gates.md) for a prerequisite without partial-effect recovery; use [state lifecycle](state-lifecycle-and-recovery.md) for continuity rather than commit, compensation or replay.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
