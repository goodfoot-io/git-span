---
title: Writing Span Whys
summary: Evidence-based guidance for writing decision-preserving span context and completing its full lifecycle without stale whys or anchors.
aliases: [Decision-Preserving Span Whys, Lifecycle-Safe Span Whys]
tags: [guide, git-span]
keywords: [why, span, anchor, hook, context, invariant, authority, migration, evidence gate, lifecycle, drift]
---

# Writing span whys

Every span carries a **why** that hooks surface when an agent reads or edits an
anchored region. A useful why lets the agent quickly decide:

1. Whether the relationship is relevant to the current work.
2. Which nonlocal fact changes the safe decision.
3. Whether evidence authorizes a lifecycle transition.

The recommended strategy is:

> Write one or two complete, present-tense clauses that state the shared
> relationship and give decisive facts clear modal or evidentiary force.

Labels such as `Source:` and `Removal gate:` are optional scanning aids. The
important property is not labelled versus unlabelled formatting; it is whether
the text unmistakably states what is intentional, required, permitted,
authoritative, prohibited, or sufficient to change state.

When a gated transition occurs, finishing the work has three independent
obligations:

1. Make the correct behavior change.
2. Update or retire the substantive why.
3. Reconcile or retire every superseded anchor until `git span drift` reports
   zero drift.

Passing one obligation does not imply that the others passed.

## Definition

> A span why is compact, durable, decision-relevant context shared by its exact
> anchors. It states only nonlocal information that can prevent a plausible
> wrong decision and cannot be inferred reliably from any one anchor.

A why may identify authority, preserve an intentional difference, state an
invariant, describe lifecycle state, define a completion gate, or name focused
verification. It is not a task, change history, generic warning, command
transcript, or replacement for an enforceable mechanism.

Prefer one or two sentences. Aim for roughly 15–35 body tokens; use more when a
workflow or lifecycle needs an observable evidence gate. Every clause must be
relevant when activated from every member.

## What the controlled trials support

Controlled synthetic-repository trials compared span whys across Codex and a
second agent exposed through the local DeepSeek wrapper. The tasks were designed
so that an apparently reasonable local edit could violate a nonlocal decision.

Earlier migration-cleanup trials produced these combined results:

| Why strategy | Correct trials |
| --- | ---: |
| Router why plus local comments | 5/10 |
| Terse labelled fragments | 8/10 |
| Complete grammatical prose | 10/10 |

The fragment failures treated `State:` and `Remove when:` as mutable notes,
inferred migration completion from UUID-only callers and fixtures, and rewrote
the span to fit the local cleanup.

A later ablation held the decision constant while changing its form:

| Why form | Correct trials |
| --- | ---: |
| Labels followed by complete clauses | 10/10 |
| Neutral complete prose | 10/10 |
| Prose explicitly excluding invalid local evidence | 10/10 |

Each 10/10 result pools five runs per agent. This establishes parity among
complete-clause forms in that fixture, not that wording never matters. Across
that ablation and an evidence-gate matrix, all 54 trials met the primary source
oracle. The gate matrix was correct in 24/24 trials: compatibility remained
when evidence was absent, incomplete, contradicted, or unavailable, and was
removed when two clean releases satisfied the gate. One of the four valid
removals nevertheless retained an obsolete substantive why, demonstrating why
source and why correctness need separate scoring.

A subsequent 48-run lifecycle trial crossed two agents, four evidence states,
three why forms, and two repetitions. The forms were a complete gate, the same
gate plus an explicit why-maintenance sentence, and a terse gate plus maintenance
fragments. Codex ran `gpt-5.6-luna`; the wrapper was invoked with `opus`, which
resolved to `deepseek-v4-flash`, so results should name both the requested and
resolved model rather than treating them as identical.

| Lifecycle outcome | Result |
| --- | ---: |
| Correct source decision | 48/48 |
| Unmet, invalidated, or unavailable: no edit and accurate why | 36/36 |
| Gate met: compatibility removed and substantive why revised | 12/12 |
| Gate met: all anchors reconciled with zero drift | 7/12 |

All three forms reached 16/16 for source behavior and why semantics. The explicit
maintenance sentence therefore showed no marginal benefit in this ceiling
fixture. It should not be appended mechanically to every why. The terse form's
16/16 also does not overturn the earlier discriminating result of 8/10 for
fragments versus 10/10 for complete prose. Complete clauses remain the safer
default when wording must carry decision force.

The five lifecycle failures were anchor-maintenance failures, all from the
second-agent wrapper runs. Four added a new range anchor but left the obsolete
whole-file anchor in place; one revised only the why and left the changed
whole-file anchor unresolved. Codex reconciled 6/6 valid transitions; the
wrapper reconciled 1/6. This is evidence about the tested workflows, not a
general ranking of agents or why forms.

Delivery evidence existed in 48/48 lifecycle runs. It was explicit in the 24
wrapper event streams. In the 24 Codex runs it was strongly inferred from a
precise restatement of the decisive gate immediately after anchor access and
before any declaration read, because that interface did not serialize a
separate hook event. Keep this distinction when reporting hook transport.

These are small synthetic samples. They support a practical strategy, not a
universal law:

> Use complete clauses with clear decision force, treat evidence gates as
> bidirectional, and verify behavior, why state, and anchor state independently.

## Use complete clauses

Terse fragments may describe facts without saying how firmly they govern the
current state:

```text
State: write UUID; read UUID|int.
Remove when: two zero-reference releases.
```

Write the decision as a complete clause:

```text
State: Readers intentionally continue accepting integers.
Removal gate: Integer support remains required until two completed releases have each reported zero legacy references.
```

Or omit the labels:

```text
New writes use UUIDs, while readers intentionally continue accepting integers until two completed releases have each reported zero legacy references.
```

Both complete forms express standing repository state. Prefer verbs and
modifiers whose force is hard to mistake:

- `is authoritative`
- `intentionally differs`
- `remains required until`
- `must preserve`
- `never exposes`
- `may be removed only after`

Avoid shorthand such as `current state`, `should match`, `remove later`, or
bare lists of values. Compactness must not turn a decision into a status note.

## Labels are optional

Use a small shared vocabulary when it makes several facts easier to scan:

- `Contract:`
- `Source:` or `Authority:`
- `Invariant:`
- `Allow:` or `Difference:`
- `Never:`
- `State:`
- `Removal gate:`
- `Flow:`
- `On edit:`
- `Verify:`

Labels are authoring conventions, not a machine-readable schema. Follow them
with complete clauses:

```text
Authority: The protocol schema is authoritative, and clients conform to it.
Difference: Mobile intentionally omits operations unavailable in the background.
Removal gate: The fallback remains required until two releases report zero legacy use.
```

Do not reduce the same content to ambiguous fragments:

```text
Source: schema.json.
Allow: mobile omissions.
Remove when: zero use.
```

For a single decision, unlabelled prose is usually easier to read. Labels are
most useful when they separate two or three independent dimensions of a shared
workflow.

## Make evidence gates operational and bidirectional

Lifecycle text must distinguish valid completion evidence from local clues.
Prefer observable, durable evidence:

```text
The legacy reader remains required until two completed releases each report zero legacy references.
```

When agents could plausibly substitute invalid evidence, say so concisely:

```text
The legacy reader remains required until release telemetry satisfies the gate; current writers, fixtures, and callers do not establish completion.
```

Use the extra exclusion only when the tempting substitute is realistic. The
wording ablation did not show it outperforming other complete clauses, so do
not add it mechanically.

A gate is bidirectional. It must prevent a premature transition and permit a
legitimate one:

```text
Integer reads may be removed only after two completed releases each report zero legacy references; a newer legacy event invalidates the gate.
```

- With one clean release, preserve integer reads.
- With two clean releases and no newer legacy event, removal is authorized.
- With two clean releases followed by a newer legacy event, preserve integer
  reads.
- With unavailable telemetry, fail closed: preserve the behavior and report
  that completion is unproven.

Do not preserve temporary compatibility forever after the named evidence is
satisfied. Conversely, do not treat local callers, current fixtures, or new
write paths as substitutes for release evidence.

## Complete the entire span lifecycle

After a gate is satisfied and the behavior changes, the old why has completed
its job. Rewrite it to describe the resulting standing relationship, or delete
the span if no meaningful coupling remains:

```text
Before: Readers intentionally continue accepting integers until two completed releases each report zero legacy references.
After: User IDs are UUID strings produced by the writer and consumed unchanged by the reader.
```

Updating the why is necessary but not sufficient. The declaration must also
point only at current anchors. A content or range change can leave a former
whole-file or line-range anchor stale even after a new range is added.

For procedural mechanics, follow the git-span skill and command documentation.
The essential invariant is:

```text
git span remove <name> <old-anchor>
git span add <name> <new-anchor>
git span drift <name>
```

`git span add` appends or refreshes the specified anchor; it does not retire a
different anchor that the new one supersedes. Finish only when the scoped drift
check exits successfully with zero drift. If the coupling itself no longer
exists, retire the whole span rather than inventing a new relationship around
leftover code.

Do not put these CLI instructions into every why. The why should carry the
decision; skills and repository documentation should carry repeatable
maintenance procedure. Add a maintenance clause only when it conveys
relationship-specific policy that generic tooling guidance cannot infer.

## Write the smallest decision-preserving statement

Begin with the relationship. Add only the fact that changes a plausible local
decision.

Router only:

```text
The Rust CLI and extension parse the same span declaration language.
```

Decision preserving:

```text
The Rust CLI and extension intentionally accept the same declarations, and parser edits remain incomplete until both pass the shared corpus.
```

Do not include every fact known about the subsystem. A why earns its hook
activation by supplying information the anchor does not reliably provide.

## Patterns

### Temporary compatibility

```text
New writes use UUIDs, while readers intentionally continue accepting integers until two completed releases each report zero legacy references; newer legacy events invalidate the gate.
```

### Intentional asymmetry

```text
Refresh failures log out every client, but retry behavior intentionally differs: the web retries once and mobile never retries while backgrounded.
```

Name both the permitted difference and any surrounding behavior that must
still agree. This prevents an exception from becoming permission for unrelated
divergence.

### Source of truth

```text
The refund eligibility catalog is authoritative, and billing code, UI, and documentation never broaden its policy independently.
```

Authority should identify both the winner and the consequence. Verify that the
claim follows maintained policy, generation flow, ownership, or enforcement;
do not invent authority merely to resolve disagreement.

### Security prohibition

```text
Password-reset tokens remain confined to HTTPS request bodies and never enter URLs, logs, analytics, traces, or support events.
```

Name the protected data and prohibited representations precisely. “Never emit
tokens” does not necessarily answer whether a redacted URL is allowed.

### Shared performance budget

```text
Decode, resize, and cache stages share a 256 MB peak-memory ceiling for 100 images; buffering edits require the thumbnail-memory benchmark.
```

The benchmark enforces the number; the why supplies the nonlocal scope and
when the focused check matters.

### Distributed workflow

```text
Invoice delivery is at least once, uses the invoice ID for idempotency, and requires support replay to preserve that original key.
```

### Public and internal representations

```text
Public plans are Free, Pro, and Business, while internal billing codes intentionally remain private and never cross API, UI, or documentation boundaries.
```

### Written facts

```text
The finalized revenue dataset is authoritative, and every report section uses net USD millions with rounding only at display time.
```

Consistency alone is insufficient when all representations can repeat the same
wrong fact.

### Contextual verification

```text
The Rust CLI and extension accept the same declarations; parser edits require both implementations to pass the shared corpus.
```

Name a command only when it is stable and not readily discoverable. Make the
trigger conditional so a read-only activation does not sound like a work
order.

## Keep activation safe

Every hook activation interrupts another task. A why should be quick to
classify and relevant from every anchor.

- Anchor the smallest coherent regions governed by the same decision.
- Do not instruct an agent to edit every anchor automatically.
- Make edit-only checks conditional.
- Split spans with different authorities, lifetimes, gates, or exceptions.
- Avoid overlapping spans that restate the same decision.
- Treat contradictory repository evidence as a staleness signal to resolve.
- Report an unresolved conflict instead of silently choosing by hook order.

An unrelated read should require no work. Clear conditional grammar such as
“parser edits require” helps an agent distinguish durable context from an
immediate instruction.

## What does not belong in a why

### Change history

```text
We switched IDs to UUIDs after integer collisions caused issue #482.
```

State the standing compatibility decision, not its story.

### Generic span-maintenance procedure

```text
After editing, run remove, add, why, drift, tests, and status.
```

Keep generic commands in skills or repository instructions. A why should not
spend its hook budget teaching routine CLI usage.

### Vague warnings

```text
These files are important and should stay in sync.
```

Name the authority, invariant, permitted difference, or evidence gate.

### Inferable implementation

```text
The worker calls sendInvoice and increments retryCount on failure.
```

Visible control flow does not justify injected context. State nonlocal delivery
semantics instead.

### Unconditional work orders

```text
Run all tests, update every client, and ask the platform team for review.
```

Broad workflow belongs in repository instructions, CI, or ownership controls.
Include focused verification only when it is specific to the anchored decision
and conditional on a relevant edit.

### Unsupported or absolute lifecycle claims

```text
The fixture is authoritative.
Never remove integer support.
```

Verify authority before recording it. Replace permanent prohibitions on
temporary behavior with evidence-gated state transitions.

## Prefer stronger mechanisms

Use shared implementations, types, schemas, tests, linters, benchmarks, CI,
or ownership rules when they can fully express and enforce the requirement. A
span may supplement them with unique nonlocal decision context; it should not
replace them.

Do not create a span when one local comment reaches every relevant reader, a
glob rule selects the real scope, the relationship is obvious from structure,
or the association existed only for the current task.

## Validation checklist

Before accepting a why:

1. Read every anchor from the final working tree.
2. Name the plausible wrong local decision the why prevents.
3. State the relationship in complete, present-tense clauses.
4. Add only the required intentionality, authority, invariant, exception, or
   evidence gate.
5. Ensure each label is followed by a complete clause.
6. Make temporary state removable through observable evidence.
7. Distinguish valid completion evidence from tempting local substitutes when
   needed.
8. Make the gate authorize its valid transition as well as block invalid ones.
9. After a transition, verify the behavior and update or retire the substantive
   why.
10. Retire every superseded anchor; remember that `add` does not replace a
    different whole-file or range anchor.
11. Require `git span drift` to exit successfully with zero drift.
12. Simulate activation from every anchor, including an unrelated read.
13. Verify every named source, metric, command, and document exists and is
    current.
14. Check for overlapping, stale, or conflicting spans.
15. Remove inferable detail, generic CLI procedure, and unconditional work
    orders.
16. Confirm no executable or structural mechanism should replace the span.

The final test is:

> If an agent encounters any anchor independently, does this why preserve the
> intended decision, permit valid state changes, and leave both its meaning and
> anchor set accurate after the change?

## Related

- [Git Span Documentation Touchpoints](../meta/git-span-documentation-touchpoints.md)
  — related documentation surfaces to review when this convention changes.
