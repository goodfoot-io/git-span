# Observable outcome contracts

Scope: find and declare spans during behavioral review using observable outcome contracts.

## When to use this type

One operation communicates through status, payload, channels or artifacts that must agree. A newly correct exit status does not establish that the payload or artifact is correct.

## Information and anchors

State the outcome matrix: who classifies success or failure, what each public signal contains, and when required artifacts are complete.

Candidate anchor roles: public outcome contract; internal classifier; response/status adapter; complete-invocation observation. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether a changed wrapper, early return or artifact writer makes the outcome signals disagree.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Exercise the relevant success and failure branches; for artifact-producing operations, include a write failure and observe payload, status, diagnostics and artifact together.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> A failed report write emits the failure envelope and a nonzero status; success requires the completed report artifact.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [negative contracts](branch-specific-and-negative-contracts.md) when the decisive question is whether a branch emits a field or effect; use [cross-cutting responsibilities](cross-cutting-responsibilities.md) when it is which layer covers every entrypoint.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
