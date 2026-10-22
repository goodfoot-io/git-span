# Observable outcome contracts

Scope: reassess an existing span before refreshing it using observable outcome contracts.

## When to use this type

One operation communicates through status, payload, channels or artifacts that must agree. A newly correct exit status does not establish that the payload or artifact is correct.

## Information and anchors

State the outcome matrix: who classifies success or failure, what each public signal contains, and when required artifacts are complete.

Candidate anchor roles: public outcome contract; internal classifier; response/status adapter; complete-invocation observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Reassess and reconcile

1. Use the current why, anchor bytes and history from stage 3 of [the procedure](../procedure.md). Check whether a changed wrapper, early return or artifact writer makes the outcome signals disagree.
2. Confirm authority and meaning before refreshing content. Preserve unresolved disagreements; return behavior findings to the owner.
3. Select evidence appropriate to the semantic change: Exercise the relevant success and failure branches; for artifact-producing operations, include a write failure and observe payload, status, diagnostics and artifact together.
4. Refresh unchanged identities or atomically replace moved paths/ranges under the procedure. Revise the why when its rule or scope changes; extend, split or consolidate only when the information requires it.
5. Retain useful explanation even when tested or reduced to one anchor. Retire only when the relationship/reminder is obsolete or adds no useful decision context. Require scoped zero drift; delegated work stays unstaged for the owner.

## Illustrative why

> A failed report write emits the failure envelope and a nonzero status; success requires the completed report artifact.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [negative contracts](branch-specific-and-negative-contracts.md) when the decisive question is whether a branch emits a field or effect; use [cross-cutting responsibilities](cross-cutting-responsibilities.md) when it is which layer covers every entrypoint.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
