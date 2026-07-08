#!/usr/bin/env bash
# Repro variants: when does an uncommitted worktree change block --fix for MOVED?
#
# Variant A (lines 51-120): uncommitted edit on a line OUTSIDE the anchored range.
#   Expected: --fix succeeds (the file is dirty but the anchored bytes match).
#
# Variant B (lines 126-end): uncommitted edit that shifts lines, so the anchored
#   bytes are at a different worktree position than HEAD expects.
#   Expected: --fix does nothing (the resolver cannot confidently re-anchor).

set -eu

run_repro() {
  local LABEL="$1"
  local EXTRA_SETUP="$2"

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  echo ""
  echo "===== $LABEL ====="
  echo "Working in: $TMPDIR"
  echo ""

  cd "$TMPDIR"
  git init --quiet
  git config user.email "test@example.com"
  git config user.name "Test"

  mkdir -p src

  cat > src/config.ts <<'EOF'
// config.ts — application configuration

/** Default port the server listens on. */
export const DEFAULT_PORT = 3000;

/** Log level: debug, info, warn, error. */
export const LOG_LEVEL = "info";

/** Maximum request body size in bytes. */
export const MAX_BODY_SIZE = 1_048_576;

/** Whether to enable CORS. */
export const CORS_ENABLED = true;

/** Session timeout in seconds. */
export const SESSION_TIMEOUT = 3600;
EOF

  git add src/config.ts && git commit -m "Initial config module" --quiet
  git mesh add config/runtime-constants 'src/config.ts#L7-L10' 2>/dev/null
  git add .mesh && git commit -m "Mesh config/runtime-constants" --quiet

  # Insert lines ABOVE the anchored range (committed) — MOVED at HEAD
  cat > src/config.ts <<'EOF'
// config.ts — application configuration

import { resolve } from "node:path";

/** Root directory for file resolution. */
export const ROOT_DIR = resolve(process.cwd());

/** Default port the server listens on. */
export const DEFAULT_PORT = 3000;

/** Log level: debug, info, warn, error. */
export const LOG_LEVEL = "info";

/** Maximum request body size in bytes. */
export const MAX_BODY_SIZE = 1_048_576;

/** Whether to enable CORS. */
export const CORS_ENABLED = true;

/** Session timeout in seconds. */
export const SESSION_TIMEOUT = 3600;
EOF

  git add src/config.ts && git commit -m "Add ROOT_DIR import above config block" --quiet

  # Run the variant-specific uncommitted edit
  eval "$EXTRA_SETUP"

  echo "--- Uncommitted change ---"
  git diff -- src/config.ts
  echo ""

  echo "--- Stale before --fix ---"
  set +e; STALE_OUT=$(git mesh stale config/runtime-constants 2>&1); STALE_EXIT=$?; set -e
  echo "$STALE_OUT"
  echo "Exit: $STALE_EXIT"
  echo ""

  BEFORE=$(cat .mesh/config/runtime-constants)

  echo "--- Running --fix ---"
  set +e; FIX_OUT=$(git mesh stale --fix config/runtime-constants 2>&1); FIX_EXIT=$?; set -e
  echo "$FIX_OUT"
  echo "Exit after --fix: $FIX_EXIT"
  echo ""

  AFTER=$(cat .mesh/config/runtime-constants)

  if [ "$BEFORE" != "$AFTER" ]; then
    echo ">>> --fix MODIFIED the mesh file:"
    echo "    before: $BEFORE"
    echo "    after:  $AFTER"
  else
    echo ">>> --fix did NOT modify the mesh file"
  fi

  echo ""
  echo "--- Stale after --fix ---"
  set +e; STALE_OUT=$(git mesh stale config/runtime-constants 2>&1); STALE_EXIT=$?; set -e
  echo "$STALE_OUT"
  echo "Exit: $STALE_EXIT"

  if [ "$STALE_EXIT" -eq 0 ]; then
    echo ">>> Mesh is CLEAN (--fix succeeded)"
  else
    echo ">>> Mesh is STILL STALE (--fix was blocked)"
  fi
}

# ---------------------------------------------------------------------------
# Variant A: uncommitted edit on a line OUTSIDE the anchored range.
# The anchored bytes are untouched; only SESSION_TIMEOUT's comment changes.
# ---------------------------------------------------------------------------
run_repro "Variant A: unrelated uncommitted edit" '
cat > src/config.ts <<EOF
// config.ts — application configuration

import { resolve } from "node:path";

/** Root directory for file resolution. */
export const ROOT_DIR = resolve(process.cwd());

/** Default port the server listens on. */
export const DEFAULT_PORT = 3000;

/** Log level: debug, info, warn, error. */
export const LOG_LEVEL = "info";

/** Maximum request body size in bytes. */
export const MAX_BODY_SIZE = 1_048_576;

/** Whether to enable CORS. */
export const CORS_ENABLED = true;

/** Session timeout in seconds (1 hour). */
export const SESSION_TIMEOUT = 3600;
EOF
'

# ---------------------------------------------------------------------------
# Variant B: uncommitted edit that SHIFTS lines above the anchored range,
# so the anchored content is at a different worktree position than HEAD expects.
# ---------------------------------------------------------------------------
run_repro "Variant B: uncommitted line insertion ABOVE anchored range" '
cat > src/config.ts <<EOF
// config.ts — application configuration

/** Copyright 2026 Example Corp.  All rights reserved. */

import { resolve } from "node:path";

/** Root directory for file resolution. */
export const ROOT_DIR = resolve(process.cwd());

/** Default port the server listens on. */
export const DEFAULT_PORT = 3000;

/** Log level: debug, info, warn, error. */
export const LOG_LEVEL = "info";

/** Maximum request body size in bytes. */
export const MAX_BODY_SIZE = 1_048_576;

/** Whether to enable CORS. */
export const CORS_ENABLED = true;

/** Session timeout in seconds. */
export const SESSION_TIMEOUT = 3600;
EOF
'
