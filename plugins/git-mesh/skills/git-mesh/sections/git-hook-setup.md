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

Both hooks are **thin triggers** — they spawn a background process, return
exit code 0 immediately, and never propagate downstream failures. All logging,
error handling, and retry logic lives in the dispatcher
(`hooks/bin/dispatcher.mjs`), which writes to `.mesh/dispatcher.log`.

## Installation

Git hooks are **per-clone** configuration. There is no auto-installer — hook
installation is manual by design, matching the same pattern used for the
optional merge driver (see below).

If you already have existing `post-commit` or `post-rewrite` hooks, **append
the mesh hook commands** rather than replacing the file. Never overwrite a
working hook without verifying it is not used by other tooling.

### post-commit

Create or append to `.git/hooks/post-commit` in your repository:

```sh
#!/bin/sh
# Thin trigger for git-mesh post-commit pipeline.
# Spawns the dispatcher detached and returns 0 immediately.
# All real work happens in the background; failures log to .mesh/dispatcher.log.

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0

nohup node "$CLAUDE_PLUGIN_ROOT/hooks/bin/dispatcher.mjs" \
  --repo-root "$REPO_ROOT" \
  < /dev/null > /dev/null 2>&1 &

exit 0
```

The file must be executable (`chmod +x .git/hooks/post-commit`).

`$CLAUDE_PLUGIN_ROOT` is set by the Claude Code runtime when it activates the
plugin. If you invoke hooks outside of a Claude Code session (e.g., from a
plain terminal or CI), you must set `CLAUDE_PLUGIN_ROOT` in the environment:

```bash
export CLAUDE_PLUGIN_ROOT="/path/to/plugins/git-mesh"
```

### post-rewrite

Create or append to `.git/hooks/post-rewrite` in your repository:

```sh
#!/bin/sh
# Thin trigger for git-mesh post-rewrite pipeline.
# Spawns the dispatcher detached with the --post-rewrite flag and
# passes the old->new SHA mapping received on stdin.
# All real work happens in the background; failures log to .mesh/dispatcher.log.

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0

# Capture stdin (old->new SHA mapping from git post-rewrite) and pipe to dispatcher
INPUT=$(cat)
echo "$INPUT" | nohup node "$CLAUDE_PLUGIN_ROOT/hooks/bin/dispatcher.mjs" \
  --repo-root "$REPO_ROOT" --post-rewrite \
  > /dev/null 2>&1 &

exit 0
```

The file must be executable (`chmod +x .git/hooks/post-rewrite`).

### Chaining into existing hooks

If your repository already has `post-commit` or `post-rewrite` hooks (for
version bumping, build steps, doc validation, or other tooling), append the
mesh commands rather than overwriting:

```sh
#!/bin/sh
# Existing tooling
./scripts/bump-version.sh

# git-mesh post-commit trigger
REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
nohup node "$CLAUDE_PLUGIN_ROOT/hooks/bin/dispatcher.mjs" \
  --repo-root "$REPO_ROOT" \
  < /dev/null > /dev/null 2>&1 &
exit 0
```

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

Mesh files are LF-pinned on all platforms automatically — no `core.autocrlf`
configuration is needed. The `.mesh/` directory contains a `.gitattributes`
that enforces `* text eol=lf`, so Windows and Unix checkouts produce identical
mesh content without any developer action.

The only other automation is the Claude Code mesh-overlap hook (PreToolUse),
which surfaces intersecting mesh anchors inline — see `./understanding-hook-output.md`.

## Optional merge driver

This is the one piece of git *config* meshes can use — and it is **optional**,
not required. Registering a merge driver makes git collapse the easy majority
of `.mesh/` conflicts in place during `git merge` so they never surface.
Skipping it costs nothing: `.mesh/**` falls back to git's line merge, and
`git mesh stale --fix` resolves the result afterward to the identical clean
state (see `./command-reference.md` § "Merge conflict resolution").
Registration has two parts, because git distributes one and not the other:

```gitattributes
# committed and shared with the repo
.mesh/** merge=mesh
```

```ini
# .git/config — per-clone, NOT distributed by git; each clone adds it once
[merge "mesh"]
    name = git-mesh structural mesh merge
    driver = git mesh merge-driver %O %A %B %L
```

There is **no auto-installer** — registration is manual by design, and
`git mesh doctor` does not check for it. Never run `git mesh merge-driver` by
hand; git invokes it with the temp-file arguments shown above. Until a clone
adds the `.git/config` block, conflicts simply fall back to `--fix`.
