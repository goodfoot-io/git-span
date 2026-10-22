# Authority and configuration precedence

Scope: reassess an existing span before refreshing it using authority and configuration precedence.

## When to use this type

Multiple sources can control a result and their values or interpretations may disagree. Preserve unresolved authority and scoped assumptions; a recorded decision does not itself authorise behavior changes.

## Information and anchors

State the winning source, merge/replace policy, absent/null/invalid/unavailable behavior, scope and evidence authorising supersession.

Candidate anchor roles: requirement/precedence table; source selector or merge; startup/reload reconstruction; contradictory-source example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Reassess and reconcile

1. Use the current why, anchor bytes and history from stage 3 of [the procedure](../procedure.md). Check whether a new load order, fallback or rationale changes the authorised winner; committed implementation shows intent, not permission to supersede requirements.
2. Confirm authority and meaning before refreshing content. Preserve unresolved disagreements; return behavior findings to the owner.
3. Select evidence appropriate to the semantic change: Give sources different values and compare live resolution with restart/reconstruction; verify invalid-source and fallback behavior against the actual contract.
4. Refresh unchanged identities or atomically replace moved paths/ranges under the procedure. Revise the why when its rule or scope changes; extend, split or consolidate only when the information requires it.
5. Retain useful explanation even when tested or reduced to one anchor. Retire only when the relationship/reminder is obsolete or adds no useful decision context. Require scoped zero drift; delegated work stays unstaged for the owner.

## Illustrative why

> A present request value overrides account settings, including explicit null to disable the option; only an absent request field inherits.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for preserving meaning across conversion; use [state lifecycle](state-lifecycle-and-recovery.md) when the winner is settled but must survive a transition.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
