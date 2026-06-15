#!/bin/bash
# Single wiki concern, two phases, reconciled with the installed `wiki` CLI:
#   1. Auto-fix drifted links/anchors/frontmatter AND create git mesh coverage
#      for uncovered fragment links on the working tree, then re-stage the fixed
#      .md files THAT ARE ALREADY PART OF THIS COMMIT and exactly the meshes this
#      run created/extended.
#   2. Re-run `wiki check` (no --fix) as a fail-closed gate: any residual
#      validation error or uncovered fragment link aborts the commit.
#
# In this CLI version mesh coverage is folded into `check`: `check --fix`
# performs the link/anchor/frontmatter rewrite and the mesh-coverage pass in
# a single invocation, and `--print-applied` reports the meshes it touched.
# There is no separate `scaffold` subcommand and no `--no-mesh` flag.
#
# The whole corpus is checked (not just staged files): a staged edit can
# break a wikilink on an unstaged page or collide a title — phase 1 sees and
# repairs those cross-page failures in the worktree. Such repairs to pages that
# are not already part of this commit are left for their owner to stage; the
# commit never silently absorbs an unstaged page (see the re-staging note below).
set -e

command -v wiki >/dev/null 2>&1 || exit 0
WIKI_BIN=$(command -v wiki)

# ── Phase 1: auto-fix links/anchors/frontmatter + mesh coverage, re-stage ────
# --fix requires --source=worktree (it can only rewrite worktree files) and
# also creates mesh coverage for uncovered fragment links. --print-applied
# emits one repo-relative path per mesh created/extended on stdout (the
# fix/skip summary, advisories, and diagnostics go to stderr) so we can stage
# exactly what this run touched. A hard error here aborts the commit.
APPLIED=$("$WIKI_BIN" check --fix --print-applied --source=worktree) || {
    echo "wiki check --fix failed (fail-closed); aborting commit" >&2
    exit 1
}

# Re-stage ONLY .md files already part of this commit (staged vs HEAD) that the
# fix pass left dirty in the worktree. Scoping to the staged set is deliberate
# and load-bearing: `git diff --name-only -- '*.md'` lists EVERY worktree-modified
# .md, so an unscoped `git add` sweeps in unstaged .md that was never part of this
# commit — a sibling agent's in-flight work in a shared worktree, or a doc edit
# the committer never staged. We re-add a file only when it is both already staged
# for this commit AND left modified by the fix. mapfile + quoted array re-stages
# each path as one argument, so a page path containing whitespace survives intact.
mapfile -t STAGED_MD < <(git diff --cached --name-only --diff-filter=d -- '*.md')
WIKI_FIXED=()
for f in "${STAGED_MD[@]}"; do
    git diff --quiet -- "$f" || WIKI_FIXED+=("$f")
done
if [ ${#WIKI_FIXED[@]} -gt 0 ]; then
    git add "${WIKI_FIXED[@]}"
    echo "Re-staged wiki-fixed files (scoped to this commit's staged .md):"
    printf '%s\n' "${WIKI_FIXED[@]}"
fi

# Stage exactly the meshes the fix pass created or extended.
if [ -n "$APPLIED" ]; then
    while IFS= read -r mesh_path; do
        [ -n "$mesh_path" ] && git add -- "$mesh_path"
    done <<< "$APPLIED"
    echo "Staged wiki-applied meshes:"
    echo "$APPLIED"
fi

# ── Phase 2: fail-closed validation gate ─────────────────────────────────────
# Re-run check without --fix: any residual validation error or uncovered
# fragment link (one the fix pass could not repair) exits non-zero and aborts
# the commit.
"$WIKI_BIN" check || {
    echo "wiki check found unresolved validation errors (fail-closed); aborting commit" >&2
    exit 1
}
exit 0
