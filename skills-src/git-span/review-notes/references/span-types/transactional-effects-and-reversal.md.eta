# Transactional effects and reversal

Scope: add and update spans for transactional effects and reversal.

## When to use this type

Failure, cancellation, rollback or retry could leave partial or duplicated effects. Do not claim all-or-nothing behavior for external effects that only support best-effort compensation.

## Information and anchors

Name prepare/commit boundaries, actual atomicity limits, durable recovery evidence and permitted compensation or replay behavior.

Candidate anchor roles: candidate construction/validation; first durable effect; abort/undo/retry path; history or receipt consumer. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> Validation evaluates the complete candidate; rejection leaves stored state unchanged and persistence follows successful validation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [phase ordering](phase-order-and-evidence-gates.md) for a prerequisite without partial-effect recovery; use [state lifecycle](state-lifecycle-and-recovery.md) for continuity rather than commit, compensation or replay.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
