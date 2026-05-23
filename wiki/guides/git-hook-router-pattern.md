---
title: Git Hook Router Pattern
summary: How to set up repo-tracked git hooks as thin per-event dispatchers that run an ordered list of single-concern sub-scripts, and how to replicate the pattern in another repository.
aliases: [Git Hook Dispatcher, Githooks Setup, Hook Router]
tags: [guide, git, hooks]
keywords: [githooks, core.hooksPath, pre-commit, post-commit, dispatcher, fail-closed, advisory]
---

This guide describes the **router (dispatcher) model** used for git hooks in this
repository and how to set the same system up in a different repo. The goal is to
replace monolithic, hard-to-reason-about hooks: each git event gets one thin
dispatcher that runs an explicit, ordered list of single-concern sub-scripts.
Adding, removing, or reordering a behavior is editing one list and dropping in one
file — never untangling a 300-line hook.

## Core principles

1. **One dispatcher per git event** (`pre-commit`, `post-commit`, `pre-push`,
   `post-rewrite`, …). The dispatcher contains no business logic — only the ordered
   list of sub-scripts and the run loop.
2. **One concern per sub-script**, named `<event>.<concern>.sh` (e.g.
   `pre-commit.lint.sh`, `pre-commit.secrets.sh`).
3. **Fail-closed vs. advisory, never mixed**:
   - **Fail-closed** (`pre-*` events): a non-zero exit from any sub-script aborts
     the git action.
   - **Advisory** (`post-*` events): sub-script failures are reported but never
     abort.
4. **Re-stage before gating**: any auto-fixing sub-script must `git add` its fixes
   *before* deciding to exit non-zero, so `set -e` can't discard the fixes.
5. **Graceful degradation**: a sub-script no-ops silently if its tool is absent
   (`command -v <tool> >/dev/null 2>&1 || exit 0`).
6. **Independent executability**: every sub-script is independently runnable and
   `bash -n`-clean.

## Layout and wiring

Use a **repo-tracked** `.githooks/` directory plus `core.hooksPath` — never the
untracked `.git/hooks/`. Hooks must travel with the repo and be reviewable.

```
.githooks/
  pre-commit                 # dispatcher (fail-closed)
  pre-commit.<concern>.sh
  post-commit                # dispatcher (advisory)
  post-commit.<concern>.sh
  post-rewrite               # dispatcher (advisory, stdin passthrough)
  post-rewrite.<concern>.sh
  README.md                  # architecture + sub-script table
```

```bash
git config core.hooksPath .githooks
```

Because the config is a one-line repo setting and the scripts are tracked, setup is
idempotent and travels on a fresh clone — there is no installer to run and no hidden
`.git/hooks/` state.

## Dispatcher templates

The fail-closed dispatcher uses `set -e` and calls each sub-script directly, so any
non-zero exit aborts the commit. This repository's [pre-commit](../../.githooks/pre-commit#L1-L19)
dispatcher is a working example.

```bash
#!/bin/bash
set -e
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PARTS=(
    pre-commit.first.sh
    pre-commit.second.sh
)
for part in "${PARTS[@]}"; do
    script="$HOOK_DIR/$part"
    [ -x "$script" ] || continue
    "$script"
done
exit 0
```

The advisory dispatcher omits `set -e` and swallows each sub-script's failure with a
notice, since a `post-*` event cannot un-commit.

```bash
#!/bin/bash
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PARTS=(
    post-commit.first.sh
    post-commit.second.sh
)
for part in "${PARTS[@]}"; do
    script="$HOOK_DIR/$part"
    [ -x "$script" ] || continue
    "$script" || echo "post-commit: $part exited non-zero (ignored)"
done
exit 0
```

For events that receive stdin or args (`post-rewrite`), capture stdin once and pipe
it to each sub-script:

```bash
#!/bin/bash
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
STDIN_DATA=$(cat)
PARTS=( post-rewrite.first.sh )
for part in "${PARTS[@]}"; do
    script="$HOOK_DIR/$part"
    [ -x "$script" ] || continue
    echo "$STDIN_DATA" | "$script" "$@" || echo "post-rewrite: $part exited non-zero (ignored)"
done
exit 0
```

## Sub-script template

```bash
#!/bin/bash
# <one line: what this concern does and whether it can block>
set -e

command -v <tool> >/dev/null 2>&1 || exit 0   # graceful no-op if absent

# ... do the work ...

# If it auto-fixes: stage fixes BEFORE any gate (principle 4)
CHANGED=$(git diff --name-only --diff-filter=d -- '<glob>')
if [ -n "$CHANGED" ]; then
    # shellcheck disable=SC2086
    git add $CHANGED
    echo "Re-staged <tool>-fixed files:"; echo "$CHANGED"
fi

# Only now decide to block (fail-closed events only):
if [ "$STATUS" -ne 0 ]; then
    echo "Commit blocked: <tool> reported issues it cannot autofix."
    exit 1
fi
exit 0
```

## Procedure for a new repository

1. Survey existing hooks and inventory each concern.
2. Classify each concern's event as fail-closed or advisory.
3. Decompose into one sub-script per concern, named `<event>.<concern>.sh`.
4. Write the dispatchers from the templates above.
5. Write/trim `.githooks/README.md` (architecture + a table of sub-scripts).
6. `chmod +x` every dispatcher and sub-script.
7. Wire it up: `git config core.hooksPath .githooks`.
8. Verify thoroughly (see below).
9. Commit on its own, isolated, with `git commit --no-verify` so auto-fixing
   sub-scripts don't sweep unrelated changes into the hooks commit.

When reusing this in a new repo, swap in that repo's actual concerns (its linter,
formatter, secret scanner, etc.) in steps 1–3 and in the `PARTS=(...)` lists.

## Verification checklist

- `git config core.hooksPath` → `.githooks`
- `bash -n` clean for every dispatcher and sub-script
- `git ls-files --stage -- .githooks/` shows `100755` for every script
- Dry-run the dispatcher; confirm sub-scripts spawn as children
- Fail-closed: a sub-script `exit 1` aborts the action, and auto-fixes survive
- Advisory: a failing `post-*` prints a notice but the commit stands

## Pitfalls to avoid

- `set -e` + a bare tool call → the whole hook dies on first non-zero, skipping
  re-stage.
- An auto-fixer that doesn't re-stage → fixes land in the working tree but not the
  commit.
- An advisory hook that exits non-zero → blocks nothing real but pollutes output.
- Untracked `.git/hooks/` → edits don't travel or get reviewed.
- Mixed classification → a "mostly advisory" `post-commit` that sometimes `exit 1`s.
