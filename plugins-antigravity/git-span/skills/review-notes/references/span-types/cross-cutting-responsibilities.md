# Cross-cutting responsibilities

Scope: find and declare spans during behavioral review using cross-cutting responsibilities.

## When to use this type

A guarantee applies across entrypoints or paths that could bypass its shared owner. A representative handler does not prove that every handler traverses the shared owner.

## Information and anchors

Name the responsible layer, covered routing mechanism, meaningful bypasses and authorised exceptions.

Candidate anchor roles: public guarantee; shared owner/wrapper; routing mechanism; first-run, help, error or redispatch boundary. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check new entrypoints, wrappers and early returns against the claimed ownership; forwarding an option is separate from parsing it.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Compare normal, first-run and exception paths; verify the guarantee at each relevant bypass boundary.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> The formatter owns stdout in machine mode; initialization notices use diagnostics, including the first invocation.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [observable outcomes](observable-outcome-contracts.md) for agreement among result signals; use [phase ordering](phase-order-and-evidence-gates.md) when the obligation is a prerequisite before an effect.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
