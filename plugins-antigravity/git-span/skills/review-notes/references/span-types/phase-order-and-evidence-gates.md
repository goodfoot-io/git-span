# Phase ordering and evidence gates

Scope: find and declare spans during behavioral review using phase ordering and evidence gates.

## When to use this type

A check, decision or effect is valid only after information or evidence becomes available. A stated gate is context, not an executable guard; independent stages need no invented total order.

## Information and anchors

Name the prerequisite, dependent decision, necessary partial order and authority for the gate; separate runtime readiness from permission to change policy.

Candidate anchor roles: producer of facts; binder/merger or probe; ordering boundary; first dependent check or effect. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether a moved validator now runs before binding, merging or probing, or after the first protected effect.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Contrast declaration with bound invocation, or unmet with satisfied prerequisites; verify no dependent effect occurs prematurely.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Alias declaration stores a callable without invocation values; required-argument validation runs after invocation bindings are merged.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [state lifecycle](state-lifecycle-and-recovery.md) for transitions and retained state; use [authority and precedence](authority-and-configuration-precedence.md) when the question is which source permits a decision.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
