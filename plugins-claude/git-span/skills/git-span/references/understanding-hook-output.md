<!-- Generated from skills-src/git-span/git-span/references/understanding-hook-output.md.eta by scripts/build-agent-skills.mjs — do not edit; change the template and rebuild. -->

# Understanding hook output

The touch pipeline runs after supported reads and writes. Static planning runs
before supported shell calls to capture bounded pre-state when needed.

`PostToolUse` observes `Read|Edit|Write|Bash` and injects bounded
`additionalContext` after the tool completes.

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
own drift label can never be read as belonging to a neighboring range. Only genuine
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

## Bash intent attribution

Bash and shell calls are attributed from explicit command intent. The
`PreToolUse` planner and `PostToolUse` handler share one bounded parser for
literal shell writes and reads, literal-list loops, literal `sed`/Perl
substitutions, and proven literal Python/Node file-edit dataflows. The parser
never runs an embedded program or expands a dynamic path. Unsupported syntax,
globs, command substitutions, arbitrary generators, history-changing Git
operations, and other unproven dataflows produce logger-only unresolved reason
codes and no touch.

Every candidate is scoped to the effective working directory's repository and
filtered through one batched tracked-file query. Files outside the repository,
ignored files, span metadata, and untracked files are dropped. A Codex
`exec_command` or code-mode `exec` envelope's `workdir` is used for both
planning and post-tool attribution, so an explicit working directory inside a
different repository is handled in that repository.

Most commands need no persisted pre-state. When a delete, substitution range,
or pre-command EOF cannot be reconstructed safely after execution,
`static-plan.mjs` stores one content-minimal record under the session's
`planned-touches/` directory. A record contains only tracked
repository-relative paths, bounded ranges, operation/index metadata, and small
verification evidence; it never contains a file body or repository tree.
`PostToolUse` atomically consumes the record once, verifies the evidence,
reparses ordinary operations, and applies shell join and post-state gates before
touching a span. Success, failure, interruption, and duplicate delivery cannot
reuse a plan. `SessionEnd` on Claude and `Stop` on Codex eagerly
retire the session memo and plans; opportunistic 30-day cleanup covers crashed
sessions.

A failed Bash command can still surface a write only when the supported family
provides decisive post-state evidence, such as an expected replacement result.
Inconclusive writes and interrupted calls stay silent. Response-derived reads
remain a separate pass and share only the session memo, so a later read can
surface context without duplicating command-derived output.

The parser's candidate ceiling is 32 and is all-or-nothing: a bounded set is
attributed completely or rejected before any touch. Planned records allow at
most 32 touches and 32 ranges per touch, 16 KiB of verification evidence, and
64 KiB total. These are internal safety limits rather than runtime
configuration. The former `GIT_SPAN_SNAPSHOT_*` environment variables and
`git-span.snapshot-*` Git configuration keys have been removed and no longer
affect hook behavior.

Diagnostics are written through the hook logger: resolved read/write counts,
unresolved reason counts, scope/tracked/execution drops, parser and touch
latency, subprocess count, and whether dependency context surfaced. Unresolved
static intent never creates a transcript warning by itself; the safe result is
simply no attribution.

## Failure behavior

The touch pipeline fails open: a missing `git span` binary, timeout, failed
scan, or malformed CLI result injects nothing and does not block the tool.
Unsupported intent, untracked paths, and writes outside the effective
repository remain silent. The tool's working directory selects the repository
for both planning and attribution.


Run explicit `git span drift` checks or use CI to verify edits outside the
supported touch events; see `references/ci-and-sync.md`.
