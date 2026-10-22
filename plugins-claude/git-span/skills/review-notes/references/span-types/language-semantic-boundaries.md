# Language semantic boundaries

Scope: find and declare spans during behavioral review using language semantic boundaries.

## When to use this type

An interpreted or translated construct differs from its implementation language. Do not infer a universal language rule from one sample; preserve dialect and version uncertainty.

## Information and anchors

Name the dialect, exact semantic distinction and a counterexample to the tempting host-language substitution.

Candidate anchor roles: language requirement or semantic table; parser/lowering rule; evaluator helper; discriminating example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether a parser/helper simplification imports host truthiness, precedence, equality or aggregate defaults.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Choose a case that separates the specified semantics from the tempting host default: negative operands, associativity, nulls or aggregate inputs as applicable.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> The expression contract truncates integer division toward zero; negative operands differ from the host floor-division operator.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [scope and identity](scope-and-identity.md) for binding ownership, [phase ordering](phase-order-and-evidence-gates.md) for when bindings become available, or [disambiguating examples](disambiguating-examples-and-counterexamples.md) when the language rule remains unresolved.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
