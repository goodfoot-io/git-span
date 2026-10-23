# External protocol and environment contracts

Scope: add and update spans for external protocol and environment contracts.

## When to use this type

A local adapter depends on an exact external exchange, capability or execution context. Inspect dependency capability and actual imported artifact rather than version strings alone; fixtures do not prove live compatibility.

## Information and anchors

State invocation/exchange, cwd/environment, response/status, readiness/completion stages and applicable version; separate probes from requested work.

Candidate anchor roles: adapter or probe; environment constructor; protocol authority or sanitized fixture; completion/reconnect path. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Add or update a span

1. Locate the rule and participating locations using the anchor roles above. Preserve its authority, scope and evidence limits in the why.
2. Inspect existing spans at those locations. Extend useful coverage; otherwise add a span following step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
3. Update anchors and the why when the relationship changes; preserve unresolved authority or interpretation explicitly.

## Illustrative why

> Task-relative paths resolve in the assigned workspace; configured variables enter the child environment before expansion, and success includes the expected artifact there.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [authority and precedence](authority-and-configuration-precedence.md) for configuration winner rules, [phase ordering](phase-order-and-evidence-gates.md) for prerequisites, or [diagnostic evidence](diagnostic-evidence-and-causal-localization.md) for locating the failed exchange stage.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules.
