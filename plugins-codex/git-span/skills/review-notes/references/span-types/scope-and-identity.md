# Scope and identity

Scope: find and declare spans during behavioral review using scope and identity.

## When to use this type

A name, key or path could discard context needed to distinguish or equate entities. Random uniqueness alone does not establish stable identity, correct binding or reproducible selection.

## Information and anchors

State the key recipe, partition/binding/invocation dimensions, intentional sharing and aliases that denote the same entity.

Candidate anchor roles: context or identity constructor; lookup/deduplication consumer; reset owner; separation/equivalence example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether changed keys, caches, paths or symbol matching lose a dimension or introduce unwanted fragmentation.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Use two equal-looking entities that must remain separate and, where relevant, two aliases that must collapse; interleave partitioned state.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Invocation output identity includes the parent call path; the same task under different parents does not share an output directory.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [state lifecycle](state-lifecycle-and-recovery.md) for how long state survives; use [authority and precedence](authority-and-configuration-precedence.md) for choosing among sources that refer to the same entity.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
