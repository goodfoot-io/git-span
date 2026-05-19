#!/bin/bash
# Wiki link + frontmatter validation with in-place auto-fix. Non-blocking by
# contract: --no-exit-code means a wiki problem never aborts the commit; this
# part only ever rewrites drifted links/anchors and re-stages them.
# --no-mesh defers mesh coverage scaffolding to post-commit.
#
# The whole corpus is checked (not just staged files): a staged edit can
# break a wikilink on an unstaged page or collide a title — --fix repairs
# those cross-page failures too.
set -e

command -v wiki >/dev/null 2>&1 || exit 0

# --fix requires --source=worktree (it can only rewrite worktree files).
wiki check --fix --no-exit-code --no-mesh --source=worktree

# mapfile + quoted array re-stages each path as one argument, so a page
# path containing whitespace survives intact.
mapfile -t WIKI_FIXED < <(git diff --name-only --diff-filter=d -- '*.md')
if [ ${#WIKI_FIXED[@]} -gt 0 ]; then
    git add "${WIKI_FIXED[@]}"
    echo "Re-staged wiki-fixed files:"
    printf '%s\n' "${WIKI_FIXED[@]}"
fi
exit 0
