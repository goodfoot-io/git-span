#!/bin/bash
# Run Biome's autofixer on staged TS/JS, then gate on what it could not fix.
# Fail-closed: unfixable Biome errors abort the commit. The fixes Biome DID
# apply are re-staged BEFORE the gate, so a block never discards them
# (principle 4).
set -e

command -v yarn >/dev/null 2>&1 || exit 0

STAGED_FILES=$(git diff --cached --name-only --diff-filter=d)
BIOME_STAGED=$(echo "$STAGED_FILES" | grep -E '\.(ts|tsx|js|jsx)$' || true)
[ -z "$BIOME_STAGED" ] && exit 0

echo "Running biome check --fix on staged files..."
# Capture status without set -e aborting before the re-stage below.
set +e
yarn biome check --fix --staged --no-errors-on-unmatched
STATUS=$?
set -e

BIOME_CHANGED=""
for f in $BIOME_STAGED; do
    if ! git diff --quiet -- "$f" 2>/dev/null; then
        BIOME_CHANGED="$BIOME_CHANGED $f"
    fi
done

if [ -n "$BIOME_CHANGED" ]; then
    # shellcheck disable=SC2086
    git add $BIOME_CHANGED
    echo "Re-staged biome-fixed files:$BIOME_CHANGED"
fi

if [ "$STATUS" -ne 0 ]; then
    echo ""
    echo "Commit blocked: biome reported issues it cannot autofix."
    exit 1
fi
exit 0
