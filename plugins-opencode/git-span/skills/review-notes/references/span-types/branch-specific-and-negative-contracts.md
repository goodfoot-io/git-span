# Branch-specific and negative contracts

Scope: find and declare spans during behavioral review using branch-specific and negative contracts.

## When to use this type

A branch requires a field, action or state change to be absent. Anchor positive code capable of violating the prohibition; ordinary anchors do not hash absence itself.

## Information and anchors

State the branch condition and observations or effects that must be omitted; distinguish absence from null, false and an empty container.

Candidate anchor roles: branch guard; response constructor or effect-capable call; authoritative condition table; contrasting branch example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check shared finalizers, unconditional response fields and bypass calls that can introduce the forbidden observation.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Exercise both branches and inspect field presence and effects; rejection must not send a request or persist state when that is the promise.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> A pending archive omits artifact_uri because no artifact exists; only the completed branch supplies it.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for the meaning of a present value; use [transactional effects](transactional-effects-and-reversal.md) for partial effects and their recovery across failure or retry.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
