# Representation boundaries

Scope: find and declare spans during behavioral review using representation boundaries.

## When to use this type

A value crosses input, internal, persisted or output representations and may lose meaning. Use negative contracts when the decisive rule is whether the field may exist at all.

## Information and anchors

State accepted forms, the internal meaning, canonical output and distinctions intentionally preserved or erased, including absence, null, false and zero.

Candidate anchor roles: decoder or normalizer; domain value; serializer or accumulator; authoritative mapping example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether normalization, defaulting or serialization changes the mapping or loses a value already used for a decision.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Compare absent, false and zero through conversion and reporting; verify canonical output separately from accepted input spelling.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> An absent assessment is null and excluded from pass statistics; false denotes an evaluated failure and remains in the denominator.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) for how an operator computes a value; use [negative contracts](branch-specific-and-negative-contracts.md) for whether a field exists at all.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
