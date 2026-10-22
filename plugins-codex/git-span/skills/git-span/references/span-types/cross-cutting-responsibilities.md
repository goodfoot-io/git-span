# Cross-cutting responsibilities

Scope: declare a useful span using cross-cutting responsibilities.

## When to use this type

A guarantee applies across entrypoints or paths that could bypass its shared owner. A representative handler does not prove that every handler traverses the shared owner.

## Information and anchors

Name the responsible layer, covered routing mechanism, meaningful bypasses and authorised exceptions.

Candidate anchor roles: public guarantee; shared owner/wrapper; routing mechanism; first-run, help, error or redispatch boundary. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Compare normal, first-run and exception paths; verify the guarantee at each relevant bypass boundary.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> The formatter owns stdout in machine mode; initialization notices use diagnostics, including the first invocation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [observable outcomes](observable-outcome-contracts.md) for agreement among result signals; use [phase ordering](phase-order-and-evidence-gates.md) when the obligation is a prerequisite before an effect.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
