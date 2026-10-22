# Understanding hook output

The touch pipeline runs after supported reads and writes. Static planning runs
before supported shell calls to capture bounded pre-state when needed.

`tool.execute.before` captures shell and patch plans. `tool.execute.after`
observes `bash`/`read`/`edit`/`write`, plus `apply_patch` on gpt models, and
appends bounded `<git-span>` context to the tool output. The experimental
`execute` tool is outside this coverage.

## The touch hook: bounded context and discovery

A targeted touch delivers the span's anchors and why in a `<git-span>` block.
Anchors use a shared-prefix tree; changed or unavailable evidence carries status
suffixes. Matching anchors and successful repairs do not establish semantic
agreement: output says relationship review is not recorded in this context.

Structured reads distinguish requested discovery from the tool's visible extent.
OpenCode's structured read response has no pinned extent metadata contract in
this adapter. Its read extent remains unknown; explicit requested ranges can
still receive complete hook relationship context with that uncertainty stated.

A broad read can discover relationships outside its visible lines. Above three
sections or 1.5 KiB, or when broad extent is unknown, it shows an index with
span names, file counts, changed-evidence signals and retrieval commands. The
index reports omitted spans. It does not record full exposure: a later targeted
read or write still gets the complete first section. Targeted output is bounded
at 8 KiB; incomplete details retain a retrieval route and remain eligible.
These provisional byte budgets constrain context; they are not measured optima.

After complete exposure, changed visible fields render a delta: changed anchors,
the why's first sentence, the complete why when changed, and `git span show`.
When only the opaque evidence revision changes and the why and anchor metadata
are identical, the hook repeats the full source/status section within the same
byte budget and reports the changed revision. Exact repeats are suppressed,
including after a delta. A→B→A is delivered again. Snapshot eviction or malformed private state
requires full delivery again. The session store holds at most 128 latest
snapshots, at most 8 KiB each and 256 KiB serialized state; it stores no file blobs.
Recipient transcript identities separate Claude structured-read/write baselines.

This adapter has no wired, trustworthy compaction reset. It retains
self-contained footer instructions; suppression is not claimed compaction-safe.

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

Delivery compares the latest completely injected relationship context for this
repository, span and recipient identity. Identical repeats are suppressed; new
changes are delivered again, even when status is unchanged. Discovery indexes
and incomplete output never advance that baseline. The evidence revision covers
the definition and relevant captured source state, not a semantic verdict.

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
