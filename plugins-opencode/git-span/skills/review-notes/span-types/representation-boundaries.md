# Representation boundaries

Scope: add and update spans for representation boundaries.

## When to use this type

A value crosses input, internal, persisted or output representations and may lose meaning. Use negative contracts when the decisive rule is whether the field may exist at all.

## Information and anchors

State accepted forms, the internal meaning, canonical output and distinctions intentionally preserved or erased, including absence, null, false and zero.

Candidate anchor roles: decoder or normalizer; domain value; serializer or accumulator; authoritative mapping example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 3 in [the skill](../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> An absent assessment is null and excluded from pass statistics; false denotes an evaluated failure and remains in the denominator.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) for how an operator computes a value; use [negative contracts](branch-specific-and-negative-contracts.md) for whether a field exists at all.

Return to the [skill](../SKILL.md) for the type selector and review procedure.
