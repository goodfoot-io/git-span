# Understanding hook output

The touch pipeline runs after supported reads and writes. Static planning runs
before supported shell calls to capture bounded pre-state when needed.

`PreToolUse` stashes `run_command` input on disk. `PostToolUse` joins on the
step index, gates on the host's `error` field, and queues rendered touch
context for delivery after the invocation's tool batch as an ephemeral
message. Dedicated file tools have no pinned contract and receive no touch
attribution.

## The touch hook: bounded context and discovery

A targeted touch delivers the span's anchors and why in a `<git-span>` block.
Anchors use a shared-prefix tree; changed or unavailable evidence carries status
suffixes. Matching anchors and successful repairs do not establish semantic
agreement: output says relationship review is not recorded in this context.

Structured reads distinguish requested discovery from the tool's visible extent.

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
`PreToolUse` planner and `PostToolUse` handler share one bounded parser for
literal shell writes and reads, literal-list loops, literal `sed`/Perl
substitutions, and proven literal Python/Node file-edit dataflows. The parser
never runs an embedded program or expands a dynamic path. Unsupported syntax,
globs, command substitutions, arbitrary generators, history-changing Git
operations, and other unproven dataflows produce logger-only unresolved reason
codes and no touch.

Every candidate is scoped to the effective working directory's repository and
filtered through one batched tracked-file query. Files outside the repository,
ignored files, span metadata, and untracked files are dropped. The
`run_command` call's `Cwd` argument is used for both planning and post-tool
attribution, so an explicit working directory inside a different repository
is handled in that repository.

Most commands need no persisted pre-state. When a delete, substitution range,
or pre-command EOF cannot be reconstructed safely after execution,
`static-plan.mjs` stores one content-minimal record under the session's
`planned-touches/` directory. A record contains only tracked
repository-relative paths, bounded ranges, operation/index metadata, and small
verification evidence; it never contains a file body or repository tree.
`PostToolUse` atomically consumes the record once, verifies the evidence,
reparses ordinary operations, and applies shell join and post-state gates before
touching a span. Success, failure, interruption, and duplicate delivery cannot
reuse a plan. Under Antigravity, an idle, successful model `Stop` requests
a forked subagent using `review-notes` once per conversation
when repository notes exist. The existing session guard survives call-scoped cleanup;
lookup failure reports the notes read error without forcing another continuation.
Error and step-limit stops do not request review. The surfaced-span memo is deliberately left to its TTL
sweep (pruning it at a turn boundary would make identical spans re-inject
every turn), and opportunistic 30-day cleanup covers crashed sessions.

Antigravity's `PostToolUse` carries no tool response — success collapses to
the absence of the host's `error` field. A command whose input carries
`error` routes to failure attribution and can never surface a write (there is
no post-state evidence to verify against), and response-derived read
attribution is unavailable entirely — the degraded-parity caveat one notch
past OpenCode's. Interrupted calls stay silent.

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

Antigravity gives hooks no exit-code channel. Every pre-tool handler returns
an explicit `{"decision": "allow"}` because an empty response means denial.
Dedicated file tools receive no touch attribution; see
`references/install-and-trust.md`. Hook timeouts use seconds.

Run explicit `git span drift` checks or use CI to verify edits outside the
supported touch events; see `references/ci-and-sync.md`.
