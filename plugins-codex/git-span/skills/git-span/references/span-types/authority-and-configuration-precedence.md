# Authority and configuration precedence

Scope: declare a useful span using authority and configuration precedence.

## When to use this type

Multiple sources can control a result and their values or interpretations may disagree. Preserve unresolved authority and scoped assumptions; a recorded decision does not itself authorise behavior changes.

## Information and anchors

State the winning source, merge/replace policy, absent/null/invalid/unavailable behavior, scope and evidence authorising supersession.

Candidate anchor roles: requirement/precedence table; source selector or merge; startup/reload reconstruction; contradictory-source example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Give sources different values and compare live resolution with restart/reconstruction; verify invalid-source and fallback behavior against the actual contract.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> A present request value overrides account settings, including explicit null to disable the option; only an absent request field inherits.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for preserving meaning across conversion; use [state lifecycle](state-lifecycle-and-recovery.md) when the winner is settled but must survive a transition.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
