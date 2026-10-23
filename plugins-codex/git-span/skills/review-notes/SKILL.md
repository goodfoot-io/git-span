---
name: review-notes
description: Add and maintain spans
---

<span-types>
### Outcomes and representation

When public observations, converted values or branch-specific omissions must agree.

| When | Type and information to preserve |
|---|---|
| One operation communicates through status, payload, channels or artifacts that must agree. | [Observable outcome contracts](./span-types/observable-outcome-contracts.md): State the outcome matrix: who classifies success or failure, what each public signal contains, and when required artifacts are complete. |
| A value crosses input, internal, persisted or output representations and may lose meaning. | [Representation boundaries](./span-types/representation-boundaries.md): State accepted forms, the internal meaning, canonical output and distinctions intentionally preserved or erased, including absence, null, false and zero. |
| A branch requires a field, action or state change to be absent. | [Branch-specific and negative contracts](./span-types/branch-specific-and-negative-contracts.md): State the branch condition and observations or effects that must be omitted; distinguish absence from null, false and an empty container. |

### Language and quantitative meaning

When host semantics, units, rounding or balances can change a result.

| When | Type and information to preserve |
|---|---|
| An interpreted or translated construct differs from its implementation language. | [Language semantic boundaries](./span-types/language-semantic-boundaries.md): Name the dialect, exact semantic distinction and a counterexample to the tempting host-language substitution. |
| A calculation depends on units, classification, rounding boundaries or a balance across operations. | [Dimensional and conservation invariants](./span-types/dimensional-and-conservation-invariants.md): State the equation, quantity units, input authority, rounding stage and accounted exceptions over the relevant scope. |

### State, identity and effects

When ordering, transitions, identity or partial effects govern correctness.

| When | Type and information to preserve |
|---|---|
| A check, decision or effect is valid only after information or evidence becomes available. | [Phase ordering and evidence gates](./span-types/phase-order-and-evidence-gates.md): Name the prerequisite, dependent decision, necessary partial order and authority for the gate; separate runtime readiness from permission to change policy. |
| Correctness depends on transitions, reset, persistence, restoration or cache lifetime. | [State lifecycle and recovery](./span-types/state-lifecycle-and-recovery.md): State initial observations, transition and reverse/reset rules, authoritative versus derived state, and the data required for continuity. |
| A name, key or path could discard context needed to distinguish or equate entities. | [Scope and identity](./span-types/scope-and-identity.md): State the key recipe, partition/binding/invocation dimensions, intentional sharing and aliases that denote the same entity. |
| Failure, cancellation, rollback or retry could leave partial or duplicated effects. | [Transactional effects and reversal](./span-types/transactional-effects-and-reversal.md): Name prepare/commit boundaries, actual atomicity limits, durable recovery evidence and permitted compensation or replay behavior. |

### Entrypoints, extensions and adapters

When discovery, shared coverage, compatibility, backends or external exchanges can diverge.

| When | Type and information to preserve |
|---|---|
| A guarantee applies across entrypoints or paths that could bypass its shared owner. | [Cross-cutting responsibilities](./span-types/cross-cutting-responsibilities.md): Name the responsible layer, covered routing mechanism, meaningful bypasses and authorised exceptions. |
| An extension could impose new requirements on behavior that remains explicitly supported. | [Compatibility and extension boundaries](./span-types/compatibility-and-extension-boundaries.md): Name the supported earlier specimen, new boundary it crosses, promised observation, scope/version and authorised retirement condition. |
| Parallel backends or platform copies promise equivalent behavior despite native differences. | [Cross-backend behavioral equivalence](./span-types/cross-backend-behavioral-equivalence.md): Name the common authority, semantic slice, backend-specific mechanisms, permitted differences and representative coverage limit. |
| Finding a candidate does not establish eligibility for strict interpretation or execution. | [Discovery and interpretation boundaries](./span-types/discovery-and-interpretation-boundaries.md): State discovery scope, ownership predicate, strict validation boundary, ignore/error policy and exactly-once identity where relevant. |
| A local adapter depends on an exact external exchange, capability or execution context. | [External protocol and environment contracts](./span-types/external-protocol-and-environment-contracts.md): State invocation/exchange, cwd/environment, response/status, readiness/completion stages and applicable version; separate probes from requested work. |

### Evidence and authority

When examples, diagnostics or competing sources determine the justified decision.

| When | Type and information to preserve |
|---|---|
| Available examples fit competing plausible rules and a distinguishing observation could change the choice. | [Disambiguating examples and counterexamples](./span-types/disambiguating-examples-and-counterexamples.md): Name competing hypotheses, what existing evidence establishes, a discriminator and any still-unresolved choice or authorised tie-break. |
| An opaque symptom admits multiple causes and evidence must cross a boundary to choose a repair. | [Diagnostic evidence and causal localization](./span-types/diagnostic-evidence-and-causal-localization.md): Name candidate causes, evidence origin, fields/channel retained, correlation identity and the conclusions each observation supports. |
| Multiple sources can control a result and their values or interpretations may disagree. | [Authority and configuration precedence](./span-types/authority-and-configuration-precedence.md): State the winning source, merge/replace policy, absent/null/invalid/unavailable behavior, scope and evidence authorising supersession. |

</span-types>

<instructions>
## 1. Capture the work

```bash
git span notes list --format json
```

## 2. Review changes

```bash
git show --format=fuller --root -M --stat --patch <sha>
git rev-list --parents -n 1 <sha> # merges: inspect git diff -M <parent> <sha> for each parent
git log --oneline <sha>..HEAD -- <paths>
git span context '<path>' '<path>#L<start>-L<end>'
git span list '<path>' --oneline
git span show <span-name>
```

## 3. Add and update spans

See `<span-types>` for guidance on what to include.

```bash
git span add <span-name> '<path-a>#L<start>-L<end>' ['<path-b>#L<start>-L<end>' ...]
git span why <span-name> "<why>"
```

After validation, or recorded evidence that no change was needed:

```bash
git span notes remove <id> --format json
```

## 4. Challenge shared assumptions

For each new or pre-existing span, ask:

> What must another participant guarantee for this rule to remain correct?
> Did these changes alter that guarantee, and where is it still enforced?

Inspect the supplying and relying decisions. Look for changes to input eligibility,
representation, identity/scope, state lifetime, ordering, effects or combined limits.

Derive expected behavior from requirements and supported consumers. Code, commit
rationale and existing whys show intent; they do not authorise a requirement change.
Preserve conflicting authority and uncertainty.

A concrete concern needs the participants, changed assumption, reachable input or
sequence, supported expected result and observable possible violation. Co-change or
drift alone is not a finding. If the condition is preserved, cite the enforcement
path or concrete trace and continue; do not invent a test quota.

## 5. Report

Output a report:

- A concise summary of spans you created, updated, or removed in step #3 and the reasoning behind the changes.
- A detailed list of concrete concerns from step #4.

</instructions>