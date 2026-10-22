# Transactional effects and reversal

Scope: find and declare spans during behavioral review using transactional effects and reversal.

## When to use this type

Failure, cancellation, rollback or retry could leave partial or duplicated effects. Do not claim all-or-nothing behavior for external effects that only support best-effort compensation.

## Information and anchors

Name prepare/commit boundaries, actual atomicity limits, durable recovery evidence and permitted compensation or replay behavior.

Candidate anchor roles: candidate construction/validation; first durable effect; abort/undo/retry path; history or receipt consumer. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether an edit moves persistence earlier, records attempted work as complete, or reorders reversal independently of applied history.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Trace failure before and after the commit point, cancellation and a repeated request; inspect remaining effects and truthful history.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Validation evaluates the complete candidate; rejection leaves stored state unchanged and persistence follows successful validation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [phase ordering](phase-order-and-evidence-gates.md) for a prerequisite without partial-effect recovery; use [state lifecycle](state-lifecycle-and-recovery.md) for continuity rather than commit, compensation or replay.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
