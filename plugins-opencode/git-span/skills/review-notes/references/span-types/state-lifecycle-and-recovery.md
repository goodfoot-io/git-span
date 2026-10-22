# State lifecycle and recovery

Scope: find and declare spans during behavioral review using state lifecycle and recovery.

## When to use this type

Correctness depends on transitions, reset, persistence, restoration or cache lifetime. A runtime lifecycle event does not trigger Git Span unless a supported file touch or explicit inspection occurs.

## Information and anchors

State initial observations, transition and reverse/reset rules, authoritative versus derived state, and the data required for continuity.

Candidate anchor roles: initializer; transition/reset owner; projection; save/restore boundary; next-item observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether state added or removed by an edit survives restoration and whether derived observations are recomputed after transitions.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Compare uninterrupted with save/restore execution, including the next transition and a reverse or reset edge.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Restored processing consumes the next item with the saved predecessor and reset marker; restoration does not begin a new segment.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [scope and identity](scope-and-identity.md) for who owns state, or [transactional effects](transactional-effects-and-reversal.md) for what becomes durable and how partial effects are reversed.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
