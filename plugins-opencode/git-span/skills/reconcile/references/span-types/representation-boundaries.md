# Representation boundaries

Scope: reassess an existing span before refreshing it using representation boundaries.

## When to use this type

A value crosses input, internal, persisted or output representations and may lose meaning. Use negative contracts when the decisive rule is whether the field may exist at all.

## Information and anchors

State accepted forms, the internal meaning, canonical output and distinctions intentionally preserved or erased, including absence, null, false and zero.

Candidate anchor roles: decoder or normalizer; domain value; serializer or accumulator; authoritative mapping example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Reassess and reconcile

1. Use the current why, anchor bytes and history from stage 3 of [the procedure](../procedure.md). Check whether normalization, defaulting or serialization changes the mapping or loses a value already used for a decision.
2. Confirm authority and meaning before refreshing content. Preserve unresolved disagreements; return behavior findings to the owner.
3. Select evidence appropriate to the semantic change: Compare absent, false and zero through conversion and reporting; verify canonical output separately from accepted input spelling.
4. Refresh unchanged identities or atomically replace moved paths/ranges under the procedure. Revise the why when its rule or scope changes; extend, split or consolidate only when the information requires it.
5. Retain useful explanation even when tested or reduced to one anchor. Retire only when the relationship/reminder is obsolete or adds no useful decision context. Require scoped zero drift; delegated work stays unstaged for the owner.

## Illustrative why

> An absent assessment is null and excluded from pass statistics; false denotes an evaluated failure and remains in the denominator.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) for how an operator computes a value; use [negative contracts](branch-specific-and-negative-contracts.md) for whether a field exists at all.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
