# Cross-cutting responsibilities

Scope: reassess an existing span before refreshing it using cross-cutting responsibilities.

## When to use this type

A guarantee applies across entrypoints or paths that could bypass its shared owner. A representative handler does not prove that every handler traverses the shared owner.

## Information and anchors

Name the responsible layer, covered routing mechanism, meaningful bypasses and authorised exceptions.

Candidate anchor roles: public guarantee; shared owner/wrapper; routing mechanism; first-run, help, error or redispatch boundary. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Reassess and reconcile

1. Use the current why, anchor bytes and history from stage 3 of [the procedure](../procedure.md). Check new entrypoints, wrappers and early returns against the claimed ownership; forwarding an option is separate from parsing it.
2. Confirm authority and meaning before refreshing content. Preserve unresolved disagreements; return behavior findings to the owner.
3. Select evidence appropriate to the semantic change: Compare normal, first-run and exception paths; verify the guarantee at each relevant bypass boundary.
4. Refresh unchanged identities or atomically replace moved paths/ranges under the procedure. Revise the why when its rule or scope changes; extend, split or consolidate only when the information requires it.
5. Retain useful explanation even when tested or reduced to one anchor. Retire only when the relationship/reminder is obsolete or adds no useful decision context. Require scoped zero drift; delegated work stays unstaged for the owner.

## Illustrative why

> The formatter owns stdout in machine mode; initialization notices use diagnostics, including the first invocation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [observable outcomes](observable-outcome-contracts.md) for agreement among result signals; use [phase ordering](phase-order-and-evidence-gates.md) when the obligation is a prerequisite before an effect.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
