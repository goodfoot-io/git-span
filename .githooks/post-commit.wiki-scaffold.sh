#!/bin/bash
# Scaffold git-mesh coverage for fragment links the just-landed commit
# introduced. Advisory only: pre-commit already auto-repaired fixable link
# drift, so what reaches here is mesh-coverage gaps (expected for new pages).
# Prints `git mesh add` / `git mesh why` commands for the committer to
# review, consolidate, and commit separately — never executed automatically.
set -e

command -v wiki >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# --no-exit-code: never fail; --format json so jq can filter diagnostics.
WIKI_JSON=$(wiki check --format json --no-exit-code 2>&1) || true
[ -n "$WIKI_JSON" ] || exit 0

# One path per line into a quoted array: a page path containing whitespace
# reaches scaffold intact instead of being word-split.
mapfile -t MESH_FILES < <(echo "$WIKI_JSON" \
    | jq -r '[.errors[] | select(.kind == "mesh_uncovered") | .file] | unique | .[]' \
    2>/dev/null || true)
if [ ${#MESH_FILES[@]} -gt 0 ]; then
    wiki scaffold "${MESH_FILES[@]}"
fi
exit 0
