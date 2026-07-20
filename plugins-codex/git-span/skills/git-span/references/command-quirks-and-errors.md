# Command quirks and errors

A span is a tracked plain-text file under `.span/<name>`. `git span add` /
`remove` / `why` edit that file in the working tree; you persist edits with
`git add .span && git commit`. There is no staging area and no
`git span commit` step.

## A span edit is not in history

If a teammate (or CI) does not see a span change you made, the edit was
written to `.span/<name>` but never committed. `git span add`/`remove`/`why`
only touch the working-tree file:

```bash
git status .span            # the edited span file shows as modified
git add .span && git commit -m "Update <name> span"
```

`git span show <name>` reflects the working-tree file immediately; teammates
only see it after the commit lands on a shared branch.

## `why` never gates on the span existing

A bare `git span why <name>` on an unknown name does not error — it prints
`` `<name>` has no why recorded. `` at exit 0. Worse, `git span why <name> -m
"..."` on an unknown name silently **creates** a new, anchor-less span with
that why instead of failing. A why that looks freshly created (rather than
updated) usually means the target name was mistyped — check with
`git span list`.

A why is optional on `add` too — `git span add` succeeds without one — but
strongly recommended. Write one before or alongside the commit that
introduces the span; it is inherited across routine re-anchors, so only write
a new one when the subsystem itself changes.

## One malformed `.span/` file can break the whole repo's view, not just its own span

`git span show <name>` reads only that one file: if `foo` is malformed but
`bar/baz` is fine, `git span show bar/baz` still works, and `git span show
foo` fails with a scoped message naming `foo`:

```
git span show: invalid span file: line 1: <parse error>

The span file for `foo` could not be read.
```

`git span list`, `git span stale`, and `git span doctor` instead enumerate
**every** span file before filtering — one malformed file anywhere aborts the
whole command, even when you passed a specific, otherwise-healthy target:
`git span stale bar/baz` fails too, while `foo` alone is broken. The failure
is a bare, repo-scoped line with **no span name attached**:

```
error: invalid span file: line 1: <parse error>
```

(exit 1). `doctor` does not accept a name/path argument to narrow the scan
(`git span doctor foo` errors `unexpected argument 'foo' found`), so once
`doctor`/`list`/`stale` die this way you cannot ask them which span is at
fault. Bisect with `git span show <name>` on suspect names instead — it is
the only command that fails scoped to one span. Fix the malformed file
(`git checkout -- .span/<name>` to revert to a known-good commit, or hand-edit
the TOML) and re-run.

This is fail-closed by design: a span that cannot be parsed is surfaced, never
silently skipped — but note that "surfaced" currently means the whole
enumeration aborts rather than a per-span report continuing past it.

## `git log --all` and span history

Prefer the built-in walk over generic git commands:

```bash
git span history <name>               # XML by default; --format json for JSON
git span history <name> -n <count>    # cap at the newest N commits
```

It renders each commit that changed `.span/<name>` oldest→newest, with the
anchor content added/modified/removed, plus a trailing `current` entry
describing worktree drift from HEAD. For cross-span queries plain git still
works — spans are ordinary tracked files, so `git log --all` shows them only
as part of the commits that touched `.span/`, and there are no custom span
refs to exclude:

```bash
git log --oneline -- .span/<name>
git log -p -- .span/<name>            # full diff of every edit
```

## `git span doctor`

A setup audit, not a semantic-drift check: confirms every visible span file
under the span root parses, and reports a store-size summary (bytes used vs.
configured cap). Run it when local behavior looks wrong — but see above: a
single malformed span file makes the whole run fail with an unscoped error
rather than a clean per-span report.
