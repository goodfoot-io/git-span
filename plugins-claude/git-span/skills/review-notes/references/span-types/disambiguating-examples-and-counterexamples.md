# Disambiguating examples and counterexamples

Scope: find and declare spans during behavioral review using disambiguating examples and counterexamples.

## When to use this type

Available examples fit competing plausible rules and a distinguishing observation could change the choice. Invented examples probe hypotheses; their expected values do not become requirements without supporting authority.

## Information and anchors

Name competing hypotheses, what existing evidence establishes, a discriminator and any still-unresolved choice or authorised tie-break.

Candidate anchor roles: rule-selection code; domain requirement; discriminating fixture/sequence; policy for unresolved alternatives. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check whether an updated example still distinguishes the intended alternatives or an inferred rule was promoted to authority.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Use an offset identifier, interleaved keys, repeated rank value or threshold case that separates named alternatives after preprocessing.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Position is independent of record identifier; the offset-identifier example distinguishes an ordinal from copying the input field.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [language semantics](language-semantic-boundaries.md) once a language rule is established, or [diagnostic evidence](diagnostic-evidence-and-causal-localization.md) when observations separate failure causes rather than intended rules.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
