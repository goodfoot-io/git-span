# Authority and configuration precedence

Scope: find and declare spans during behavioral review using authority and configuration precedence.

## When to use this type

Multiple sources can control a result and their values or interpretations may disagree. Preserve unresolved authority and scoped assumptions; a recorded decision does not itself authorise behavior changes.

## Information and anchors

State the winning source, merge/replace policy, absent/null/invalid/unavailable behavior, scope and evidence authorising supersession.

Candidate anchor roles: requirement/precedence table; source selector or merge; startup/reload reconstruction; contradictory-source example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether a new load order, fallback or rationale changes the authorised winner; committed implementation shows intent, not permission to supersede requirements.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Give sources different values and compare live resolution with restart/reconstruction; verify invalid-source and fallback behavior against the actual contract.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> A present request value overrides account settings, including explicit null to disable the option; only an absent request field inherits.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for preserving meaning across conversion; use [state lifecycle](state-lifecycle-and-recovery.md) when the winner is settled but must survive a transition.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
