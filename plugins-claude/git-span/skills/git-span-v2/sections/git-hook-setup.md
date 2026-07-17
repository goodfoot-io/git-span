# Git hook setup

## Overview

Two thin-trigger git hooks drive the background span-reconciliation pipeline:

- **`post-commit`** fires after every successful commit. It spawns the detached
  dispatcher, which promotes matching pre-commit records and, if any are
  pending, spawns a single confined standalone agent that claims its own work,
  runs its own detection, and reconciles stale spans.

- **`post-rewrite`** fires after `git commit --amend`, `git rebase`, and other
  commands that rewrite existing commits. It spawns the dispatcher with the
  `--post-rewrite` flag and passes the old->new commit SHA mapping on stdin.
  The dispatcher demotes any post-commit records whose stamped SHA was
  rewritten, so they are re-promoted and re-detected against the new commit.

Both hooks are **thin triggers** -- they spawn a background process, return
exit code 0 immediately, and never propagate downstream failures. All logging,
error handling, and retry logic lives in the dispatcher
(`hooks/bin/dispatcher.mjs`), which writes to `.span/dispatcher.log`.

## Hook scripts

Reference shell scripts:

- `plugins-claude/git-span/hooks/git-hooks/post-commit`
- `plugins-claude/git-span/hooks/git-hooks/post-rewrite`

Each resolves the dispatcher relative to its own location on disk via `$0`, so
it works regardless of where the plugin is installed. **Symlink installation
is required** -- copying the script makes `$0` resolve to `.git/hooks/` and
the dispatcher won't be found. Both are POSIX `sh` (no bashisms).

## Installation

Git hooks are **per-clone** (`.git/hooks/`, never tracked by git). There is no
auto-installer -- hook installation is manual by design, same as the optional
merge driver below.

**Check `core.hooksPath` before installing:**

```bash
git config core.hooksPath   # empty/unset -> .git/hooks/ is authoritative
                             # a path (e.g. `.githooks`) -> that tracked dir is authoritative instead
```

If `core.hooksPath` is set, symlinking into `.git/hooks/` is a silent no-op --
git never reads that directory in this clone. Some repos additionally use a
tracked **dispatcher model** (a thin `<event>` script holding an ordered
`PARTS` list of `<event>.<concern>.sh` files). Where that pattern is already in
use, add git-span as its own concern script and register it in `PARTS`
instead of replacing the event file:

```bash
# e.g. .githooks/post-commit.git-span.sh -- resolve the dispatcher from the
# repo root, since concern scripts are tracked files, not symlinks, and $0
# already points at their real location in the repo
REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
DISPATCHER="${REPO_ROOT}/plugins-claude/git-span/hooks/bin/dispatcher.mjs"
```

`post-commit`/`post-rewrite` are **advisory** (they fire after the action
already landed) -- a dispatcher wiring them must never let a sub-script
failure abort; log/report and continue.

### Direct symlink installation

Use when `core.hooksPath` is unset (or default) and there's no tracked hook
dispatcher already.

```bash
ln -s ../../plugins-claude/git-span/hooks/git-hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
ln -s ../../plugins-claude/git-span/hooks/git-hooks/post-rewrite .git/hooks/post-rewrite
chmod +x .git/hooks/post-rewrite
```

### Chaining into existing hooks

If `post-commit`/`post-rewrite` already exist (version bumping, build steps,
doc validation), append the span hook line rather than overwriting:

```sh
#!/bin/sh
# Existing tooling
./scripts/bump-version.sh

# git-span post-commit trigger
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
COMMIT_SHA=$(git rev-parse HEAD)
nohup node "${SCRIPT_DIR}/../bin/dispatcher.mjs" \
  --repo-root "${REPO_ROOT}" --commit-sha "${COMMIT_SHA}" \
  < /dev/null > /dev/null 2>&1 &
exit 0
```

Tools that manage hook files through their own lifecycle (e.g. husky): call
the span hook from within the existing hook file rather than replacing it.

`post-rewrite` receives the old->new SHA mapping on stdin; git passes the same
stream to every script in a chain. Placing the span trigger first is best
practice so it's consumed before a downstream script transforms stdin, but
correctness never depends on it -- each script receives its own copy.

## How it works

1. The **Stop hook** (Claude Code session end) writes pre-commit anchor
   records to `<git-common-dir>/git-span/pre-commit/`.
2. **post-commit** spawns the dispatcher, which promotes pre-commit records
   whose anchored paths changed in the commit to `post-commit/` (stamped with
   commit SHA and branch).
3. On rewrite (rebase, amend), **post-rewrite** spawns the dispatcher with
   `--post-rewrite`, demoting post-commit records whose stamped SHA was
   rewritten back to `pre-commit/` for re-promotion.
4. If post-commit records are pending, the dispatcher spawns a single confined
   standalone agent. It claims records into its own claim directory, runs its
   own detection, reconciles stale spans, and lands each result via rebase +
   fast-forward merge onto the resolved branch. Anything left unresolved when
   the agent exits is swept back to `post-commit/` for a future run.

## Span files are tracked content

A span is an ordinary tracked plain-text file under `.span/<name>`. `git span
add`/`remove`/`why` write that file directly; persist edits the same way you
persist any source change: `git add .span && git commit`.

Spans follow normal git history -- a rebase or `git commit --amend` rewrites
the `.span/` file content along with everything else in the commit, and a
fresh clone gets spans via the same `git clone`/`git pull` that brings the
code. Span files are LF-pinned automatically: `.span/` carries a
`.gitattributes` enforcing `* text eol=lf`, so no `core.autocrlf`
configuration is needed.

The only other automation is the Claude Code span-overlap hook (PreToolUse) --
see `./understanding-hook-output.md`.

## Optional merge driver

This is the one piece of git *config* spans can use -- and it is **optional**.
Registering a merge driver makes git collapse the easy majority of `.span/`
conflicts in place during `git merge` so they never surface. Skipping it costs
nothing: `.span/**` falls back to git's line merge, and `git span stale --fix`
resolves the result afterward to the identical clean state (see SKILL.md's
`stale --fix` gotcha). Registration has two parts, because git distributes one
and not the other:

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

There is **no auto-installer** -- registration is manual by design, and
`git span doctor` does not check for it (verified: its output never mentions
hooks or merge-driver state, registered or not). Never run
`git span merge-driver` by hand; git invokes it with the temp-file arguments
shown above. Until a clone adds the `.git/config` block, conflicts simply fall
back to `--fix`.
