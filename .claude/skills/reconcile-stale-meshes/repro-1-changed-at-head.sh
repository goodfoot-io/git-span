#!/usr/bin/env bash
# Repro: `git mesh stale --fix` silently does nothing for CHANGED at HEAD anchors.
#
# The help text says --fix re-anchors "Moved and Changed" anchors, but it only
# handles MOVED.  CHANGED at HEAD anchors pass through untouched — mesh file
# unchanged, same finding.

set -eu

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "=== Repro 1: --fix skips CHANGED at HEAD ==="
echo "Working in: $TMPDIR"
echo ""

cd "$TMPDIR"
git init --quiet
git config user.email "test@example.com"
git config user.name "Test"

# ---------------------------------------------------------------------------
# Setup: create a file, commit, mesh an anchor, change the anchored bytes, commit
# ---------------------------------------------------------------------------
mkdir -p src
cat > src/auth.ts <<'EOF'
// auth.ts — authentication helpers

export function signToken(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encoded = btoa(JSON.stringify(header)) + "." + btoa(JSON.stringify(payload));
  // v1: no signature
  return encoded;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}
EOF

git add src/auth.ts && git commit -m "Initial auth module" --quiet

# Create a mesh pinning the signToken function
git mesh add auth/token-signing 'src/auth.ts#L3-L8' 2>/dev/null
git add .mesh && git commit -m "Mesh auth/token-signing" --quiet

echo "--- Before drift ---"
set +e; STALE_OUT=$(git mesh stale auth/token-signing 2>&1); STALE_EXIT=$?; set -e
echo "$STALE_OUT"
echo "Exit: $STALE_EXIT  (expect 0 — FRESH)"
echo ""

# Change the anchored bytes: add a signature step, same line numbers
cat > src/auth.ts <<'EOF'
// auth.ts — authentication helpers

export function signToken(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encoded = btoa(JSON.stringify(header)) + "." + btoa(JSON.stringify(payload));
  // v2: HMAC signature added
  const secret = Deno.env.get("JWT_SECRET") ?? "default-secret";
  const sig = btoa(secret);
  return encoded + "." + sig;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}
EOF

git add src/auth.ts && git commit -m "Add HMAC signing" --quiet

# ---------------------------------------------------------------------------
# Test: stale detects CHANGED at HEAD
# ---------------------------------------------------------------------------
echo "--- After committing changed bytes ---"
set +e; STALE_OUT=$(git mesh stale auth/token-signing 2>&1); STALE_EXIT=$?; set -e
echo "$STALE_OUT"
echo "Exit: $STALE_EXIT  (expect non-zero — drift found)"
echo ""

# Record the mesh file content before --fix
BEFORE=$(cat .mesh/auth/token-signing)
echo "Mesh file before --fix:"
echo "$BEFORE"
echo ""

# ---------------------------------------------------------------------------
# Test: --fix should handle CHANGED (per help text) but does nothing
# ---------------------------------------------------------------------------
echo "--- Running --fix ---"
set +e; FIX_OUT=$(git mesh stale --fix auth/token-signing 2>&1); FIX_EXIT=$?; set -e
echo "$FIX_OUT"
echo "Exit after --fix: $FIX_EXIT"
echo ""

AFTER=$(cat .mesh/auth/token-signing)
echo "Mesh file after --fix:"
echo "$AFTER"
echo ""

if [ "$BEFORE" = "$AFTER" ]; then
  echo ">>> CONFIRMED: --fix did NOT modify the mesh file for CHANGED at HEAD"
else
  echo "!!! UNEXPECTED: --fix modified the mesh file"
fi

echo ""
echo "--- After --fix, stale still reports ---"
set +e; STALE_OUT=$(git mesh stale auth/token-signing 2>&1); STALE_EXIT=$?; set -e
echo "$STALE_OUT"
echo "Exit: $STALE_EXIT  (expect non-zero — CHANGED not fixed)"

case "$STALE_OUT" in
  *changed*)
    echo ">>> CONFIRMED: CHANGED at HEAD persists after --fix (--fix did nothing)"
    ;;
  *)
    if [ "$STALE_EXIT" -eq 0 ] && [ -z "$STALE_OUT" ]; then
      echo "!!! UNEXPECTED: stale is clean after --fix (--fix worked for CHANGED at HEAD)"
    else
      echo "!!! UNEXPECTED: unexpected output"
    fi
    ;;
esac
