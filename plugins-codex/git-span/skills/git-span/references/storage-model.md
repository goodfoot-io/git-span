# Storage model

git-span has **no Git refs**. There is no `refs/spans/*`, no span refspec,
and no reflog plumbing. Everything lives in ordinary tracked files.

## Where spans live

Each span is a single tracked file under the span root (`.span/<name>` by
default; configurable via `--span-dir`, `GIT_SPAN_DIR`, or
`git config git-span.dir`). The file *is* the span — its anchors are lines in
that file, not separate objects:

```text
packages/agent-hooks/src/pre-tool-use.ts#L34-L34 rk64:4441b3fb2a19c0d4
packages/git-span/src/span.rs#L1-L40 rk64:a9f2c3105e7b8f16

<the span "why" prose>
```

`git span show <name>` renders this parsed (TOML-ish, with `[[anchors]]`
blocks) — that rendering is not the on-disk format above. Trust `show`'s
output for reading; don't hand-parse the raw file yourself.

A span name maps directly to a file path. Because a filesystem path cannot be
both a file and a directory, two span names where one is a strict prefix of the
other (`a/b` and `a/b/c`) collide; resolve by renaming one
(`git mv .span/<name> .span/<name>/index` and commit).

## Anchors

An anchor is a `path#L<start>-L<end> rk64:<16-hex-digit hash>` line *inside* a
span file (whole-file anchors omit the `#L…` range). Anchors are never stored
as Git objects or refs. Reading and resolving an anchor reads the span file
and the referenced source content directly from the index/worktree/HEAD.

## Sharing

Span files are stored with LF line endings on every platform: git-span writes
a `.span/.gitattributes` (`* text eol=lf`, inherited by every file under
`.span/`) the first time it creates the span root. No `core.autocrlf` setting
or manual configuration is needed for spans themselves.

Spans are versioned, fetched, and pushed exactly like any other tracked file —
`git pull`/`git push` move them with the surrounding code. There is no
`git span fetch`/`push`/`sync`. All `git span` reads are local and never touch
the network. See `./ci-and-sync.md` for the CI/sync workflow.

## Optional merge driver

Registering a merge driver makes git collapse the easy majority of `.span/`
conflicts in place during `git merge`, so they never surface. This is the one
piece of git *config* spans can use — and it is entirely optional. Skipping it
costs nothing: `.span/**` falls back to git's line merge, and `git span stale
--fix` resolves the result afterward to the identical clean state (see
SKILL.md's `stale --fix` gotcha). Registration has two parts, because git
distributes one and not the other:

```gitattributes
# committed and shared with the repo
.span/** merge=span
```

```ini
# .git/config -- per-clone, NOT distributed by git; each clone adds it once
[merge "span"]
    name = git-span structural span merge
    driver = git span merge-driver %O %A %B %L
```

There is **no auto-installer** — registration is manual by design, and
`git span doctor` does not check for it (verified: its output never mentions
merge-driver state, registered or not). Never run `git span merge-driver` by
hand; git invokes it with the temp-file arguments shown above. Until a clone
adds the `.git/config` block, conflicts simply fall back to `--fix`.
