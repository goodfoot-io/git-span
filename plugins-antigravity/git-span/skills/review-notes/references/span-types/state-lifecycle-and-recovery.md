# State lifecycle and recovery

Scope: add and update spans for state lifecycle and recovery.

## When to use this type

Correctness depends on transitions, reset, persistence, restoration or cache lifetime. A runtime lifecycle event does not trigger Git Span unless a supported file touch or explicit inspection occurs.

## Information and anchors

State initial observations, transition and reverse/reset rules, authoritative versus derived state, and the data required for continuity.

Candidate anchor roles: initializer; transition/reset owner; projection; save/restore boundary; next-item observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> Restored processing consumes the next item with the saved predecessor and reset marker; restoration does not begin a new segment.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [scope and identity](scope-and-identity.md) for who owns state, or [transactional effects](transactional-effects-and-reversal.md) for what becomes durable and how partial effects are reversed.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
