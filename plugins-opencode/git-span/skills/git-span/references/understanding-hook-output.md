# Understanding hook output

The touch pipeline runs after supported reads and writes. Static planning runs
before supported shell calls to capture bounded pre-state when needed.

`tool.execute.before` captures shell and patch plans. `tool.execute.after`
observes `bash`/`read`/`edit`/`write`, plus `apply_patch` on gpt models, and
appends bounded `<git-span>` context to the tool output. The experimental
`execute` tool is outside this coverage.

## The touch hook: short notices

Each retained notice is wrapped in `<git-span>` tags. Initial clean touches,
including broad reads, identify the touched path and every relevant span:

```text
<git-span>
src/validate.ts is anchored in: input-selection-validation

Use `git span list input-selection-validation` for more information
</git-span>
```

Reads encountering drift use `Check for drift from <anchor> (<reason> in <span>)`
and recommend `git span drift <names>`. Writes use
`Change introduced drift from <anchor> (<reason> in <span>)` and recommend
`git span list <names>`. Notices enumerate all applicable spans and drifting
anchors. Whole-file anchors remain bare paths; ranged anchors retain line bounds.

Guidance appears once for `list` and once for `drift` per session, shared across
paths, spans, repositories and recipients. Later notices retain their wrapper
and substantive line. Exposure resets, compact/resume and snapshot eviction do
not renew guidance; a new session identity does. Separate session-keyed
`@guidance-*` directories survive eager session-state cleanup, including Codex
stops between turns. Active claims refresh their modification time; TTL pruning
retires abandoned guidance. No substantive output means no guidance or empty
wrapper. Notices omit trees, explanations, read-extent qualifications,
incomplete-details messages and instructional footers.

Complete items are partitioned into wrappers targeting 1,536 bytes for broad
reads and 8,192 bytes for targeted touches, including any guidance. Aggregate
output grows with enumeration size; an indivisible item or retrieval instruction
exceeding its target is emitted intact with substantive content in its own
wrapper. No span identity is silently omitted.

Check coupled evidence before committing. Moving an address uses
`git span replace <name> <old-anchor> <new-anchor>`; deliberately accepting
content at the same address uses `git span add <name> <anchor>`. Neither
command records relationship review, and zero drift does not prove correctness.

### Verified relocations are refreshed before delivery

After writes, before delivery, the hook runs `git span context --fix` for the touched file
or range. It refreshes verified exact-content relocations in selected spans and
elsewhere in addressed files; response selection stays scoped.
Whitespace edits and fuzzy matches remain drifting for review. Repairs update
`.span/` worktree files; include them with the source change when committing.

### When a span surfaces (and resurfaces)

Delivery compares the latest snapshot for this repository, span and recipient.
Broad and targeted notices both record delivery; identical repeats are suppressed.
After prior delivery, a changed evidence revision with no current drifting anchor
advances the baseline silently, including definition-only or opaque changes.
Changed revisions with genuine drift surface the short drift notice. Snapshot
eviction or malformed state can cause another initial notice. The evidence
revision is not a semantic verdict.

This adapter has no wired, trustworthy compaction exposure reset.


## Bash intent attribution

Bash and shell calls are attributed from explicit command intent. The
`tool.execute.before` planner and `tool.execute.after` handler share one
bounded parser for
literal shell writes and reads, literal-list loops, literal `sed`/Perl
substitutions, and proven literal Python/Node file-edit dataflows. The parser
never runs an embedded program or expands a dynamic path. Unsupported syntax,
globs, command substitutions, arbitrary generators, history-changing Git
operations, and other unproven dataflows produce logger-only unresolved reason
codes and no touch.

Every candidate is scoped to the effective working directory's repository and
filtered through one batched tracked-file query. Files outside the repository,
ignored files, span metadata, and untracked files are dropped. The `bash`
tool's declared `workdir` argument is used for both planning and
post-tool attribution, so an explicit working directory inside a different
repository is handled in that repository.

Most commands need no persisted pre-state. When a delete, substitution range,
or pre-command EOF cannot be reconstructed safely after execution,
`static-plan.mjs` stores one content-minimal record under the session's
`planned-touches/` directory. A record contains only tracked
repository-relative paths, bounded ranges, operation/index metadata, and small
verification evidence; it never contains a file body or repository tree.
`tool.execute.after` atomically consumes the record once, verifies the evidence,
reparses ordinary operations, and applies shell join and post-state gates before
touching a span. Success, failure, interruption, and duplicate delivery cannot
reuse a plan. Under OpenCode, `session.status` (idle) prunes the session's call-scoped
plans between turns, and `session.deleted` — plus a final `dispose()` sweep at
shutdown — eagerly retire the session memo and any remaining plans;
opportunistic 30-day cleanup covers crashed sessions.

After user input, `session.status` (idle) checks repository notes and sends root sessions
one synthetic prompt to dispatch a forked reviewer using `@review-notes`.
Lookup failures produce a notes read error notice once for that turn. Synthetic prompts and
child sessions do not recurse. OpenCode V2 resumes through `session.synthetic`;
a failed dispatch is logged without an automatic retry loop.

A command that merely exits nonzero still reaches the after hook under
OpenCode — the bash tool returns with a numeric `exit`, and exit-gated join
semantics apply (a short-circuited `&&` attributes nothing because its write
never ran) — but like the twins' failed commands it can surface a write only
when the parse provides decisive post-state evidence, such as an expected
replacement result; an inconclusive write goes silent under a nonzero exit
rather than firing as an existence-gated advisory. The adapter ignores host-level failure results
(invalid arguments, denied permission, spawn errors). Such a call surfaces
nothing, so even one carrying decisive
post-state evidence, such as an expected replacement result, goes
unattributed. This is the degraded-parity caveat documented in
`references/install-and-trust.md`. Interrupted calls (an `exit: null`
result suppresses like an interruption) stay silent. Response-derived reads
remain a separate pass and share only the session memo, so a later read
can surface context without duplicating command-derived output.

Reviewers examine changed behavior before metadata. The parent owns production edits,
staging and commits. Intentional code does not supersede requirements, and disputed
findings remain visible. Metadata completion and zero drift do not establish semantic
approval. Validated notes are removed individually with matching ID/SHA/document
receipts; unresolved notes remain.

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

OpenCode runs hooks in-process without per-hook timeouts, so the plugin
bounds its own `git span` subprocesses. Host-level failures never reach the
after hook and receive no attribution; see `references/install-and-trust.md`.

Run explicit `git span drift` checks or use CI to verify edits outside the
supported touch events; see `references/ci-and-sync.md`.
