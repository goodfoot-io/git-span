---
title: Evaluating span whys
summary: A reproducible protocol for testing whether hook-delivered span whys improve decisions and remain correct through decision lifecycles.
aliases: [Span why evaluation, Testing span whys, Span why lifecycle evaluation]
tags: [guide, git-span, evaluation, codex, hooks]
keywords: [why, span, hook, codex exec, claude, deepseek, oracle, lifecycle, evidence gate, anchor drift]
---

# Evaluating span whys

Evaluate a why by whether it produces the right repository decision and remains
truthful after that decision changes. A passing source diff is necessary, but it
is not sufficient: score source behavior, why semantics, anchor reconciliation,
hook delivery, and mutation scope independently.

This guide complements [Writing span whys](writing-span-whys.md). It tests
writing strategies; it is not a benchmark of one model against another.

## What the trials have established

### Lifecycle-completion run

The lifecycle run used `gpt-5.6-luna` through Codex and requested `opus`
through the local DeepSeek wrapper. The wrapper resolved that alias to
`deepseek-v4-flash`. It crossed three why forms with four evidence states, two
agents, and two repetitions:

| Dimension | Conditions |
|---|---|
| Why form | Complete gate; complete gate plus maintenance instruction; fragment plus maintenance instruction |
| Evidence | Unmet; met; met then invalidated; unavailable |
| Agent | Codex; local DeepSeek wrapper |
| Repetition | Two per cell |

All 48 processes exited successfully and made the correct source decision.
All 36 unmet, invalidated, or unavailable trials preserved compatibility and
made no repository edits. All 12 met trials removed compatibility and revised
the substantive why so that it no longer claimed integer support remained
intentional.

Every form was 16/16 for source correctness and why semantics. This is a ceiling
result for this fixture, not evidence that the forms are universally
equivalent. In the earlier, more discriminating migration fixture, terse
fragments scored 8/10 while complete prose scored 10/10. The lifecycle prompt
did not explicitly require span reconciliation, but the configured plugin and
skill supplied generic maintenance guidance after relevant actions. The run
therefore did not isolate why wording from all other maintenance guidance.

Explicit maintenance wording did not improve the measured lifecycle outcome in
this fixture: even the complete-gate-only condition revised the why in every met
trial. Treat that as no observed treatment effect in a ceiling fixture, not as
evidence that explicit lifecycle wording can never help.

### Anchor topology was the discriminating outcome

Only 7/12 met trials finished with drift-free anchors:

| Agent | Drift-free after valid transition |
|---|---:|
| Codex (`gpt-5.6-luna`) | 6/6 |
| Requested `opus`, resolved `deepseek-v4-flash` | 1/6 |

In four DeepSeek trials, the agent added a new range for the edited reader but
did not retire the old whole-file anchor. In a fifth, it revised the why but
left the changed whole-file anchor unresolved without adding a replacement.
The whys were semantically accurate and the source decisions were correct, yet
the spans still contained stale anchor state. This is why “the span exists” and
“the why changed” cannot stand in for a drift check.

Treat this as an observed engine-specific failure mode in one fixture, not a
general model ranking. The agents had different runtimes, system instructions,
tools, and hook implementations.

### Delivery evidence was established by event order

Manual review found delivery evidence before any direct declaration inspection
in 48/48 trials, with different strength across runtimes:

- All 24 DeepSeek traces contained an explicit `hook_response` event carrying
  `<git-span>` context for `user-id-lifecycle` before the decision.
- All 24 Codex structured results reported `span_context_seen: true` and
  precisely restated the decisive gate immediately after anchor access and
  before any declaration read. Codex did not serialize explicit hook events, so
  this is strong delivery evidence rather than direct transport confirmation.
- No trace directly read a span declaration before delivery.

The raw harness fields `deliveryConfirmed` and `directSpanRead` are not valid
aggregate measures for this run. Their regular expressions searched serialized
events broadly enough to mistake instructions, hook payloads, or later span
maintenance commands for direct declaration reads. Use the manual event-order
audit above as the authoritative assessment. Report explicit delivery for the
wrapper and strongly inferred delivery for Codex; do not turn both into a
categorical 48/48 hook-transport claim. Do not quote counts produced by those
two raw fields.

### Relationship to earlier evidence

The preceding 54-run study found:

| Test | Condition | Correct source decisions |
|---|---|---:|
| Grammar/modality ablation | Complete labelled clauses | 10/10 |
| Grammar/modality ablation | Neutral complete prose | 10/10 |
| Grammar/modality ablation | Prose excluding invalid evidence | 10/10 |
| Evidence-gate matrix | Six evidence states | 24/24 |

That study showed that labels were not the problem: complete labelled clauses
performed as well as complete prose. It also showed that a satisfied gate can
authorize a transition rather than merely block unsafe edits. However, one of
its four valid removals refreshed an anchor hash while leaving stale decision
text. The lifecycle run closed that gap for why semantics—12/12 valid removals
revised the why—and exposed anchor topology as a separate remaining failure
mode.

Across these studies, the defensible conclusions are narrow:

- Complete clauses with explicit modality reliably communicate the tested
  decision gates.
- A why should state both the current decision and the evidence that permits a
  transition.
- A completed transition requires why revision or retirement.
- Semantic why correctness does not prove anchor reconciliation.
- Perfect scores in one low-ambiguity fixture do not establish that terse
  fragments are generally equivalent to complete prose.

## Define independent oracles before running

Write the oracle outside the agent-visible repository. Do not reduce it to one
pass/fail value. At minimum, define these dimensions.

### 1. Source behavior

Specify the required source state for every evidence condition. For an evidence
gate:

```json
{
  "unmet": "preserve compatibility",
  "met": "remove compatibility",
  "invalidated": "preserve compatibility",
  "unavailable": "preserve compatibility"
}
```

Assert behavior or syntax directly. Do not trust the final explanation.

### 2. Why semantics

When the gate is not satisfied, require the why to keep the current decision
and gate. When it is satisfied and the source transitions, require the why to be
revised or retired. A new hash wrapped around stale prose is a failure.

Prefer semantic checks over exact-string equality. At minimum detect whether a
post-transition why still asserts the retired state. Manually inspect borderline
rewrites rather than expanding a permissive regular expression after seeing the
answers.

### 3. Anchor reconciliation

Run `git span drift` for each surviving span and inspect the declaration when
the output is nonzero. Score at least:

- Every intended anchor still exists.
- Changed anchors point at the resulting source.
- Superseded whole-file or range anchors were retired.
- No duplicate range was added as a substitute for updating an old anchor.
- The span was not deleted merely to avoid reconciliation.

Record semantic why accuracy and anchor reconciliation separately. A run can
pass one and fail the other, as five lifecycle trials did.

### 4. Delivery provenance

Establish a temporal chain:

1. The agent uses a supported tool to access an anchor.
2. The hook runs or the runtime emits an equivalent delivery signal.
3. The decisive why content reaches the model.
4. Only then does the model decide, edit, or inspect span declarations.

An explanation saying `span_context_seen: true` is corroboration, not proof.
Likewise, seeing the why somewhere in a JSONL file does not prove when or how it
was delivered.

### 5. Mutation scope

List allowed changed files and flag everything else. Capture committed and
uncommitted changes:

```bash
git diff --name-only "$BASELINE_COMMIT..HEAD"
git diff --name-only "$BASELINE_COMMIT"
git diff --name-only
git status --short
```

For content, archive both `git diff "$BASELINE_COMMIT..HEAD"` and the working
tree diff. An agent may commit its work, leaving `git diff` alone empty.

### 6. Process validity

Record exit status, inference start, timeout, requested model, resolved model,
plugin initialization, tools, sandbox, duration, tokens, and cost. An
infrastructure failure is an invalid trial, not a wrong repository decision.

## Lifecycle matrix template

Use a repository in which writers already emit the new representation, readers
still accept the old representation, and operational evidence controls removal.
Commit the same baseline into a fresh repository for every run.

Hold the task constant:

> Start by reading the reader anchor. Determine from repository evidence whether
> legacy compatibility can be removed, then implement the minimal correct
> result. Do not guess unavailable evidence.

For a hook-delivery study, add the same transport-control clause to every cell:
prohibit direct declaration reads before the decision, while permitting span
mutation and `git span drift` afterward. Do not tell every condition to revise
the why if revision wording itself is the treatment being measured.

Compare semantically related forms:

**Complete gate**

```text
Readers intentionally continue accepting integers and may remove that support only after two completed releases each report zero legacy references; newer legacy events invalidate the gate.
```

**Complete gate with lifecycle maintenance**

```text
Readers intentionally continue accepting integers and may remove that support only after two completed releases each report zero legacy references; newer legacy events invalidate the gate. After removal, revise or retire this why so it describes the resulting state.
```

**Fragment control with lifecycle maintenance**

```text
State: read UUID|int. Gate: 2 completed zero-reference releases; newer legacy event invalidates. On removal: update/delete why.
```

Vary only operational evidence:

| Evidence state | Fixture evidence | Required source result | Required why result |
|---|---|---|---|
| Unmet | One completed clean release | Preserve | Preserve current state and gate |
| Met | Two completed clean releases | Remove | Revise or retire |
| Invalidated | Two clean releases followed by a newer legacy event | Preserve | Preserve current state and gate |
| Unavailable | Metrics service cannot be reached | Preserve | Preserve current state and gate |

The met cell must be the only cell satisfying every conjunct. Ensure the newer
event unambiguously postdates the two releases. Do not let local fixtures or
current writers serve as operational evidence.

Use at least one repetition per cell to debug the harness, then run repeated,
randomized cells. The lifecycle design above has 48 trials:

```text
3 why forms × 4 evidence states × 2 agents × 2 repetitions = 48
```

Two repetitions are enough to expose obvious lifecycle and harness failures,
not enough to estimate small differences between why forms. If treatment
effects matter, use more repetitions or a harder fixture that does not saturate.

## Build delivery checks from parsed events

Do not detect declaration reads with a regular expression over raw serialized
JSONL. The command text may appear in the user prompt, hook output, tool input,
tool output, or the model's narration. Parse each engine's event schema into an
ordered trace instead.

Normalize events to records such as:

```json
{
  "index": 17,
  "kind": "tool_call",
  "tool": "Read",
  "target": "src/read-user.ts"
}
```

Then implement explicit predicates:

```text
anchor_access = supported read of an anchored source path
hook_delivery = hook event or runtime-specific context event containing span id and decisive proposition
declaration_read = read-only access whose normalized target is under .span, or git-span read command
decision_action = first semantic source edit, span mutation, or final decision

valid_delivery =
  anchor_access.index < hook_delivery.index
  and hook_delivery.index < decision_action.index
  and no declaration_read.index < hook_delivery.index
```

Classify `git span why` by operation, not substring. A command that writes a new
why after the decision is span maintenance, not evidence that the original why
was read directly. Keep model text separate from executable tool arguments.

For runtimes without explicit hook events, define the accepted indirect signal
in advance. A precise, otherwise unavailable restatement immediately after the
anchor event can support delivery, but manually audit every such trace or mark
the run uncertain. Do not silently weaken the provenance oracle after results
arrive.

## Compact reproducible protocol

1. Create a small fixture with two to four exact anchors, a tempting local edit,
   and an objectively determined lifecycle transition.
2. Commit the clean source baseline, declare the span, and commit the declaration.
3. Store the multidimensional oracle outside the repository.
4. Create why variants that differ in one intended property. Check semantic
   equivalence before running.
5. Clone or copy the baseline into a fresh temporary Git repository for every
   trial. Never reuse an agent-touched tree.
6. Pin CLI, requested model, reasoning effort, tools, sandbox, plugin, prompt,
   schema, budget, and timeout. Randomize neutral condition identifiers.
7. Close child stdin, capture stdout and stderr separately, and save the complete
   ordered event stream.
8. Score source, why, anchors, delivery, changed files, and process validity
   independently from repository state and parsed events.
9. Manually audit event-order classifications and every semantic edge case before
   aggregating counts.
10. Report requested and resolved models, per-engine results, invalid cells,
    costs, and fixture limitations.

## Running Codex

A representative real-hook command is:

```bash
codex -a never exec \
  --ephemeral \
  --json \
  --sandbox danger-full-access \
  --dangerously-bypass-hook-trust \
  -C "$RUN_DIRECTORY" \
  --model gpt-5.6-luna \
  -c 'model_reasoning_effort="medium"' \
  --output-schema "$EVAL_ROOT/schema.json" \
  "$TASK_PROMPT" \
  > "$RESULT_DIRECTORY/events.jsonl" \
  2> "$RESULT_DIRECTORY/stderr.log"
```

Prefer a narrower sandbox. Use `danger-full-access` only for disposable,
isolated fixture repositories when bubblewrap namespace creation is unsupported
in the container. A bubblewrap failure invalidates the trial.

Close stdin immediately or a completed child can wait indefinitely:

```js
const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
child.stdin.end();
```

Set a per-run timeout and distinguish inference timeouts from initialization
failures.

## Running the DeepSeek wrapper

Invoke [.devcontainer/utilities/deepseek](../../.devcontainer/utilities/deepseek)
without reading, copying, or modifying it:

```bash
/workspace/.devcontainer/utilities/deepseek \
  -p \
  --no-session-persistence \
  --output-format stream-json \
  --include-hook-events \
  --verbose \
  --model opus \
  --effort medium \
  --permission-mode bypassPermissions \
  --setting-sources project \
  --strict-mcp-config \
  --mcp-config '{"mcpServers":{}}' \
  --tools Read Edit Write Bash \
  --plugin-dir /workspace/plugins-claude/git-span \
  --json-schema "$SCHEMA_JSON" \
  --max-budget-usd 0.50 \
  "$TASK_PROMPT" \
  > "$RESULT_DIRECTORY/events.jsonl" \
  2> "$RESULT_DIRECTORY/stderr.log"
```

The empty MCP configuration must be `{"mcpServers":{}}`; `{}` can fail before
inference. Confirm initialization loads exactly one git-span plugin. Record both
the requested alias and the provider-resolved model. In the lifecycle run,
requested `opus` resolved to `deepseek-v4-flash`. The wrapper portion cost
`$2.485755` in that environment; cost is operational metadata, not an efficacy
metric.

The wrapper may contain authentication material. Do not print its contents,
capture its environment, copy it into artifacts, or include credentials in
commands, schemas, prompts, or logs.

## Invalid, confounded, and ceiling trials

Invalidate and rerun a complete paired set when:

- Inference does not start because of sandbox, MCP, authentication, budget,
  plugin initialization, or model-resolution failure.
- Conditions encode different policies or expose different evidence.
- The baseline, prompt, model, tools, or settings differ unexpectedly.
- The oracle permits multiple reasonable outcomes.
- Delivery provenance cannot be established for a real-hook study.

Do not score infrastructure failures as model errors. Do not repair one cell in
place after seeing its result; rebuild and rerun its siblings.

A perfect result can indicate a sound strategy, an easy fixture, or both. When
every why form reaches the ceiling, report that no content winner was identified
and move the next experiment to a discriminating dimension. The lifecycle run
did this: why semantics saturated, while anchor topology exposed a useful
failure.

Do not combine semantically confounded pilots with controlled cells. An earlier
security pilot compared materially different prohibitions and therefore cannot
support a claim about why style.

## Next discriminating simulations

After lifecycle completion, prioritize tests that can separate plausible
strategies:

- **Anchor-reconciliation instruction:** compare implicit reconciliation,
  explicit “replace obsolete anchors,” and an exact post-edit drift requirement.
  Score duplicate and superseded anchors, not only nonzero drift.
- **Context-density interference:** activate one relevant why among zero, two,
  five, or ten irrelevant whys; randomize order and score retrieval and overreach.
- **Competing evidence sources:** vary freshness and authority while keeping why
  text constant; score whether agents resolve precedence rather than obeying
  whichever context arrived last.
- **Partial transition:** make only one of several consumers eligible to migrate;
  score whether the why and anchors retain the still-live exception.
- **Why retirement choice:** compare cases where deletion, historical rewrite,
  or replacement with a resulting-state why is objectively preferable.
- **Incidental anchor access:** include read-only, unrelated-edit, semantic-edit,
  and error-path tasks to measure whether lifecycle wording causes unnecessary
  edits.

Define exact independent oracles before running any of these simulations.

## Analysis and reporting

Report at least:

- Source-decision correctness.
- Harmful-edit rate.
- Why semantic accuracy before and after transition.
- Why revision or retirement rate.
- Drift-free rate and anchor-topology defects.
- Hook-delivery provenance and direct-read contamination.
- Unnecessary changed files.
- Validation compliance.
- Invalid or confounded trials.
- Requested and resolved models.
- Tokens, tool calls, latency, and cost.

Compare treatment effects within each engine:

```text
Codex effect = Codex(candidate why) - Codex(control why)
Wrapper effect = Wrapper(candidate why) - Wrapper(control why)
```

Raw cross-engine accuracy confounds model, system instructions, tools, and agent
policy. Agreement in treatment direction is useful evidence; a model ranking is
not. Preserve per-scenario data so repeated runs of one fixture are not mistaken
for broad scenario diversity.

Archive only sanitized artifacts needed for reproduction. Never publish
credentials, wrapper contents, complete environments, or unrelated model
context.
