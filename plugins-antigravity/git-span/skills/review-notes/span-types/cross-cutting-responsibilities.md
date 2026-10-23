# Cross-cutting responsibilities

Scope: add and update spans for cross-cutting responsibilities.

## When to use this type

A guarantee applies across entrypoints or paths that could bypass its shared owner. A representative handler does not prove that every handler traverses the shared owner.

## Information and anchors

Name the responsible layer, covered routing mechanism, meaningful bypasses and authorised exceptions.

Candidate anchor roles: public guarantee; shared owner/wrapper; routing mechanism; first-run, help, error or redispatch boundary. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 3 in [the skill](../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> The formatter owns stdout in machine mode; initialization notices use diagnostics, including the first invocation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [observable outcomes](observable-outcome-contracts.md) for agreement among result signals; use [phase ordering](phase-order-and-evidence-gates.md) when the obligation is a prerequisite before an effect.

Return to the [skill](../SKILL.md) for the type selector and review procedure.
