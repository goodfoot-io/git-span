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

Reference shell scripts are provided at:

- `plugins-claude/git-span/hooks/git-hooks/post-commit`
- `plugins-claude/git-span/hooks/git-hooks/post-rewrite`

Each script resolves the dispatcher relative to its own location on disk via
`$0`, so it works regardless of where the plugin is installed. **Symlink
installation is required** -- if you copy the script, `$0` resolves to
`.git/hooks/` and the dispatcher won't be found.

The scripts are POSIX `sh` (no bashisms) and safe to use as-is or as a template
for custom hook configurations.

## Installation

Git hooks are **per-clone** configuration by default (`.git/hooks/`, never
tracked by git). There is no auto-installer -- hook installation is manual by
design, matching the same pattern used for the optional merge driver (see
below).

**Check `core.hooksPath` before installing.** A repo may redirect hooks to a
tracked directory:

```bash
git config core.hooksPath   # empty/unset -> .git/hooks/ is authoritative
                             # a path (e.g. `.githooks`) -> that tracked dir is authoritative instead
```

If `core.hooksPath` is set, symlinking into `.git/hooks/` is a silent no-op --
git never reads that directory in this clone. Some repos additionally use a
tracked **dispatcher model** in their hooks directory (a thin `<event>`
script holding an ordered `PARTS` list of single-concern `<event>.<concern>.sh`
files, rather than one script per event). Where that pattern is already in
use, add git-span as its own concern script and register it in `PARTS`
instead of replacing the event file:

```bash
# e.g. .githooks/post-commit.git-span.sh -- resolve the dispatcher from the
# repo root (git rev-parse --show-toplevel) rather than $0, since concern
# scripts are tracked files, not symlinks, and $0 already points at their
# real location in the repo
REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
DISPATCHER="${REPO_ROOT}/plugins-claude/git-span/hooks/bin/dispatcher.mjs"
```

`post-commit`/`post-rewrite` are **advisory** events (they fire after the
action already landed), so a dispatcher wiring them must never let a
sub-script failure abort -- log/report and continue, matching whatever
convention the repo's dispatcher already uses for advisory vs. fail-closed
sub-scripts.

### Direct symlink installation (no existing hook dispatcher)

Use this approach only when `core.hooksPath` is unset (or points at the
default `.git/hooks/`) and the repo has no tracked hook dispatcher already.

### post-commit

Symlink the reference script into your repository's hooks directory. The script
finds `dispatcher.mjs` relative to its real location on disk -- copying instead
of symlinking breaks this resolution.

```bash
ln -s ../../plugins-claude/git-span/hooks/git-hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

### post-rewrite

```bash
ln -s ../../plugins-claude/git-span/hooks/git-hooks/post-rewrite .git/hooks/post-rewrite
chmod +x .git/hooks/post-rewrite
```

### Chaining into existing hooks

If your repository already has `post-commit` or `post-rewrite` hooks (for
version bumping, build steps, doc validation, or other tooling), append the
span hook line rather than overwriting:

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

Some tools (e.g., husky) manage hook files through their own lifecycle. In
those cases, call the span hook from within the existing hook file rather
than replacing the managed file.

### stdin ordering for post-rewrite

The `post-rewrite` hook receives the old->new SHA mapping on stdin. Git passes
the same input to every script listed in the hook file. For best results, place
the span post-rewrite trigger **first** in the chain so the SHA mapping is
consumed before any downstream script that might transform stdin.

Correctness never depends on ordering, however. Each hook script in a chain
receives its own copy of the stdin stream, so the span trigger works correctly
at any position.

## How it works

1. The **Stop hook** (Claude Code session end) writes pre-commit anchor
   records to `<git-common-dir>/git-span/pre-commit/`.

2. The **post-commit hook** spawns the dispatcher. The dispatcher promotes
   any pre-commit records whose anchored paths changed in the commit to
   `post-commit/` (stamped with the commit SHA and branch).

3. If a rewrite occurs (rebase, amend), the **post-rewrite hook** spawns the
   dispatcher with `--post-rewrite`. It demotes post-commit records whose
   stamped SHA was rewritten back to `pre-commit/` for re-promotion.

4. If any post-commit records are pending, the dispatcher spawns a single
   confined standalone agent. The agent claims records from `post-commit/`
   into its own claim directory, runs its own detection, reconciles stale
   spans, and lands each result itself via rebase + fast-forward merge onto
   the resolved branch. Anything left unresolved when the agent exits is
   swept back to `post-commit/` by the dispatcher for a future run.

## Span files are tracked content

A span is an ordinary tracked plain-text file under `.span/<name>`. `git span
add` / `remove` / `why` write that file directly, and you persist edits the
same way you persist any source change:

```bash
git add .span && git commit
```

Spans follow normal git history: a rebase or `git commit --amend` rewrites
the `.span/` file content along with everything else in the commit, and a
fresh clone gets the spans via the same `git clone`/`git pull` that brings
the code.

Span files are LF-pinned on all platforms automatically -- no `core.autocrlf`
configuration is needed. The `.span/` directory contains a `.gitattributes`
that enforces `* text eol=lf`, so Windows and Unix checkouts produce identical
span content without any developer action.

The only other automation is the Claude Code span-overlap hook (PreToolUse),
which surfaces intersecting span anchors inline -- see `./understanding-hook-output.md`.

## Optional merge driver

This is the one piece of git *config* spans can use -- and it is **optional**,
not required. Registering a merge driver makes git collapse the easy majority
of `.span/` conflicts in place during `git merge` so they never surface.
Skipping it costs nothing: `.span/**` falls back to git's line merge, and
`git span stale --fix` resolves the result afterward to the identical clean
state (see `./command-reference.md` section "Merge conflict resolution").
Registration has two parts, because git distributes one and not the other:

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
`git span doctor` does not check for it. Never run `git span merge-driver` by
hand; git invokes it with the temp-file arguments shown above. Until a clone
adds the `.git/config` block, conflicts simply fall back to `--fix`.
