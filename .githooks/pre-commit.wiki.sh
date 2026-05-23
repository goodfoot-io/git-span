#!/bin/bash
# Single wiki concern, two phases:
#   1. Auto-fix drifted wiki links/anchors/frontmatter on the working tree and
#      re-stage the fixed .md files (non-blocking — --no-exit-code).
#   2. Create git mesh coverage for any uncovered fragment links and stage
#      exactly the meshes this run created/renamed (fail-closed).
#
# The whole corpus is checked (not just staged files): a staged edit can
# break a wikilink on an unstaged page or collide a title — phase 1 sees and
# repairs those cross-page failures.
set -e

command -v wiki >/dev/null 2>&1 || exit 0
WIKI_BIN=$(command -v wiki)

# ── Phase 1: auto-fix links/anchors/frontmatter, re-stage ────────────────────
# --fix requires --source=worktree (it can only rewrite worktree files);
# --no-exit-code keeps a fixable drift from aborting before the rewrite is
# staged below; --no-mesh defers coverage to the fail-closed phase 2.
"$WIKI_BIN" check --fix --no-exit-code --no-mesh --source=worktree

# mapfile + quoted array re-stages each path as one argument, so a page path
# containing whitespace survives intact.
mapfile -t WIKI_FIXED < <(git diff --name-only --diff-filter=d -- '*.md')
if [ ${#WIKI_FIXED[@]} -gt 0 ]; then
    git add "${WIKI_FIXED[@]}"
    echo "Re-staged wiki-fixed files:"
    printf '%s\n' "${WIKI_FIXED[@]}"
fi

# ── Phase 2: mesh coverage (fail-closed) ─────────────────────────────────────
# wiki scaffold self-discovers every uncovered fragment link, creates a mesh
# (anchors only), and is idempotent. --print-applied emits one repo-relative
# path per mesh created/renamed on stdout (advisories go to stderr); stage
# exactly those. A non-zero exit (git-mesh unavailable, or a genuine
# `git mesh add` failure) aborts the commit.
APPLIED=$("$WIKI_BIN" scaffold --print-applied) || {
    echo "wiki scaffold failed (fail-closed); aborting commit" >&2
    exit 1
}
if [ -n "$APPLIED" ]; then
    while IFS= read -r mesh_path; do
        [ -n "$mesh_path" ] && git add -- "$mesh_path"
    done <<< "$APPLIED"
    echo "Staged scaffolded meshes:"
    echo "$APPLIED"
fi
exit 0
