# External protocol and environment contracts

Scope: find and declare spans during behavioral review using external protocol and environment contracts.

## When to use this type

A local adapter depends on an exact external exchange, capability or execution context. Inspect dependency capability and actual imported artifact rather than version strings alone; fixtures do not prove live compatibility.

## Information and anchors

State invocation/exchange, cwd/environment, response/status, readiness/completion stages and applicable version; separate probes from requested work.

Candidate anchor roles: adapter or probe; environment constructor; protocol authority or sanitized fixture; completion/reconnect path. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check invocation arguments, cwd/environment, version identity and restored subscriptions before attributing failure to downstream work.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Compare the actual exchange and artifact location with the contract; distinguish connection, readiness and completed work.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Task-relative paths resolve in the assigned workspace; configured variables enter the child environment before expansion, and success includes the expected artifact there.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [authority and precedence](authority-and-configuration-precedence.md) for configuration winner rules, [phase ordering](phase-order-and-evidence-gates.md) for prerequisites, or [diagnostic evidence](diagnostic-evidence-and-causal-localization.md) for locating the failed exchange stage.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
