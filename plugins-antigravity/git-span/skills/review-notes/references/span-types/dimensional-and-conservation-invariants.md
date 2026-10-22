# Dimensional and conservation invariants

Scope: find and declare spans during behavioral review using dimensional and conservation invariants.

## When to use this type

A calculation depends on units, classification, rounding boundaries or a balance across operations. State waste, fees, yields or other exceptions rather than inventing a neat but false conservation law.

## Information and anchors

State the equation, quantity units, input authority, rounding stage and accounted exceptions over the relevant scope.

Candidate anchor roles: domain units/classification table; conversion or planning formula; allocation ledger; feasibility/reporting consumer. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Review and add

1. Begin with the reviewed change and affected consumer: Check classifier inputs, unit conversions and rounding before changing the final formula; compare feasibility with the reported plan.
2. Establish the rule independently of the changed implementation. Distinguish a defect, an authorised change and an unresolved requirement before editing metadata.
3. Obtain or propose applicable distinguishing evidence: Use a partial-batch or boundary quantity and reconcile the balance; distinguish rounding each item from rounding the total.
4. Inspect existing spans at the changed site and participating locations. Extend a useful existing span; otherwise propose a new span carrying this rule and scope, then follow step 5b in [the skill](../../SKILL.md). A useful single-anchor reminder is eligible.
5. Report the changed decision, evidence limits and unresolved finding to the parent. Leave span edits unstaged; the parent owns production edits, validation and commits.

## Illustrative why

> Available inventory plus purchases equals consumption plus ending inventory per material; whole-batch production carries surplus forward.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for encoding a quantity, or [diagnostic evidence](diagnostic-evidence-and-causal-localization.md) when the missing information is which calculation stage caused a discrepancy.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
