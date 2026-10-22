# Language semantic boundaries

Scope: declare a useful span using language semantic boundaries.

## When to use this type

An interpreted or translated construct differs from its implementation language. Do not infer a universal language rule from one sample; preserve dialect and version uncertainty.

## Information and anchors

Name the dialect, exact semantic distinction and a counterexample to the tempting host-language substitution.

Candidate anchor roles: language requirement or semantic table; parser/lowering rule; evaluator helper; discriminating example. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Choose a case that separates the specified semantics from the tempting host default: negative operands, associativity, nulls or aggregate inputs as applicable.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> The expression contract truncates integer division toward zero; negative operands differ from the host floor-division operator.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [scope and identity](scope-and-identity.md) for binding ownership, [phase ordering](phase-order-and-evidence-gates.md) for when bindings become available, or [disambiguating examples](disambiguating-examples-and-counterexamples.md) when the language rule remains unresolved.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
