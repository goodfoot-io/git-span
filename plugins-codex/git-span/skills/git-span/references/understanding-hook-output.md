# Understanding hook output

Two hooks run in-session, on two different tool families, at two different
moments. Neither waits for a commit:

- **Touch hook** (`PostToolUse`, matcher `apply_patch`) — fires synchronously
  right after each `apply_patch` call completes, not after commit. It heals
  positional drift silently and, when it can't, injects a bounded
  `additionalContext` signal.
- **Gate** (`PreToolUse`, matcher `Bash|shell|exec|local_shell`) — fires
  before `git commit`/`git push` runs, and only when the resolved changeset
  carries real span debt. Whether Codex's `permissionDecision: 'deny'` result
  actually blocks the shell tool was never confirmed live in this repo (see
  `references/codex-install-and-trust.md`) — the hook ships a hard-deny path per
  its SDK's own documented example, with a one-constant fallback to a loud
  `additionalContext` warning if a live session shows deny doesn't fire. Don't
  assume a blocked command the way you would under Claude; if the same command
  keeps landing after a supposed deny, treat the CI gate recipe
  (`references/ci-and-sync.md`) as the real backstop. Either way — blocked or
  not — the `systemMessage` checklist below is what's shown, so its presence
  in the transcript is not itself proof the command was stopped.

## The touch hook: merged block + directive line

When an edit lands (or a read touches a partial range) inside a span anchor,
the hook injects a merged `<git-span>` block as `additionalContext`:

```
<git-span>
Spans coupled to this change:
  billing/checkout-request-flow	src/checkout.tsx#L88-L120

- billing/checkout-request-flow (CHANGED): the described coupling no longer
matches the code. Update its anchors/why in this change before it lands, or
tell the user why the coupling no longer holds.
</git-span>
```

The block's first section, when present, lists every covering span not yet
surfaced this session as a `<name>\t<anchor>` row (tab-delimited — one row per
span, the anchor written as `path#Lstart-Lend`, or a bare path for a
whole-file anchor). If — and only if — the touch left genuine semantic drift
behind (a `CHANGED` anchor whose content no longer matches, or a terminal
status), a blank line separates a second section: one `- <name> (<status>):
...` directive line per drifted `(span, status)` pair. A block can carry
either section alone, or both. Positional drift never produces a directive
line — see below.

### Positional drift is healed, not surfaced

Before computing what to show, the hook first runs the equivalent of `git
span stale --fix` scoped to the touched file, re-anchoring any pure line-shift
drift (`MOVED`, whitespace-only `CHANGED`) against the edit's real post-edit
range. This happens silently — no block, no directive, nothing in the
transcript — because there is nothing left to act on by the time the agent
sees output. Only what survives that heal (genuine content drift) can produce
a directive line. This is the touch hook's whole reason for existing: it
collapses the old "edit now, reconcile in a separate pass later" flow into
"edit now, healed now" — a positional re-anchor never needs its own commit.

### Once-per-session, once-per-status dedup

Each `(span, status)` pair is surfaced at most once per session — the hook
tracks what it has already shown under `~/.cache/git-span/session/<id>/`. If
the same span keeps coming up `CHANGED` across several edits in one session, the
directive line appears once, not on every touch. A status *change* (e.g.
`CHANGED` → a terminal status) is a new pair and surfaces again.

### What never produces a block

- Whole-file `Read` (no `offset`/`limit`).
- `Write` to a path that doesn't yet exist on disk.
- A `Write` that's a full-content replacement (no common prefix/suffix with
  what's on disk).
- Whole-file anchors (no `#L…` range) — excluded from intersection matching.
- Gitignored or non-repo files.
- A `(span, status)` pair already surfaced this session.

## The gate: what a denied command sees

The gate inspects `git commit`/`git push` before they run — never a Read,
Edit, or Write. It resolves the actual changeset (staged files, plus
tracked-modified files when the command uses `-a`/`-am`), reruns a scoped
`stale --fix`, then classifies what's left. A deny becomes a
`permissionDecision: 'deny'` result whose `permissionDecisionReason` (and
`systemMessage`, so it's visible in the transcript) is one of two shapes:

**Semantic staleness** — a checklist, one line per drifted anchor, re-denied
on every retry until the findings themselves change:

```
This changeset carries span debt — resolve it before this lands:
  - billing/checkout-request-flow (CHANGED): src/checkout.tsx#L88-L120

Update each span's anchors/why in this same change, or tell the user why the
described coupling no longer holds, then retry.
To proceed anyway (requires explicit user approval): prefix the command with
`GIT_SPAN_GATE=skip`.
```

**Uncovered writes** — a changed file no span anchors at all. Denied once per
distinct debt state (a digest of the sorted findings/uncovered paths); an
unchanged retry passes:

```
These changed files are covered by no span — consider whether they need one:
  - src/new-module.ts

Declare a coupling with `git span add` if one genuinely exists, or just retry
the command to proceed (this is a one-time check).
To proceed anyway (requires explicit user approval): prefix the command with
`GIT_SPAN_GATE=skip`.
```

`MOVED` and `RESOLVED_PENDING_COMMIT` are never debt — they never appear in
either checklist and never deny. `.span/**` writes are excluded from the
uncovered-writes check so a span repair riding the same commit never
self-triggers the gate.

### Resolving a denied commit

1. Semantic staleness: fix each listed span the normal way (`git span add`
   the drifted anchors, or `git span delete` if the coupling is gone), then
   retry the same commit.
2. Uncovered writes: either declare the coupling (`git span add`) or just
   retry — the second attempt at an unchanged debt state passes.
3. `GIT_SPAN_GATE=skip` bypasses either check for one command, but only with
   explicit user approval — see `SKILL.md`.

## Read-path filtering

Both hooks apply the same principle from opposite ends: positional-only drift
never reaches the agent as something to act on. The touch hook heals it before
building its block; the gate's `stale --fix` pre-pass heals it before
classifying the changeset. Only genuine semantic drift — content that no
longer matches what a span asserts — ever surfaces as a directive line or
blocks a commit.

## Failure behaviour

Both hooks fail open at every layer: a missing `git span` binary, a timeout,
or a malformed/unexpected CLI result resolves to "allow silently, inject
nothing." Silence from either hook is the correct steady state when
`git span` isn't installed, the repo has no spans, or nothing needs to be
said — never an error condition. Hook timeouts are configured in **seconds**
under Codex's `hooks.json` (Claude Code's equivalent is milliseconds) — if
you're comparing the two harnesses' hook definitions, don't read the raw
number across without converting.
