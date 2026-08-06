# Understanding hook output

Two hooks run in-session, on two different tool families, at two different
moments. Neither waits for a commit:

- **Touch hook** (`PostToolUse`, matcher `apply_patch|exec_command|exec|Bash`)
  — fires synchronously right after each `apply_patch` or shell command
  completes, not after commit. It heals positional drift silently and, when it
  can't, injects a bounded `additionalContext` signal.
- **Advisor** (`PreToolUse`, matcher `Bash|shell|exec|local_shell`) — fires
  before `git commit`/`git push`/`git status` runs. For `git commit`/`git
  push`, it holds the command once when the resolved changeset carries real
  span debt, so the report gets read; it never enforces, and an identical
  retry proceeds. Whether the `permissionDecision: 'deny'` a hold emits
  actually pauses the Codex shell tool was never confirmed live in this repo
  (see `references/codex-install-and-trust.md`) — the hook ships a hard-deny
  path per its SDK's own documented example, with a one-constant fallback to a
  loud `additionalContext` warning if a live session shows it doesn't fire.
  Don't assume a paused command the way you would under Claude; if the same
  command keeps landing after a supposed hold, treat the CI gate recipe
  (`references/ci-and-sync.md`) as the real backstop. Either way — paused or
  not — the `systemMessage` checklist below is what's shown, so its presence
  in the transcript is not itself proof the command stopped. A plain `git
  status` is never held (unconditionally, not just per the unconfirmed-deny
  caveat) — it only ever reports via `additionalContext`/`systemMessage`.

## The touch hook: the merged `<git-span>` block

When an edit lands (or a read touches a partial range) inside a span anchor,
the hook injects a merged `<git-span>` block as `additionalContext`: a header
line, one full span section per surfaced span (sections separated by `---`),
and a single footer after a final `---`. A healthy span renders as:

```
<git-span>
checkout.tsx has implicit dependencies:

## billing/checkout-request-flow
├─ web/checkout.tsx #L88-L120
└─ api/charge.ts    #L30-L76

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

---

If you change checkout.tsx check the other files to confirm they still work
together.
</git-span>
```

When the touch leaves genuine content drift behind, drifted anchors carry a
lowercase status suffix and the header and footer switch:

```
<git-span>
This edit put an implicit dependency out of date:

## billing/checkout-request-flow
├─ web/checkout.tsx #L88-L120 — changed
└─ api/charge.ts    #L30-L76

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

---

Restore agreement before committing. Follow confirmed authority. Preserve
anchor shape; if an address changed, swap the old anchor for the new one
with `git span replace`. Update or retire the why only if its meaning
changed. Require `git span drift billing/checkout-request-flow` to report
zero, then check the other anchors. Conform a side only when confirmed authority
or a satisfied gate decides it; report ambiguity or an obsolete coupling.
</git-span>
```

Each `## <name>` section renders the span's full declared anchor list —
including anchors in files other than the touched one — as a box-drawing
tree grouped by shared path prefix, each leaf's range column showing
`#Lstart-Lend`, followed by the span's why sentence when one is recorded. A
directory holding a single entry folds onto that entry's line, so a branch
only ever appears where two or more anchors actually share a prefix. A
whole-file anchor is a bare path with no range column; where the same file
also carries line ranges, it takes `(whole file)` in the range column so its
own drift label can never be read as belonging to a neighbouring range. Only genuine
(semantic or terminal) drift earns a suffix (` — changed`, ` — deleted`, …); positional
drift never does — see below. The header scales with what drifted: `<file>
has implicit dependencies:` (naming the touched file) when nothing did, the
singular form above for one drifted span on a write, and `This edit put
implicit dependencies out of date:` for more than one. A read never edited
anything — it only surfaces drift that was already there — so its drifted
header names the dependency instead of the touch: `This file has an implicit
dependency out of date:` (singular) or `This file has implicit dependencies
out of date:` (plural). With several drifted spans, apply the footer to each
span and use `git span drift <name>` for the final zero-drift check. The block carries
everything needed to act — anchors, statuses, and the description — so no
follow-up `git span` read is required.

### Positional drift is healed, not surfaced

Before computing what to show, the hook first runs the equivalent of `git
span drift --fix` scoped to the touched file, re-anchoring any pure line-shift
drift (`MOVED`, whitespace-only `CHANGED`) against the edit's real post-edit
range. This happens silently — no block, nothing in the transcript — because
there is nothing left to act on by the time the agent sees output. Only what
survives that heal (genuine content drift) can earn an anchor its status
suffix. This is the touch hook's whole reason for existing: it
collapses the old "edit now, reconcile in a separate pass later" flow into
"edit now, healed now" — a positional re-anchor never needs its own commit.

### When a span surfaces (and resurfaces)

A span renders when its name has not been surfaced this session, or when it
carries a drift status not yet surfaced for it — the hook tracks what it has
already shown under `~/.cache/git-span/session/<id>/`. Every render is the
full span section; there is no bare drift line without anchors. A span
already surfaced healthy re-renders in full when drift later appears, and a
status *change* (e.g. `changed` → a terminal status) is a new pair and
surfaces again. If the same span keeps coming up `changed` across several
edits in one session, it renders once, not on every touch.

### What never produces a block

- Whole-file `Read` (no `offset`/`limit`).
- `Write` to a path that doesn't yet exist on disk.
- A `Write` that's a full-content replacement (no common prefix/suffix with
  what's on disk).
- Whole-file anchors (no `#L…` range) — excluded from intersection matching.
- Gitignored or non-repo files.
- A span whose name and current drift statuses were all surfaced earlier
  this session.

## The advisor: what a held command sees

The advisor inspects `git commit`/`git push`/`git status` before they run —
never a Read, Edit, or Write. It resolves the actual changeset (staged files,
plus tracked-modified files when the command uses `-a`/`-am`; for `git
status`, staged plus tracked-modified — the same working-tree picture `git
status` itself prints), reruns a scoped `drift --fix`, then classifies what's
left. For `git commit`/`git push`, a hold becomes a `permissionDecision:
'deny'` result whose `permissionDecisionReason` (and `systemMessage`, so it's
visible in the transcript) is one of two shapes:

**Semantic drift** — the same human span format the touch hook renders
(full anchor list, drifted anchors labeled, the description), held once per
distinct set of findings; an identical retry (same findings) passes, and
editing a span's anchors changes the findings and earns one fresh hold. The
advisor reports, it does not enforce — a hold exists only so the report is
read once, and an identical retry alone already proceeds — so if a `git
status` preview already showed this exact finding set in full, the following
`git commit`/`git push` passes too, without holding on a state the agent has
already been told about:

```
This change leaves an implicit dependency out of date:

## billing/checkout-request-flow
├─ src/checkout.tsx #L88-L120 — changed
└─ api/charge.ts    #L30-L76

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

---

Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to
bring the coupled files back into agreement (follow confirmed authority) —
preserve anchor shape; if an address changed, swap the old anchor for the new
one with `git span replace`; update or retire the why only if its
meaning changed; require `git span drift billing/checkout-request-flow` to
report zero. Then retry. Load the `git-span:reconcile` skill in the fork. The
hold will not fire again for the same debt state. Conform a side only when
confirmed authority or a satisfied gate decides it; report ambiguity or an
obsolete dependency.
```

With several drifted spans the sections stack, separated by `---`, the header
pluralizes, and the closing commands use a `<name>` placeholder.

**Uncovered writes** — a changed file no span anchors at all. Held once per
distinct debt state (a digest of the sorted findings/uncovered paths); an
unchanged retry passes, and so does a `git commit`/`git push` whose exact
debt state a prior `git status` already showed in full — same reasoning as
semantic drift above. When another file in the same changeset already
belongs to a span, a related-spans section follows the checklist — every
qualifying anchor (no cap), restricted to paths in this changeset, rendered as
a line range wherever the covering row carries one, followed by that span's
`why` sentence when it has one recorded:

```
<git-span>
- src/new-module.ts

Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to
determine if this file carries implicit dependencies and to then use
`git span` to document them:

`git span add <name> <anchor> [<anchor>] ...`  — an anchor is a path or a `path#Lstart-Lend` range
`git span why <name> "<why>"`

The "<why>" is one or two complete present-tense clauses stating the
relationship and any decisive nonlocal authority, invariant, permitted
difference, lifecycle state, evidence gate, or focused conditional verification.
Labels are optional but must introduce complete clauses. Omit generic work
orders and CLI procedure.

---

Other files in this change already belong to spans — an uncovered file above
might belong with one of these instead of a new one:

## checkout-flow
└─ web/checkout.tsx #L4-L6

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

If none exist, retry the command to proceed (one-time check).

Load the `git-span:git-span` skill in the fork.
</git-span>
```

The related-spans section is grouped by span name, then by anchor within a
name (sorted), each group followed by that span's `why` sentence (omitted
for a span that has none recorded), and is omitted entirely when no other
file in the changeset carries any span coverage. Groups are ordered by how
much of the changeset each span covers (most first), then by how close its
anchors sit to an uncovered file, then by name — so the span an uncovered
file most plausibly belongs to leads, and identical state always renders in
identical order. At most eight spans are listed; when more qualify, a
closing line names how many are not shown and the command that shows them. It
carries into the `git status` advisory the same way — it's supplementary
context about the changeset, not part of what's flagged or consider-once'd,
so it never affects the debt-state digest.

A condensed "Already flagged for git-span review above." form of both
checklists exists, but only ever appears in the `git status` advisory: a
second `git status` on an unchanged debt state shows the condensed form
instead of repeating the full checklist. A `git commit`/`git push` never
renders it — either the state is genuinely new (full checklist, held once)
or it was already shown by a preceding `git status`, in which case the
command passes silently rather than holding with a shorter message.

`MOVED` and `RESOLVED_PENDING_COMMIT` are never debt — they never appear in
either checklist and never cause a hold. `.span/**` writes are excluded from
the uncovered-writes check so a span repair riding the same commit never
self-triggers the advisor. If the scan itself can't complete (an
`AdvisorScanError`, e.g. an unreadable anchor file), the advisor holds nothing
on that account either — it allows with a warning that span debt was NOT
verified for this changeset, carrying the failed command's own stderr as a
delimited `<git-span-error>` block so the raw diagnostic is clearly bounded;
there's nothing to memoize because every evaluation of a still-failing scan
warns again.

**`git status`** is never held — it only reports. The same two checklists
above render as `additionalContext`/`systemMessage` (never
`permissionDecision: 'deny'`, and not subject to the unconfirmed-deny caveat
above since nothing is ever held), with one difference: each drops its retry
phrasing — drift drops `— then retry` from its closing sentence, and
uncovered writes drops the whole `If none exist, retry the command to proceed
(one-time check).` sentence — since a status preview never held the command
and there's nothing to retry. A `git status` call also never reads or writes
the consider-once *hold-credit* memo — it always reports whatever debt is
live right now, and it can't spend the one-time hold a later real `git
commit`/`git push` with the same debt depends on. It does mark the debt
state as already-explained on a separate axis, though: a `git commit`/`git
push` that follows a `git status` on the same unchanged debt state passes
rather than holding, since the advisor only reports and there's nothing
left to tell the agent that the status preview didn't already say.

### Resolving a held commit

1. Semantic drift: spawn a forked subagent with `spawn_agent`, setting
   `fork_turns: "all"`, to bring the coupled files back into agreement
   (loading the `git-span:reconcile` skill in the fork), or just retry with
   the findings unchanged, since an identical set of findings is only held
   on once. Conform a side only when confirmed authority or a satisfied gate
   decides it; report ambiguity or an obsolete dependency.
2. Uncovered writes: spawn a forked subagent with `spawn_agent`, setting
   `fork_turns: "all"`, to determine whether the uncovered files carry
   implicit dependencies and to use `git span` to document them (loading the
   `git-span:git-span` skill in the fork), or just retry — the second
   attempt at an unchanged debt state passes.
3. Scan failure: resolve the underlying read/scan error if the span coupling
   still needs verifying — the command itself already proceeded.

## Read-path filtering

Both hooks apply the same principle from opposite ends: positional-only drift
never reaches the agent as something to act on. The touch hook heals it before
building its block; the advisor's `drift --fix` pre-pass heals it before
classifying the changeset. Only genuine semantic drift — content that no
longer matches what a span asserts — ever surfaces in a block or holds a
command.

## Mechanical churn is suppressed before the list is built

The uncovered-writes checklist omits files whose change is recognizably
mechanical, so a release bump touching twenty manifests doesn't bury the one or
two files carrying real edits. Two layers decide this, both before any list is
rendered:

- **By path** — lockfiles, minified output, sourcemaps, `.tsbuildinfo`, and
  anything under `node_modules/` or `__pycache__/` never reach the list, whatever
  their contents.
- **By content** — for manifest-shaped files only (`package.json`, `Cargo.toml`,
  lockfiles, `Dockerfile`, man pages), a diff that changes nothing but a version
  token, a checksum, or a timestamp is treated as churn. Every other path,
  including every source and prose file, is refused before these rules run: an
  unrecognized file type can only ever stay listed.

Suppression is deliberately invisible — a suppressed file is simply one the
agent is never told about. That means a correct suppression, a wrong one, and a
diff read that failed and suppressed nothing all look identical from outside.
When you need to tell them apart, set `CODEX_HOOKS_LOG_FILE` to a path and
re-run the command; each advisor invocation appends a `git-span advisor churn
suppression` record with the candidate count, how many were dropped by path,
how many by content, how many were reported, and whether the diff read
succeeded. Without that variable set the hook logger has no destination and the
record is discarded, which is why a missing file cannot be explained from the
hook's normal output alone.

If a listed path is generated output that will never carry a span, the fix is
not to span it — add it to `.span/.advisorignore`, which excludes paths from
this check entirely. Generated bundles are the common case: the classifier only
ever inspects manifest-shaped files, so it cannot recognize a regenerated bundle
on its own, and spanning build output contradicts the guidance in `SKILL.md`.

## Failure behaviour

Both hooks fail open on everything that decides *whether* there is something
to say: a missing `git span` binary, a timeout, a failed scan, or a
malformed/unexpected CLI result resolves to "allow silently, inject
nothing." Silence from either hook is the correct steady state when
`git span` isn't installed, the repo has no spans, or nothing needs to be
said — never an error condition. The one noisy case is the advisor's own
scoped scan failing to complete (see "The advisor: what a held command sees"
above): that still fails open, but visibly — a warning names the failure and
carries the failed command's stderr in a delimited `<git-span-error>` block
instead of staying silent, since an unverified changeset is worth flagging
even though nothing was held. Hook timeouts are configured in **seconds**
under Codex's `hooks.json` (Claude Code's equivalent is milliseconds) — if
you're comparing the two harnesses' hook definitions, don't read the raw
number across without converting.

Rendering is the deliberate exception, and fails **closed**. If the anchor
tree can't be drawn, the hook falls back to the flat bullet form and still
holds the commit — a defect in how a hold is *presented* must cost
presentation, never the hold itself. That is why those `try`/`catch` blocks
sit around the render calls rather than deferring to the advisor's outer
fail-open catch: they exist precisely to keep a formatting error from
converting a correctly computed hold into a silent allow. Treat them as
load-bearing, not as fallbacks that escaped the rule above.
