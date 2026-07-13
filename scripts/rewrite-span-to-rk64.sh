#!/usr/bin/env bash
# Rewrite every sha256: anchor in .span/ files to rk64: by re-adding each
# anchor via `git span add`.  The CLI now produces rk64-fingerprinted hashes,
# so re-adding recomputes the fingerprint and writes `rk64:<16-hex>`.
#
# Safe to run when `git span stale` reports 0 stale anchors (all content is
# fresh at recorded extents).  If stale anchors exist the re-add would
# fingerprint the *current* (drifted) content, which may not match the
# authored anchor.
#
# Usage:
#   ./scripts/rewrite-span-to-rk64.sh              # rewrite all spans
#   ./scripts/rewrite-span-to-rk64.sh span-root    # custom span root
#
# After the rewrite, `git diff` to review, then stage/commit as usual.

set -uo pipefail

SPAN_ROOT="${1:-.span}"

if [ ! -d "$SPAN_ROOT" ]; then
    echo "rewrite-span-to-rk64: span root '$SPAN_ROOT' not found" >&2
    exit 1
fi

# Count anchors to rewrite.
ANCHORS_BEFORE=$(grep -rc 'sha256:' "$SPAN_ROOT" | awk -F: '{s+=$NF} END {print s+0}')
if [ "$ANCHORS_BEFORE" -eq 0 ]; then
    echo "rewrite-span-to-rk64: no sha256: anchors found under '$SPAN_ROOT'; nothing to do"
    exit 0
fi
echo "rewrite-span-to-rk64: $ANCHORS_BEFORE sha256: anchor(s) to rewrite"

COUNT=0
ERRORS=0
while IFS= read -r -d '' span_file; do
    # Span name is the repo-relative path under the span root.
    SPAN_NAME="${span_file#"$SPAN_ROOT/"}"
    while IFS= read -r line; do
        # The anchor address is everything before the last space (the hash
        # token occupies the last space-delimited field).  Strip CR.
        line="${line%$'\r'}"
        ADDR="${line% *}"
        [ -z "$ADDR" ] && continue
        echo "  [$SPAN_NAME] $ADDR"
        if git span add "$SPAN_NAME" "$ADDR" 2>&1; then
            COUNT=$((COUNT + 1))
        else
            echo "    ERROR: rewrite failed; leaving anchor as-is" >&2
            ERRORS=$((ERRORS + 1))
        fi
    done < <(grep 'sha256:' "$span_file")
done < <(find "$SPAN_ROOT" -type f -print0)

REMAINING=$(grep -rc 'sha256:' "$SPAN_ROOT" | awk -F: '{s+=$NF} END {print s+0}')
echo "rewrite-span-to-rk64: $COUNT anchor(s) rewritten; $REMAINING sha256: anchor(s) remaining"
if [ "$ERRORS" -ne 0 ]; then
    echo "rewrite-span-to-rk64: $ERRORS error(s) during rewrite" >&2
fi
if [ "$REMAINING" -ne 0 ]; then
    echo "rewrite-span-to-rk64: WARNING — some sha256: anchors were not rewritten" >&2
fi
