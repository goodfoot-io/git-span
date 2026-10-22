# State lifecycle and recovery

Scope: reassess an existing span before refreshing it using state lifecycle and recovery.

## When to use this type

Correctness depends on transitions, reset, persistence, restoration or cache lifetime. A runtime lifecycle event does not trigger Git Span unless a supported file touch or explicit inspection occurs.

## Information and anchors

State initial observations, transition and reverse/reset rules, authoritative versus derived state, and the data required for continuity.

Candidate anchor roles: initializer; transition/reset owner; projection; save/restore boundary; next-item observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Reassess and reconcile

1. Use the current why, anchor bytes and history from stage 3 of [the procedure](../procedure.md). Check whether state added or removed by an edit survives restoration and whether derived observations are recomputed after transitions.
2. Confirm authority and meaning before refreshing content. Preserve unresolved disagreements; return behavior findings to the owner.
3. Select evidence appropriate to the semantic change: Compare uninterrupted with save/restore execution, including the next transition and a reverse or reset edge.
4. Refresh unchanged identities or atomically replace moved paths/ranges under the procedure. Revise the why when its rule or scope changes; extend, split or consolidate only when the information requires it.
5. Retain useful explanation even when tested or reduced to one anchor. Retire only when the relationship/reminder is obsolete or adds no useful decision context. Require scoped zero drift; delegated work stays unstaged for the owner.

## Illustrative why

> Restored processing consumes the next item with the saved predecessor and reset marker; restoration does not begin a new segment.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [scope and identity](scope-and-identity.md) for who owns state, or [transactional effects](transactional-effects-and-reversal.md) for what becomes durable and how partial effects are reversed.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
