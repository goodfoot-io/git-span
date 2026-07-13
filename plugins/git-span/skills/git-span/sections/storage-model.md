# Storage model

git-span has **no Git refs**. There is no `refs/spans/*`, no `refs/anchors/*`,
no span refspec, and no reflog plumbing. Everything lives in ordinary tracked
files.

## Where spans live

Each span is a single tracked file under the span root (`.span/<name>` by
default; configurable). The file *is* the span — its anchors are lines in that
file, not separate objects:

```text
packages/agent-hooks/src/pre-tool-use.ts#L34-L34 sha256:4441b3fb…
packages/git-span/src/span.rs#L1-L40 sha256:a9f2c310…

<the span "why" prose>
```

A span name maps directly to a file path. Because a filesystem path cannot be
both a file and a directory, two span names where one is a strict prefix of the
other (`a/b` and `a/b/c`) collide; resolve by renaming one
(`git span move <name> <name>/index`).

## Anchors

An anchor is a `path#L<start>-L<end> sha256:<hash>` line *inside* a span file
(whole-file anchors omit the `#L…` range). Anchors are never stored as Git
objects or refs. Reading and resolving an anchor reads the span file and the
referenced source content directly from the index/worktree/HEAD.

## Sharing

Span files are stored with LF line endings on every platform. The `.span/`
directory contains a `.gitattributes` that pins `* text eol=lf`, and the
repository root `.gitattributes` adds `.span/** text eol=lf` as a second
guarantee. No `core.autocrlf` setting or manual configuration is required —
the cross-platform behavior is automatic.

Spans are versioned, fetched, and pushed exactly like any other tracked file —
`git pull`/`git push` move them with the surrounding code. There is no
`git span fetch`/`push`/`sync`. All `git span` reads are local and never touch
the network. See `./ci-and-sync.md` for the CI/sync workflow.
