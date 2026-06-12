# Storage model

git-mesh has **no Git refs**. There is no `refs/meshes/*`, no `refs/anchors/*`,
no mesh refspec, and no reflog plumbing. Everything lives in ordinary tracked
files.

## Where meshes live

Each mesh is a single tracked file under the mesh root (`.mesh/<name>` by
default; configurable). The file *is* the mesh — its anchors are lines in that
file, not separate objects:

```text
packages/agent-hooks/src/pre-tool-use.ts#L34-L34 sha256:4441b3fb…
packages/git-mesh/src/mesh.rs#L1-L40 sha256:a9f2c310…

<the mesh "why" prose>
```

A mesh name maps directly to a file path. Because a filesystem path cannot be
both a file and a directory, two mesh names where one is a strict prefix of the
other (`a/b` and `a/b/c`) collide; resolve by renaming one
(`git mesh move <name> <name>/index`).

## Anchors

An anchor is a `path#L<start>-L<end> sha256:<hash>` line *inside* a mesh file
(whole-file anchors omit the `#L…` range). Anchors are never stored as Git
objects or refs. Reading and resolving an anchor reads the mesh file and the
referenced source content directly from the index/worktree/HEAD.

## Sharing

Mesh files are stored with LF line endings on every platform. The `.mesh/`
directory contains a `.gitattributes` that pins `* text eol=lf`, and the
repository root `.gitattributes` adds `.mesh/** text eol=lf` as a second
guarantee. No `core.autocrlf` setting or manual configuration is required —
the cross-platform behavior is automatic.

Meshes are versioned, fetched, and pushed exactly like any other tracked file —
`git pull`/`git push` move them with the surrounding code. There is no
`git mesh fetch`/`push`/`sync`. All `git mesh` reads are local and never touch
the network. See `./ci-and-sync.md` for the CI/sync workflow.
