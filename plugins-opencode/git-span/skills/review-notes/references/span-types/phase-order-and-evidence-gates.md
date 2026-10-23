# Phase ordering and evidence gates

Scope: add and update spans for phase ordering and evidence gates.

## When to use this type

A check, decision or effect is valid only after information or evidence becomes available. A stated gate is context, not an executable guard; independent stages need no invented total order.

## Information and anchors

Name the prerequisite, dependent decision, necessary partial order and authority for the gate; separate runtime readiness from permission to change policy.

Candidate anchor roles: producer of facts; binder/merger or probe; ordering boundary; first dependent check or effect. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> Alias declaration stores a callable without invocation values; required-argument validation runs after invocation bindings are merged.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [state lifecycle](state-lifecycle-and-recovery.md) for transitions and retained state; use [authority and precedence](authority-and-configuration-precedence.md) when the question is which source permits a decision.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
