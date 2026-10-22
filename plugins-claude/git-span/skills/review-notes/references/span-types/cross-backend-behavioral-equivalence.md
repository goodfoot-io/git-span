# Cross-backend behavioral equivalence

Scope: find and declare spans during behavioral review using cross-backend behavioral equivalence.

## When to use this type

Parallel backends or platform copies promise equivalent behavior despite native differences. Keep one coherent relationship rather than one span per mirrored pair; a check does not by itself remove the value of its explanation.

## Information and anchors

Name the common authority, semantic slice, backend-specific mechanisms, permitted differences and representative coverage limit.

Candidate anchor roles: common specification/value model or normative input; emitter/adapter implementations; parity or conformance observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether one backend changed semantics, a parity check omits an exception, or regenerated copies differ from the normative input.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Compare the same discriminating case across relevant backends; inspect type, mutation identity, async completion or intentional differences.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Portable maps preserve numeric and string keys as distinct through each encoder and comparator, despite native JSON object limitations.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) for one host/source-language distinction, or [compatibility boundaries](compatibility-and-extension-boundaries.md) for a promise across interface versions rather than parallel backends.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
