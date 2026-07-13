#!/bin/bash
# Single wiki concern, single invocation:
#   wiki check --fix creates/renames git spans for uncovered fragment links and
#   auto-fixes drifted wiki links/anchors/frontmatter in the working tree.
# --no-exit-code makes this best-effort: the hook never aborts a commit.
# --print-applied routes created/renamed span paths to stdout; everything else
# goes to stderr (shown on the terminal).
set -e

command -v wiki >/dev/null 2>&1 || exit 0
WIKI_BIN=$(command -v wiki)

# ── Single-pass: auto-fix + span coverage, re-stage all touched paths ─────────
# --fix rewrites in place (requires --source=worktree); --print-applied prints
# created/renamed span paths to stdout; --no-exit-code = advisory (best-effort).
#
# wiki check --fix has no flag that reports which .md files it rewrote (only
# --print-applied's span paths are machine-readable). So we snapshot the
# content hash of every tracked .md file before running --fix, and after it
# runs, re-stage only the ones whose hash actually changed. A plain
# `git diff --name-only -- '*.md'` post-hoc would sweep in unrelated .md
# edits already dirty in the worktree for reasons that have nothing to do
# with this --fix run — this snapshot/compare avoids that.
BEFORE_HASHES=$(mktemp)
trap 'rm -f "$BEFORE_HASHES"' EXIT
git ls-files -z -- '*.md' | while IFS= read -r -d '' f; do
    printf '%s %s\n' "$(git hash-object "$f")" "$f"
done > "$BEFORE_HASHES"

APPLIED=$("$WIKI_BIN" check --fix --print-applied --no-exit-code --source=worktree)

WIKI_FIXED=()
while IFS=' ' read -r before_hash f; do
    [ -n "$f" ] || continue
    [ -f "$f" ] || continue
    after_hash=$(git hash-object "$f")
    [ "$after_hash" != "$before_hash" ] && WIKI_FIXED+=("$f")
done < "$BEFORE_HASHES"
rm -f "$BEFORE_HASHES"
trap - EXIT

if [ ${#WIKI_FIXED[@]} -gt 0 ]; then
    git add "${WIKI_FIXED[@]}"
    echo "Re-staged wiki-fixed files:"
    printf '%s\n' "${WIKI_FIXED[@]}"
fi

if [ -n "$APPLIED" ]; then
    while IFS= read -r span_path; do
        [ -n "$span_path" ] && git add -- "$span_path"
    done <<< "$APPLIED"
    echo "Staged scaffolded spans:"
    echo "$APPLIED"
fi
exit 0
