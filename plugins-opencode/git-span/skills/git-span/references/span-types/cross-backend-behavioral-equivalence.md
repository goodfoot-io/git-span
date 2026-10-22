# Cross-backend behavioral equivalence

Scope: declare a useful span using cross-backend behavioral equivalence.

## When to use this type

Parallel backends or platform copies promise equivalent behavior despite native differences. Keep one coherent relationship rather than one span per mirrored pair; a check does not by itself remove the value of its explanation.

## Information and anchors

Name the common authority, semantic slice, backend-specific mechanisms, permitted differences and representative coverage limit.

Candidate anchor roles: common specification/value model or normative input; emitter/adapter implementations; parity or conformance observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Compare the same discriminating case across relevant backends; inspect type, mutation identity, async completion or intentional differences.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> Portable maps preserve numeric and string keys as distinct through each encoder and comparator, despite native JSON object limitations.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) for one host/source-language distinction, or [compatibility boundaries](compatibility-and-extension-boundaries.md) for a promise across interface versions rather than parallel backends.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
