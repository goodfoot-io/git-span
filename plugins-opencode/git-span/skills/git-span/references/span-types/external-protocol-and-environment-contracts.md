# External protocol and environment contracts

Scope: declare a useful span using external protocol and environment contracts.

## When to use this type

A local adapter depends on an exact external exchange, capability or execution context. Inspect dependency capability and actual imported artifact rather than version strings alone; fixtures do not prove live compatibility.

## Information and anchors

State invocation/exchange, cwd/environment, response/status, readiness/completion stages and applicable version; separate probes from requested work.

Candidate anchor roles: adapter or probe; environment constructor; protocol authority or sanitized fixture; completion/reconnect path. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Compare the actual exchange and artifact location with the contract; distinguish connection, readiness and completed work.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> Task-relative paths resolve in the assigned workspace; configured variables enter the child environment before expansion, and success includes the expected artifact there.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [authority and precedence](authority-and-configuration-precedence.md) for configuration winner rules, [phase ordering](phase-order-and-evidence-gates.md) for prerequisites, or [diagnostic evidence](diagnostic-evidence-and-causal-localization.md) for locating the failed exchange stage.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
