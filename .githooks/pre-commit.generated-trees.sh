#!/bin/bash
# The plugins-*/git-span/skills trees are generated build output of
# skills-src/ (rendered by scripts/build-agent-skills.mjs). A commit that
# touches a rendered tree without touching any of the build's inputs is
# almost always a hand-edit, and the next rebuild will silently replace it.
# Fail closed with a pointer at the templates; a deliberate output-only
# commit (rare: e.g. splitting a rebuild from its template change) can use
# --no-verify.
set -e

STAGED_FILES=$(git diff --cached --name-only)
[ -z "$STAGED_FILES" ] && exit 0

RENDERED_STAGED=$(echo "$STAGED_FILES" | grep -E '^plugins-(claude|codex|opencode|antigravity)/[^/]+/skills/' || true)
[ -z "$RENDERED_STAGED" ] && exit 0

# The inputs whose change legitimately reworks the rendered trees: the
# templates, the registry, the drivers, and a toolchain bump of
# @goodfoot/agent-skills itself.
INPUTS_STAGED=$(echo "$STAGED_FILES" | grep -E '^(skills-src/|scripts/agent-skills-plugins\.json|scripts/agent-skills-registry\.mjs|scripts/build-agent-skills\.mjs|package\.json|yarn\.lock)' || true)
[ -n "$INPUTS_STAGED" ] && exit 0

echo "ERROR: this commit stages changes under a rendered plugins-*/skills tree without staging" >&2
echo "any of its inputs (skills-src/, the registry, or the build driver). These trees are" >&2
echo "GENERATED — a hand-edit here is destroyed by the next rebuild. Edit the template under" >&2
echo "skills-src/ instead, run 'node scripts/build-agent-skills.mjs', and commit both together" >&2
echo "(see skills-src/README.md). Staged rendered files:" >&2
echo "$RENDERED_STAGED" | sed 's/^/  /' >&2
exit 1
