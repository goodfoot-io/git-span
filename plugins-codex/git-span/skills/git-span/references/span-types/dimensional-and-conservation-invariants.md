# Dimensional and conservation invariants

Scope: declare a useful span using dimensional and conservation invariants.

## When to use this type

A calculation depends on units, classification, rounding boundaries or a balance across operations. State waste, fees, yields or other exceptions rather than inventing a neat but false conservation law.

## Information and anchors

State the equation, quantity units, input authority, rounding stage and accounted exceptions over the relevant scope.

Candidate anchor roles: domain units/classification table; conversion or planning formula; allocation ledger; feasibility/reporting consumer. Select existing content carrying the rule or likely to be encountered at the risky decision. These are roles, not a required anchor count.

## Declare

1. Identify the risky local assumption and its authoritative rule; label inference or unresolved requirements.
2. Inspect existing spans before adding another. Choose anchors that expose the decisive information, including a single-anchor reminder when useful.
3. Select applicable distinguishing evidence: Use a partial-batch or boundary quantity and reconcile the balance; distinguish rounding each item from rounding the total.
4. Write the rule, scope and evidence limits in the why, then use the declaration recipe in [the skill](../../SKILL.md).

## Illustrative why

> Available inventory plus purchases equals consumption plus ending inventory per material; whole-batch production carries surplus forward.

This example supplies no authority for another repository. Substitute its actual contract and scope; quote decisive requirement wording where available.

## Adjacent types

Use [representation boundaries](representation-boundaries.md) for encoding a quantity, or [diagnostic evidence](diagnostic-evidence-and-causal-localization.md) when the missing information is which calculation stage caused a discrepancy.

Return to the [type selector](index.md) or [span guidance](../span-guidance.md) for authority, anchor delivery and test-reference rules. The suggested checks require separate execution; a span does not run them.
