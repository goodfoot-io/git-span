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
git span stale [<target>...] [--format human|porcelain|json] [--no-exit-code]
git span stale [<target>...] [--fix]                 # re-anchor in place; resolve .span/ conflicts; human format only
git span stale --perf-trace <path>                   # CSV of per-anchor wall-clock traces; full scan only, no positional paths
git span tree <glob>... [-d|--depth <n>] [--format human|json]
git span history <name> [--format xml|json] [-n|--limit <count>]
git span doctor
```

`--offset` skips the first N spans after filtering, before `--limit`; `--limit`
caps output after filtering and `--offset`.

Each `<target>` for `list`/`stale` is one of: a span name, a file path, or —
`list` only — a line-range address `<path>#L<start>-L<end>`. Globs are
expanded by the shell. Multiple targets are unioned and deduplicated.

Resolution rule: arguments containing `#L` are line-range addresses. Arguments
that match span-name shape — one or more kebab-case segments separated by `/` —
try span-name resolution first and fall through to path lookup when no span
matches. Arguments that don't match span-name shape (paths with extensions,
globs) go straight to path lookup. A target that resolves to no spans is fine
on its own — `list` exits 0 with an empty result ("No spans match the
filters."); `stale` exits 0 silently ("0 stale across 0 spans"). The command
only errors when a target names a referent that doesn't exist at all (missing
file, missing span name, unmatched literal glob) — see `references/inspect.md`
§ "Selector trap" for the exact error text split between `list` and `stale`.

`stale` exits 1 when it finds drift, 0 when clean; `--no-exit-code` forces exit
0 regardless of findings (report-only).

`git span show <name>` emits the span file's content (name, why, anchors, and
the `[config]` block). To read a span at a past commit, use ordinary git
history on the tracked file: `git show <commit-ish>:.span/<name>`.

`git span tree <glob>...` traces blast radius: it renders a clique-grouped
impact tree rooted at the matched anchor paths, expanding outward through span
co-occurrence to the files each could affect. Files that all anchor the same
span — and are therefore mutually connected — collapse onto one
comma-separated line and expand once as a unit. Unlike `list`/`stale`, `tree`
requires at least one argument and **fails closed**: a pattern matching no
anchored file is an error (there is no silent exit-0). Arguments are file
**paths and globs only** — no `#L<start>-L<end>` line-range addresses or bare
span names, resolved repo-relative with the same matching as `list`/`stale`.
`-d`/`--depth` bounds the expansion (default `3`; `--depth 0` prints the roots
only). `--format human` (default) prints the nested markdown list; `--format
json` emits the same structure as nested
`{ "members": [...], "children": [...] }` nodes.

`git span history <name>` walks the span file's git history oldest→newest:
each commit that changed it, the anchor content added/modified/removed, and an
optional trailing `current` entry describing worktree drift from HEAD.
Defaults to XML; `--format json` for JSON. `-n`/`--limit` caps the walk at the
newest N commits.

## Editing a span

```bash
git span add <name> <anchor>... [--at <commit-ish>]   # write anchors into .span/<name>
git span remove <name> <anchor>...                    # remove anchors from .span/<name>
git span why <name>                                   # print current why
git span why <name> [-m <text>]                       # write a new why into .span/<name>
git add .span && git commit                           # persist the edits
```

`git span add` without `--at` hashes each anchor against the file content at
`HEAD`; `--at <commit-ish>` hashes against an ordinary git commit-ish instead.
`add` rejects an anchor whose end line exceeds the file's current line count
(`end=N exceeds file line count (M)`).

`git span why <name>` never gates on the span existing: a bare read of an
unknown name prints `` `<name>` has no why recorded. `` at exit 0, and
`-m` on an unknown name silently **creates** a new, anchor-less span with that
why. If a `why` you expected to update instead reads as freshly created,
double-check the span name for typos with `git span list`.

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
`list`, `stale`) until it is resolved. Two commands resolve it — you never
hand-edit an `rk64:` hash.

```bash
git span stale --fix              # authoritative resolver (also re-anchors drift)
git span merge-driver <BASE> <OURS> <THEIRS> <MARKER_LEN>   # git-invoked accelerator, never run by hand
```

`git span stale --fix` is the authoritative finisher. It re-anchors every
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
signal), leaving `git span stale --fix` to finish authoritatively. It is a
strict subset of `--fix`: a developer who never registers it reaches the
identical clean end state through `--fix` alone; the driver changes only how
many conflicts surface mid-merge, never whether a clean result is reachable.

**Known gap: multi-anchor spans mid-merge, before the merge commit.** A span
with two or more anchors on the *same file*, both drifting from the same
merge, where the `.span/` file itself carries **no** conflict markers (neither
branch touched it) — only the source conflicted. Running `git span stale --fix`
while `.git/MERGE_HEAD` is still present (source resolved and staged, merge
commit not yet made) rewrites the *first* drifted anchor correctly but
silently leaves the second one pointing at its stale location — even though
the human-readable diagnostic for that second anchor reports the correct new
location. Repeating `--fix` with no other change reproduces the identical
partial result every time; it does not converge until the merge commit is
made. **Workaround:** finish the merge commit before relying on `--fix` to
fully resolve a multi-anchor span — run `git span stale --format porcelain`
after `git commit` to confirm it is actually clean, rather than trusting a
mid-merge `--fix` run's exit code or diagnostic text at face value for spans
with 2+ anchors on one file.

## Reserved span names

A span name must be kebab-case segments separated by `/`. The following
tokens are reserved and cannot be used as a span name (so the bare
`git span <name>` form is unambiguous): `add`, `remove`, `commit`, `why`,
`restore`, `revert`, `delete`, `move`, `stale`, `tree`, `fetch`, `push`,
`doctor`, `log`, `config`, `list`, `help`, `pre-commit`, `advice`, `rewrite`,
`hooks`, `merge-driver`, `history`. `show` is **not** reserved — `git span add
show <anchor>` succeeds.
