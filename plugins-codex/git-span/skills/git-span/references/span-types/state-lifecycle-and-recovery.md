# State lifecycle and recovery

Scope: declare a useful span using state lifecycle and recovery.

## When to use this type

Correctness depends on transitions, reset, persistence, restoration or cache lifetime. A runtime lifecycle event does not trigger Git Span unless a supported file touch or explicit inspection occurs.

## Information and anchors

State initial observations, transition and reverse/reset rules, authoritative versus derived state, and the data required for continuity.

Candidate anchor roles: initializer; transition/reset owner; projection; save/restore boundary; next-item observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Compare uninterrupted with save/restore execution, including the next transition and a reverse or reset edge.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> Restored processing consumes the next item with the saved predecessor and reset marker; restoration does not begin a new segment.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [scope and identity](scope-and-identity.md) for who owns state, or [transactional effects](transactional-effects-and-reversal.md) for what becomes durable and how partial effects are reversed.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
