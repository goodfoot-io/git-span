# Cross-backend behavioral equivalence

Scope: add and update spans for cross-backend behavioral equivalence.

## When to use this type

Parallel backends or platform copies promise equivalent behavior despite native differences. Keep one coherent relationship rather than one span per mirrored pair; a check does not by itself remove the value of its explanation.

## Information and anchors

Name the common authority, semantic slice, backend-specific mechanisms, permitted differences and representative coverage limit.

Candidate anchor roles: common specification/value model or normative input; emitter/adapter implementations; parity or conformance observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 3 in [the skill](../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> Portable maps preserve numeric and string keys as distinct through each encoder and comparator, despite native JSON object limitations.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) for one host/source-language distinction, or [compatibility boundaries](compatibility-and-extension-boundaries.md) for a promise across interface versions rather than parallel backends.

Return to the [skill](../SKILL.md) for the type selector and review procedure.
