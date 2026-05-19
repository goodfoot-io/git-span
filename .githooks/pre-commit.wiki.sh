#!/bin/bash
# Wiki link + frontmatter validation with in-place auto-fix. Non-blocking by
# contract: --no-exit-code means a wiki problem never aborts the commit; this
# part only ever rewrites drifted links/anchors and re-stages them.
# --no-mesh defers mesh coverage scaffolding (post-commit's job).
set -e

command -v wiki >/dev/null 2>&1 || exit 0

# --fix requires --source=worktree.
wiki check --fix --no-exit-code --no-mesh --source=worktree

WIKI_FIXED=$(git diff --name-only --diff-filter=d -- '*.md')
if [ -n "$WIKI_FIXED" ]; then
    # shellcheck disable=SC2086
    git add $WIKI_FIXED
    echo "Re-staged wiki-fixed files:"
    echo "$WIKI_FIXED"
fi
exit 0
