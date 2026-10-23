# Observable outcome contracts

Scope: add and update spans for observable outcome contracts.

## When to use this type

One operation communicates through status, payload, channels or artifacts that must agree. A newly correct exit status does not establish that the payload or artifact is correct.

## Information and anchors

State the outcome matrix: who classifies success or failure, what each public signal contains, and when required artifacts are complete.

Candidate anchor roles: public outcome contract; internal classifier; response/status adapter; complete-invocation observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> A failed report write emits the failure envelope and a nonzero status; success requires the completed report artifact.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [negative contracts](branch-specific-and-negative-contracts.md) when the decisive question is whether a branch emits a field or effect; use [cross-cutting responsibilities](cross-cutting-responsibilities.md) when it is which layer covers every entrypoint.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
