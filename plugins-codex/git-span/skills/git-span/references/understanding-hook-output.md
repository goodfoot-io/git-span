# Understanding hook output

The touch pipeline runs after supported reads and writes. Static planning runs
before supported shell calls to capture bounded pre-state when needed.

`PostToolUse` observes `apply_patch|exec_command|exec|Bash` and injects
bounded `additionalContext` after the tool completes.

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

Codex `SessionStart` resets exposure, including explicit compact/resume events.
The shell and patch paths retain self-contained footer instructions.

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
reuse a plan. Shell hooks record observed Git commits as session notes;
editing a file alone creates no commit note. Keep the CLI and plugin on the
same release: receipt coordination uses the CLI's native lock helper.
A commit in a repository created or first entered in the same Bash call (`git init`
then `git commit`, or a repository named only through a shell variable) gets no note,
because enrollment observes only the hook's cwd and literal paths.
When notes for the session exist, `Stop` asks the agent to dispatch a forked subagent to load
`$git-span:review-notes` for recognized notes belonging to the session.
Empty selection proceeds silently; lookup failure reports that commit notes could not be read.
Stop continuations skip another request to avoid recursive blocking. `SessionEnd` on Claude and empty stops or continuations on Codex
retire session state; a requested review or failed lookup preserves it;
opportunistic 30-day cleanup covers crashed sessions.

A failed Bash command can still surface a write only when the supported family
provides decisive post-state evidence, such as an expected replacement result.
Inconclusive writes and interrupted calls stay silent. Response-derived reads
remain a separate pass and share only the session memo, so a later read can
surface context without duplicating command-derived output.

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

Codex hook timeouts use seconds; Claude Code uses milliseconds. Convert units
when comparing their hook definitions.

Run explicit `git span drift` checks or use CI to verify edits outside the
supported touch events; see `references/ci-and-sync.md`.
