# Command reference

A span is an ordinary tracked plain-text file under the span root (default
`.span/<name>`, overridable with the `GIT_SPAN_DIR` environment variable or
`git config git-span.dir`). `git span add` / `remove` / `why` edit that file
directly; `git add .span && git commit` persists it. There is no staging area,
no span refs, and no `git span commit` step.

## Anchor grammar

- **Line-range anchor**: `<path>#L<start>-L<end>` — 1-based, inclusive.
- **Whole-file anchor**: `<path>` alone — no `#L…` suffix.

`#` is a shell comment character; quote anchors when scripting (`'src/auth.ts#L10-L20'`).

## Global options

Every subcommand (and the bare `git span` form) accepts:

```bash
--perf                  # emit perf timings to stderr (or GIT_SPAN_PERF=1)
-h, --help
```

Only the top-level `git span` also has `-V, --version`.

## Reading

```bash
git span                                             # list every span
git span <name>                                      # show one span (= git span show <name>)
git span show <name>
git span list [<target>...] [--porcelain] [--oneline] [--offset <n>] [--limit <n>]
git span drift [<target>...] [--format human|porcelain|json] [--no-exit-code]
git span drift [<target>...] [--fix]                 # re-anchor in place; resolve .span/ conflicts; human format only
git span context <address>... [--format json]        # one exact, versioned dependency-context answer
git span context <address>... --fix [--operation-id <uuid>]
git span drift --perf-trace <path>                   # CSV of per-anchor wall-clock traces; full scan only, no positional paths
git span tree <glob>... [-d|--depth <n>] [--format human|json]
git span history <name> [--format human|json] [-n|--limit <count>]
git span doctor
```

`--offset` skips the first N spans after filtering, before `--limit`; `--limit`
caps output after filtering and `--offset`.

Each `<target>` for `list`/`drift` is one of: a span name, a file path, or —
`list` only — a line-range address `<path>#L<start>-L<end>`. Globs are
expanded by the shell. Multiple targets are unioned and deduplicated.

Resolution rule: arguments containing `#L` are line-range addresses. Arguments
that match span-name shape — one or more kebab-case segments separated by `/` —
try span-name resolution first and fall through to path lookup when no span
matches. Arguments that don't match span-name shape (paths with extensions,
globs) go straight to path lookup. A target that resolves to no spans is fine
on its own — `list` exits 0 with an empty result ("No spans match the
filters."); `drift` exits 0 silently ("0 drift across 0 spans"). The command
only errors when a target names a referent that doesn't exist at all (missing
file, missing span name, unmatched literal glob) — see `references/inspect.md`
§ "Selector trap" for the exact error text split between `list` and `drift`.

`drift` exits 1 when it finds drift, 0 when clean; `--no-exit-code` forces exit
0 regardless of findings (report-only).

### Exact batched context

`git span context` accepts one or more exact repository-relative paths or
inclusive `path#L<start>-L<end>` ranges. A bare path is whole-file scope.
Inputs are unioned, duplicate and overlapping ranges are normalized, and the
command returns deterministic schema-v1 JSON with:

- normalized `scopes`;
- a `mutation` object (`requested`, `rewritten`, and exact span/anchor counts);
- every exactly overlapping span, ordered by name, with nullable `why`;
- the anchored/current overlap(s) that selected it, including scope index,
  final anchor ordinal and ID, basis, matched location, and intersection; and
- the selected span's complete ordered anchor set, including anchored/current
  locations, status, primary `source`, and ordered `sources`.

Status tokens are `FRESH`, `RESOLVED_PENDING_COMMIT`, `MOVED`, `CHANGED`,
`DELETED`, `CONFLICT`, `SUBMODULE`, and `CONTENT_UNAVAILABLE`. Source tokens
are `WORKTREE`, `INDEX`, and `HEAD`. Unavailable reasons are
`LFS_NOT_FETCHED`, `LFS_NOT_INSTALLED`, `PROMISOR_MISSING`, `SPARSE_EXCLUDED`,
`FILTER_FAILED`, and `IO_ERROR`; dynamic detail is a valid UTF-8 prefix of at
most 4096 bytes and carries `truncated: true` when shortened. Unknown schema
versions or required enum values must be rejected by consumers.

A valid scope with no overlaps exits 0 with `"spans": []`. Semantic drift is
successful data and also exits 0. Invalid/outside/missing paths, malformed
ranges, conflicted or racing definitions, unavailable authoritative state,
more than 4096 input/normalized scopes, or a response above 16 MiB exit
nonzero, diagnose on stderr, and leave stdout empty. Context accepts exact
paths only—no globs or span names—and never expands the transitive graph that
`tree` reports.

`--fix` repairs only position drift and whitespace-equivalent changes. It
plans the exact post-state response and checks its size before the first span
rename, then journals original/planned bytes and publishes durable span bytes,
the committed response, and the service's immutable post-generation before
replying. Meaning-changing edits remain `CHANGED`. Cycles and swaps are
planned by final ordinal rather than mutation order.

For retryable automation, supply `--operation-id <uuid>` with `--fix`. The
same UUID and identical normalized request returns the originally committed
response—even from a later foreground process—without applying the repair a
second time. Reusing it for a different request fails with empty stdout. If
the option is omitted, the client generates a UUID and flushes
`git-span context operation: <uuid>` to stderr before it can send a mutating
request; retain that receipt when delivery becomes unknown. `--operation-id`
without `--fix` and malformed UUIDs are usage errors.

On Linux, a private per-worktree watched service keeps a split location index
and independently decoded span rows resident. Its directory is mode 0700,
socket mode 0600, and every request authenticates peer UID, nonce, protocol,
build, schema, resolver, worktree, Git-dir/common-dir, resolved span root, and
output-affecting configuration. Watch uncertainty, overflow, unsupported
backend/platform, startup/path limits, and service health failures take the
strict in-process path with identical JSON/failure semantics. An idle service
exits after 60 seconds. Linked worktrees and alternate `GIT_SPAN_DIR` roots do
not share service state.

`--perf`/`GIT_SPAN_PERF=1` keeps JSON alone on stdout and reports service RPC,
watcher, repository/corpus, generation/resolver, selection, rewrite, and
latency counters on stderr. The released-binary acceptance harness is
[packages/git-span/scripts/context-acceptance.py](./packages/git-span/scripts/context-acceptance.py):
it uses 31 samples per clean, moved, semantic, no-overlap, multi-span, and
multi-path cell and fails unless every warm cell improves at least 30% at p50
and 20% at p95 over the legacy fix/list/drift/why process lifecycle.

`git span show <name>` emits the span file's content (name, why, anchors,
resolution audit records, and the `[config]` block). Each `[[resolved]]` entry
names the timestamp, `add`/`replace` command, address, recorded hash, and a
computed `state`: `current` while the anchor at that identity still has the
recorded hash, `stale` when its hash changed or the identity is gone. Stale
records are provenance, not a command gate, and are never deleted
automatically. To read a span at a past commit, use ordinary git history on the
tracked file: `git show <commit-ish>:.span/<name>`.

`git span tree <glob>...` traces blast radius: it renders a clique-grouped
impact tree rooted at the matched anchor paths, expanding outward through span
co-occurrence to the files each could affect. Files that all anchor the same
span — and are therefore mutually connected — collapse onto one
comma-separated line and expand once as a unit. Unlike `list`/`drift`, `tree`
requires at least one argument and **fails closed**: a pattern matching no
anchored file is an error (there is no silent exit-0). Arguments are file
**paths and globs only** — no `#L<start>-L<end>` line-range addresses or bare
span names, resolved repo-relative with the same matching as `list`/`drift`.
`-d`/`--depth` bounds the expansion (default `3`; `--depth 0` prints the roots
only). `--format human` (default) prints the nested markdown list; `--format
json` emits the same structure as nested
`{ "members": [...], "children": [...] }` nodes.

`git span history <name>` walks the span file's git history and renders it
newest→oldest, `git log -p` style: each qualifying commit's declaration diff
and per-anchor unified diffs (rename-aware by content similarity: a
re-anchor whose old and new content pair at ≥ 50% similarity — git's `-M`
default — renders as a rename; below the floor it renders as a deleted
anchor plus a new anchor; and when the recorded side cannot be read —
binary or unrecoverable content — it renders `rename from`/`rename to`
lines with no similarity claim, the move asserted by the declaration
itself), plus a leading, headerless section for the span's *live* drift
against its declaration — every resolver layer `git span drift` reports, with
the `drift source` line naming the observing layers. `HEAD` is an observational
layer, not proof the declaration or content change was committed: inspect the
declaration diff and timeline, then commit or revert a worktree-only declaration
edit as appropriate. The resolver sequence is preserved: line ranges use
`WORKTREE` → `INDEX` → `HEAD`; whole-file anchors use `INDEX` →
`WORKTREE` → `HEAD`.
Defaults to git-log-style text; `--format json` emits
`schema_version: 2` carrying the identical diffs as raw patch strings.
`-n`/`--limit` caps the *rendered* timeline at the newest N entries — the walk
underneath is always complete, so a narrow anchor in a busy file can never
have the window filled with commits that changed nothing observable. When
`--limit` drops older qualifying commits, the command still prints the
requested window but warns on stderr in both formats, and JSON output sets
`scoped: true` on the response object (absent, not `false`, when the
timeline is complete). Treat scoped JSON output as a partial record —
never read it as evidence that a span has no history or no drift.

## Editing a span

```bash
git span add <name> <anchor>... [--at <commit-ish>] [--format human|json] # write anchors into .span/<name>
git span remove <name> <anchor>...                    # remove anchors from .span/<name>
git span replace <name> <old-anchor> <new-anchor>     # atomic swap: retire old, install new, or nothing
git span why <name>                                   # print current why
git span why <name> [<text>] [--format human|json] # write a new why into .span/<name> (json = write mode only)
git add .span && git commit                           # persist the edits
```

`git span add` without `--at` hashes each anchor against the file content in the
working tree; `--at <commit-ish>` hashes against an ordinary git commit-ish instead.
`add` rejects an anchor whose end line exceeds the file's current line count
(`end=N exceeds file line count (M)`). `--at` hashes against the commit-ish,
not the working tree, so a new anchor whose working-tree content differs from
that commit-ish is itself actionable drift for the post-write check — the
span-wide line reports it honestly (exit 1); that is the intended reading, not
a bug.

Every `add` (and `why` write) ends with a scoped post-write check over the
touched span, and its span-wide verdict is the only place span-wide state is
asserted. After the requested-address lines it prints superseded old anchors
(`` Old anchor superseded by `<new>`: `<old>` — next: git span remove ... ``),
old anchors that remain drifted (`` Old anchor remains: `<addr>` (<status>) —
next: git span remove ... ``), and one span-wide line — `` Span `x`: 0 drift
across 1 span (N anchors checked). ``, `` Span `x`: N anchors drifted — ... ``,
`` Span `x`: state indeterminate (index changed during check) — re-run the
command or git span drift x ``, or `` Span `x`: state unverified (<reason>) —
run git span drift x ``. The requested-address lines never assert span health:
the local fact is local, and "clean" appears only as the check's span-wide
fact. `add`/`why` write mode carry drift's exit contract: 0 = write succeeded
and the check found no actionable drift; 1 = actionable drift remains or the
check errored (the output says which); 2 = indeterminate (index changed during
check) — retryable.

`--format human|json` selects the write-mode result (default `human`); `json`
emits the mutation document (`schema_version: 1`, identified by its top-level
`command` key) with the requested-address outcomes, the superseded/remaining
arrays, and the `span_health` block. `why --format json` is write-mode only —
read mode rejects it fail-closed with a usage-style error (exit 1, no stdout)
rather than printing prose.

`git span why <name>` never gates on the span existing: a bare read of an
unknown name prints `` `<name>` has no why recorded. `` at exit 0, and
a positional argument on an unknown name silently **creates** a new, anchor-less span with that
why. If a `why` you expected to update instead reads as freshly created,
double-check the span name for typos with `git span list`.

## Resolution audit records

When `git span add` or `git span replace` retires an unverified
duplicate-identity sentinel, it records that operator decision in the span
file's `[resolved]` section. There is one record per anchor identity; resolving
the same identity again replaces its prior record. The section is maintained
by the CLI, preserved by ordinary span edits and merges, and appears before
`[config]`; do not hand-edit it to make a stale record look current.

The record is tied to the hash that was installed when the operator named the
address. Use `git span show <name>` to inspect `state = "current"` or
`state = "stale"`; age alone does not expire a matching record, while a hash
change makes it stale immediately. JSON mutation output is unchanged—the
audit trail is the tracked span file and the TOML-style `show` output.

## Configuration

Resolver options are per-span and live in a `[config]` block inside the span
file. They are read and shown by `git span show <name>`; edit them by editing
`.span/<name>` directly and committing it like any other tracked change. There
is no `git span config` subcommand.

```toml
# tail of .span/<name>
[config]
copy_detection = "same-commit"   # off | same-commit | any-file-in-commit | any-file-in-repo
ignore_whitespace = false        # true | false
follow_moves = false             # true | false
```

Defaults when the block is absent: `copy_detection = "same-commit"`,
`ignore_whitespace = false`, `follow_moves = false`.

Copy-detection values:
- **`off`** — strict rename-only or no copy tracking.
- **`same-commit`** — default; good balance for ordinary refactors.
- **`any-file-in-commit`** — code may be copied from another file touched in the same commit.
- **`any-file-in-repo`** — last resort; broad and can be expensive.

`ignore_whitespace = true` is appropriate for formatting churn; it is wrong if
whitespace is semantically meaningful. Config is part of the span file, so it
is versioned and shared by every consumer of the span exactly like the
anchors.

## Structural

```bash
git span delete <name>            # remove .span/<name>
```

This removes the span file from the working tree; commit the result with
`git add .span && git commit`. There is no `git span move`/`rename`
subcommand — to rename a span, use `git mv .span/<old> .span/<new>` and
commit. To restore a prior span state, use ordinary git —
`git checkout <commit-ish> -- .span/<name>` or `git revert`.

**Trap:** on a name/directory collision (e.g. span `foo` exists and you `add
foo/bar`), the CLI's own error text suggests `git span move foo foo/index` —
that subcommand does not exist and the suggestion fails with `unrecognized
subcommand 'move'`. Use `git mv .span/foo .span/foo/index` (or pick a
non-colliding name) instead.

## Sync and maintenance

Spans are tracked files: they fetch, push, and pull with ordinary
`git fetch` / `git push` / `git pull`. There are no span refspecs.

```bash
git span doctor                   # audit the local span setup
```

## Merge conflict resolution

A `.span/` file is a derived, line-oriented artifact, so a merge (or rebase,
cherry-pick, stash apply) that touched the same anchored region on both
branches leaves git's textual conflict markers in the span file. A
conflict-markered span is a hard error for every read-only command (`show`,
`list`, `drift`) until it is resolved. Two commands resolve it — you never
hand-edit an `rk64:` hash.

```bash
git span drift --fix              # authoritative resolver (also re-anchors drift)
git span merge-driver <BASE> <OURS> <THEIRS> <MARKER_LEN>   # git-invoked accelerator, never run by hand
```

`git span drift --fix` is the authoritative finisher. It re-anchors every
`Moved` anchor and whitespace-equivalent `Changed` anchor in place (re-hashing
each against the deepest drifting layer, Worktree > Index > HEAD) — a
`Changed` anchor whose content differs beyond whitespace is left drifting so
the coupling resurfaces for human confirmation. Beyond re-anchoring, it
rewrites conflict-markered `.span/` files into one clean version: splits the
markers into ours/theirs, **enforces a clean-source precondition** — every
source file an affected span anchors must itself be conflict-free — reads the
now-clean source, and merges structurally (anchors unioned, re-pointed,
re-hashed against the worktree, written in canonical `(path, start, end)`
order). A source path that was renamed or deleted on one side resolves
automatically when exactly one anchor on the other side shares its exact
line range at a different, readable path: the dead anchor is dropped, and the
surviving anchor is kept, re-pointed, and re-hashed against the worktree — no
manual intervention needed. It produces no commit and is only supported with
`--format human`. It **fails closed** in three cases, leaving a minimal
conflict around exactly the unresolvable lines, declining to re-stage that
span, and reporting loudly:

- a source file an affected span anchors still carries conflict markers,
- the `--why` prose diverged between ours and theirs (no merge base to resolve it), or
- a renamed/missing source path has zero readable same-line-range
  counterparts on the other side, or more than one — the warning names the
  unreadable path (and, when ambiguous, the candidate paths it could not
  choose between).

`git span merge-driver %O %A %B %L` is an **optional accelerator**, invoked by
git itself during a merge — never run by hand. Register it so the easy
majority of `.span/` conflicts collapse in place and never surface:

```
# .gitattributes
.span/** merge=span
```

```ini
# .git/config
[merge "span"]
    name = git-span structural span merge driver
    driver = git span merge-driver %O %A %B %L
```

It receives three clean blob temp files (`<BASE>`=`%O`, `<OURS>`=`%A` which
doubles as the output path, `<THEIRS>`=`%B`) and the marker length (`%L`), must
**not** trust the worktree (which may be mid-merge), and so resolves only the
structurally-derivable part — union of distinct anchors, three-way `--why`
merge, identical anchors. Any same-anchor range/hash divergence is deferred: it
writes a minimal conflict and exits non-zero (git's native partial-resolution
signal), leaving `git span drift --fix` to finish authoritatively. It is a
strict subset of `--fix`: a developer who never registers it reaches the
identical clean end state through `--fix` alone; the driver changes only how
many conflicts surface mid-merge, never whether a clean result is reachable.

**Known gap: multi-anchor spans mid-merge, before the merge commit.** A span
with two or more anchors on the *same file*, both drifting from the same
merge, where the `.span/` file itself carries **no** conflict markers (neither
branch touched it) — only the source conflicted. Running `git span drift --fix`
while `.git/MERGE_HEAD` is still present (source resolved and staged, merge
commit not yet made) rewrites the *first* drifted anchor correctly but
silently leaves the second one pointing at its drifted location — even though
the human-readable diagnostic for that second anchor reports the correct new
location. Repeating `--fix` with no other change reproduces the identical
partial result every time; it does not converge until the merge commit is
made. **Workaround:** finish the merge commit before relying on `--fix` to
fully resolve a multi-anchor span — run `git span drift --format porcelain`
after `git commit` to confirm it is actually clean, rather than trusting a
mid-merge `--fix` run's exit code or diagnostic text at face value for spans
with 2+ anchors on one file.

## Reserved span names

A span name must be kebab-case segments separated by `/`. The following
tokens are reserved and cannot be used as a span name (so the bare
`git span <name>` form is unambiguous): `add`, `remove`, `commit`, `why`,
`restore`, `revert`, `delete`, `move`, `drift`, `tree`, `fetch`, `push`,
`doctor`, `log`, `config`, `list`, `help`, `pre-commit`, `advice`, `rewrite`,
`hooks`, `merge-driver`, `history`. `show` is **not** reserved — `git span add
show <anchor>` succeeds.
