# Git hook setup

## Overview

Two thin-trigger git hooks drive the background mesh-reconciliation pipeline:

- **`post-commit`** fires after every successful commit. It spawns the detached
  dispatcher, which promotes matching pre-commit records, runs detection in a
  scratch worktree, and (if needed) spawns a confined standalone agent to
  reconcile stale meshes.

- **`post-rewrite`** fires after `git commit --amend`, `git rebase`, and other
  commands that rewrite existing commits. It spawns the dispatcher with the
  `--post-rewrite` flag and passes the old->new commit SHA mapping on stdin.
  The dispatcher demotes any post-commit records whose stamped SHA was
  rewritten, so they are re-promoted and re-detected against the new commit.

Both hooks are **thin triggers** -- they spawn a background process, return
exit code 0 immediately, and never propagate downstream failures. All logging,
error handling, and retry logic lives in the dispatcher
(`hooks/bin/dispatcher.mjs`), which writes to `.mesh/dispatcher.log`.

## Hook scripts

Reference shell scripts are provided at:

- `plugins/git-mesh/hooks/git-hooks/post-commit`
- `plugins/git-mesh/hooks/git-hooks/post-rewrite`

Each script resolves the dispatcher relative to its own location on disk via
`$0`, so it works regardless of where the plugin is installed. **Symlink
installation is required** -- if you copy the script, `$0` resolves to
`.git/hooks/` and the dispatcher won't be found.

The scripts are POSIX `sh` (no bashisms) and safe to use as-is or as a template
for custom hook configurations.

## Installation

Git hooks are **per-clone** configuration. There is no auto-installer -- hook
installation is manual by design, matching the same pattern used for the
optional merge driver (see below).

### post-commit

Symlink the reference script into your repository's hooks directory. The script
finds `dispatcher.mjs` relative to its real location on disk -- copying instead
of symlinking breaks this resolution.

```bash
ln -s ../../plugins/git-mesh/hooks/git-hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

### post-rewrite

```bash
ln -s ../../plugins/git-mesh/hooks/git-hooks/post-rewrite .git/hooks/post-rewrite
chmod +x .git/hooks/post-rewrite
```

### Chaining into existing hooks

If your repository already has `post-commit` or `post-rewrite` hooks (for
version bumping, build steps, doc validation, or other tooling), append the
mesh hook line rather than overwriting:

```sh
#!/bin/sh
# Existing tooling
./scripts/bump-version.sh

# git-mesh post-commit trigger
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
COMMIT_SHA=$(git rev-parse HEAD)
nohup node "${SCRIPT_DIR}/../bin/dispatcher.mjs" \
  --repo-root "${REPO_ROOT}" --commit-sha "${COMMIT_SHA}" \
  < /dev/null > /dev/null 2>&1 &
exit 0
```

Some tools (e.g., husky) manage hook files through their own lifecycle. In
those cases, call the mesh hook from within the existing hook file rather
than replacing the managed file.

### stdin ordering for post-rewrite

The `post-rewrite` hook receives the old->new SHA mapping on stdin. Git passes
the same input to every script listed in the hook file. For best results, place
the mesh post-rewrite trigger **first** in the chain so the SHA mapping is
consumed before any downstream script that might transform stdin.

Correctness never depends on ordering, however. Each hook script in a chain
receives its own copy of the stdin stream, so the mesh trigger works correctly
at any position.

## How it works

1. The **Stop hook** (Claude Code session end) writes pre-commit anchor
   records to `<git-common-dir>/git-mesh/pre-commit/`.

2. The **post-commit hook** spawns the dispatcher. The dispatcher promotes
   any pre-commit records whose anchored paths changed in the commit to
   `post-commit/` (stamped with the commit SHA and branch).

3. If a rewrite occurs (rebase, amend), the **post-rewrite hook** spawns the
   dispatcher with `--post-rewrite`. It demotes post-commit records whose
   stamped SHA was rewritten back to `pre-commit/` for re-promotion.

4. The dispatcher claims, detects, and (if needed) spawns a confined
   standalone agent to reconcile stale meshes. All results are landed via
   atomic CAS on the resolved branch.

## Mesh files are tracked content

A mesh is an ordinary tracked plain-text file under `.mesh/<name>`. `git mesh
add` / `remove` / `why` write that file directly, and you persist edits the
same way you persist any source change:

```bash
git add .mesh && git commit
```

Meshes follow normal git history: a rebase or `git commit --amend` rewrites
the `.mesh/` file content along with everything else in the commit, and a
fresh clone gets the meshes via the same `git clone`/`git pull` that brings
the code.

Mesh files are LF-pinned on all platforms automatically -- no `core.autocrlf`
configuration is needed. The `.mesh/` directory contains a `.gitattributes`
that enforces `* text eol=lf`, so Windows and Unix checkouts produce identical
mesh content without any developer action.

The only other automation is the Claude Code mesh-overlap hook (PreToolUse),
which surfaces intersecting mesh anchors inline -- see `./understanding-hook-output.md`.

## Optional merge driver

This is the one piece of git *config* meshes can use -- and it is **optional**,
not required. Registering a merge driver makes git collapse the easy majority
of `.mesh/` conflicts in place during `git merge` so they never surface.
Skipping it costs nothing: `.mesh/**` falls back to git's line merge, and
`git mesh stale --fix` resolves the result afterward to the identical clean
state (see `./command-reference.md` section "Merge conflict resolution").
Registration has two parts, because git distributes one and not the other:

```gitattributes
# committed and shared with the repo
.mesh/** merge=mesh
```

```ini
# .git/config -- per-clone, NOT distributed by git; each clone adds it once
[merge "mesh"]
    name = git-mesh structural mesh merge
    driver = git mesh merge-driver %O %A %B %L
```

There is **no auto-installer** -- registration is manual by design, and
`git mesh doctor` does not check for it. Never run `git mesh merge-driver` by
hand; git invokes it with the temp-file arguments shown above. Until a clone
adds the `.git/config` block, conflicts simply fall back to `--fix`.
