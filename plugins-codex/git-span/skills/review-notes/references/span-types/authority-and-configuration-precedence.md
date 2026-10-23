# Authority and configuration precedence

Scope: add and update spans for authority and configuration precedence.

## When to use this type

Multiple sources can control a result and their values or interpretations may disagree. Preserve unresolved authority and scoped assumptions; a recorded decision does not itself authorise behavior changes.

## Information and anchors

State the winning source, merge/replace policy, absent/null/invalid/unavailable behavior, scope and evidence authorising supersession.

Candidate anchor roles: requirement/precedence table; source selector or merge; startup/reload reconstruction; contradictory-source example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> A present request value overrides account settings, including explicit null to disable the option; only an absent request field inherits.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for preserving meaning across conversion; use [state lifecycle](state-lifecycle-and-recovery.md) when the winner is settled but must survive a transition.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
