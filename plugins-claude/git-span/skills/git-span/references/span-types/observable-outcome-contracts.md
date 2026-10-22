# Observable outcome contracts

Scope: declare a useful span using observable outcome contracts.

## When to use this type

One operation communicates through status, payload, channels or artifacts that must agree. A newly correct exit status does not establish that the payload or artifact is correct.

## Information and anchors

State the outcome matrix: who classifies success or failure, what each public signal contains, and when required artifacts are complete.

Candidate anchor roles: public outcome contract; internal classifier; response/status adapter; complete-invocation observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Exercise the relevant success and failure branches; for artifact-producing operations, include a write failure and observe payload, status, diagnostics and artifact together.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> A failed report write emits the failure envelope and a nonzero status; success requires the completed report artifact.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [negative contracts](branch-specific-and-negative-contracts.md) when the decisive question is whether a branch emits a field or effect; use [cross-cutting responsibilities](cross-cutting-responsibilities.md) when it is which layer covers every entrypoint.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
