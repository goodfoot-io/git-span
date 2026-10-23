# Branch-specific and negative contracts

Scope: add and update spans for branch-specific and negative contracts.

## When to use this type

A branch requires a field, action or state change to be absent. Anchor positive code capable of violating the prohibition; ordinary anchors do not hash absence itself.

## Information and anchors

State the branch condition and observations or effects that must be omitted; distinguish absence from null, false and an empty container.

Candidate anchor roles: branch guard; response constructor or effect-capable call; authoritative condition table; contrasting branch example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> A pending archive omits artifact_uri because no artifact exists; only the completed branch supplies it.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for the meaning of a present value; use [transactional effects](transactional-effects-and-reversal.md) for partial effects and their recovery across failure or retry.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
