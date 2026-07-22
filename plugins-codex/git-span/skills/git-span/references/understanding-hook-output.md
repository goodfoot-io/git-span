# Understanding hook output

Two hooks run in-session, on two different tool families, at two different
moments. Neither waits for a commit:

- **Touch hook** (`PostToolUse`, matcher `apply_patch`) — fires synchronously
  right after each `apply_patch` call completes, not after commit. It heals
  positional drift silently and, when it can't, injects a bounded
  `additionalContext` signal.
- **Gate** (`PreToolUse`, matcher `Bash|shell|exec|local_shell`) — fires
  before `git commit`/`git push`/`git status` runs. For `git commit`/`git
  push`, it holds the command when the resolved changeset carries real span
  debt. Whether Codex's `permissionDecision: 'deny'` result actually blocks
  the shell tool was never confirmed live in this repo (see
  `references/codex-install-and-trust.md`) — the hook ships a hard-deny path per
  its SDK's own documented example, with a one-constant fallback to a loud
  `additionalContext` warning if a live session shows deny doesn't fire. Don't
  assume a blocked command the way you would under Claude; if the same command
  keeps landing after a supposed deny, treat the CI gate recipe
  (`references/ci-and-sync.md`) as the real backstop. Either way — blocked or
  not — the `systemMessage` checklist below is what's shown, so its presence
  in the transcript is not itself proof the command was stopped. A plain `git
  status` never denies (unconditionally, not just per the unconfirmed-deny
  caveat) — it only ever advises via `additionalContext`/`systemMessage`.

## The touch hook: the merged `<git-span>` block

When an edit lands (or a read touches a partial range) inside a span anchor,
the hook injects a merged `<git-span>` block as `additionalContext`: a header
line, one full span section per surfaced span (sections separated by `---`),
and a single footer after a final `---`. A healthy span renders as:

```
<git-span>
checkout.tsx has implicit dependencies:

## billing/checkout-request-flow
- web/checkout.tsx#L88-L120
- api/charge.ts#L30-L76

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
- web/checkout.tsx#L88-L120 — changed
- api/charge.ts#L30-L76

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

---

Update the changed anchors or description before committing —
`git span add billing/checkout-request-flow <path#Lstart-Lend>` /
`git span why billing/checkout-request-flow -m "..."` — and check the other
anchors for knock-on changes. If the coupling no longer holds, tell the user
instead.
</git-span>
```

Each `## <name>` section renders the span's full declared anchor list —
including anchors in files other than the touched one — as
`- path#Lstart-Lend` bullets (a bare path for a whole-file anchor), followed
by the span's why sentence when one is recorded. Only genuine (semantic or
terminal) drift earns a suffix (` — changed`, ` — deleted`, …); positional
drift never does — see below. The header scales with what drifted: `<file>
has implicit dependencies:` (naming the touched file) when nothing did, the
singular form above for one drifted span, and `This edit put implicit
dependencies out of date:` for more than one. With several drifted spans the
footer generalizes: "For each out-of-date span above: update the changed
anchors or description before committing — `git span add <name>
<path#Lstart-Lend>` / `git span why <name> -m "..."` — and check the other
anchors for knock-on changes. If a coupling no longer holds, tell the user
instead." The block carries everything needed to act — anchors, statuses,
and the description — so no follow-up `git span` read is required.

### Positional drift is healed, not surfaced

Before computing what to show, the hook first runs the equivalent of `git
span stale --fix` scoped to the touched file, re-anchoring any pure line-shift
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

## The gate: what a denied command sees

The gate inspects `git commit`/`git push`/`git status` before they run —
never a Read, Edit, or Write. It resolves the actual changeset (staged files,
plus tracked-modified files when the command uses `-a`/`-am`; for `git
status`, staged plus tracked-modified — the same working-tree picture `git
status` itself prints), reruns a scoped `stale --fix`, then classifies what's
left. For `git commit`/`git push`, a deny becomes a `permissionDecision:
'deny'` result whose `permissionDecisionReason` (and `systemMessage`, so it's
visible in the transcript) is one of two shapes:

**Semantic staleness** — the same human span format the touch hook renders
(full anchor list, drifted anchors labeled, the description), denied once per
distinct set of findings; an identical retry (same findings) passes, and
editing a span's anchors changes the findings and earns one fresh deny:

```
This change leaves an implicit dependency out of date:

## billing/checkout-request-flow
- src/checkout.tsx#L88-L120 — changed
- api/charge.ts#L30-L76

Checkout request flow that carries a charge attempt from the browser to the
Stripe-backed server.

---

Update the drifted locations or the description — `git span add
billing/checkout-request-flow <path#Lstart-Lend>` / `git span why
billing/checkout-request-flow -m "..."` — then retry. If a dependency no
longer holds, tell the user instead.
```

With several drifted spans the sections stack, separated by `---`, the header
pluralizes, and the closing commands use a `<name>` placeholder.

**Uncovered writes** — a changed file no span anchors at all. Denied once per
distinct debt state (a digest of the sorted findings/uncovered paths); an
unchanged retry passes:

```
<git-span>
- src/new-module.ts

Determine if these files carry implicit dependencies, then use `git span` to
document them:

`git span add <name> <path#Lstart-Lend> [<path#Lstart-Lend>] ...`
`git span why <name> -m "<why>"`

The "<why>" is a single present-tense sentence naming what the ranges form
together, specific enough to tell whether an edit lands inside it, with no
rules or reminders.

If none exist, retry the command to proceed (one-time check).

Load the `git-span:git-span` skill for guidance.
</git-span>
```

`MOVED` and `RESOLVED_PENDING_COMMIT` are never debt — they never appear in
either checklist and never deny. `.span/**` writes are excluded from the
uncovered-writes check so a span repair riding the same commit never
self-triggers the gate. If the scan itself can't complete (a `GateScanError`,
e.g. an unreadable anchor file), the gate never denies on that account either
— it allows with a warning that span debt was NOT verified for this
changeset, naming the underlying failure; there's nothing to memoize because
every evaluation of a still-failing scan warns again.

**`git status`** never denies — it only advises. The same two checklists
above render as `additionalContext`/`systemMessage` (never
`permissionDecision: 'deny'`, and not subject to the unconfirmed-deny caveat
above since nothing is ever held), with one difference: each drops its retry
phrasing — staleness drops `— then retry` from its closing sentence, and
uncovered writes drops the whole `If none exist, retry the command to proceed
(one-time check).` sentence — since a status preview never held the command
and there's nothing to retry. A `git status` call also never reads or writes
the consider-once memo — it always reports whatever debt is live right now,
and it can't spend the one-time deny a later real `git commit`/`git push`
with the same debt depends on.

### Resolving a denied commit

1. Semantic staleness: fix each listed span the normal way (`git span add`
   the drifted anchors, or `git span delete` if the coupling is gone), then
   retry the same commit — or just retry with the findings unchanged, since
   an identical set of findings only denies once.
2. Uncovered writes: either declare the coupling (`git span add` then
   `git span why -m "..."`) or just retry — the second attempt at an
   unchanged debt state passes.
3. Scan failure: resolve the underlying read/scan error if the span coupling
   still needs verifying — the command itself already proceeded.

## Read-path filtering

Both hooks apply the same principle from opposite ends: positional-only drift
never reaches the agent as something to act on. The touch hook heals it before
building its block; the gate's `stale --fix` pre-pass heals it before
classifying the changeset. Only genuine semantic drift — content that no
longer matches what a span asserts — ever surfaces in a block or blocks a
commit.

## Failure behaviour

Both hooks fail open at every layer: a missing `git span` binary, a timeout,
or a malformed/unexpected CLI result resolves to "allow silently, inject
nothing." Silence from either hook is the correct steady state when
`git span` isn't installed, the repo has no spans, or nothing needs to be
said — never an error condition. The one exception is the gate's own scoped
scan failing to complete (see "The gate: what a denied command sees" above):
that still fails open, but visibly — a warning names the failure instead of
staying silent, since an unverified changeset is worth flagging even though
it isn't blocked. Hook timeouts are configured in **seconds** under Codex's
`hooks.json` (Claude Code's equivalent is milliseconds) — if you're comparing
the two harnesses' hook definitions, don't read the raw number across without
converting.
