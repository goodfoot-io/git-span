#!/usr/bin/env bash
set -euo pipefail
# Safely clean the shared `build/` subdirectory. Uses flock to serialize
# across worktrees so a concurrent `build:clean` or mid-build worktree
# doesn't race with rm -rf.
LOCKDIR="$HOME/.cache/git-mesh/locks"
mkdir -p "$LOCKDIR"
exec 9>"$LOCKDIR/build-clean.lock"
flock -x -w 60 9 || { echo "ERROR: Could not acquire build-clean lock (another build:clean or cargo build may be in progress)" >&2; exit 1; }
ROOT="${GIT_MESH_CARGO_TARGET_ROOT:-$HOME/.cache/git-mesh/cargo-target}"
rm -rf "$ROOT/build"
