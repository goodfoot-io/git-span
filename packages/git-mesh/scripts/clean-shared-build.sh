#!/usr/bin/env bash
set -euo pipefail
if [ -z "${HOME:-}" ]; then echo "ERROR: \$HOME is unset — refusing to operate on an empty path" >&2; exit 1; fi
# Safely clean the shared `build/` subdirectory. Uses flock to serialize
# across worktrees so two concurrent `build:clean` invocations don't race
# with each other's rm -rf. Note: the lock is released when this script
# exits; the subsequent cargo build in the build:clean chain runs unlocked.
LOCKDIR="$HOME/.cache/git-mesh/locks"
mkdir -p "$LOCKDIR"
exec 9>"$LOCKDIR/build-clean.lock"
flock -x -w 60 9 || { echo "ERROR: Could not acquire build-clean lock (another build:clean may be in progress in a different worktree)" >&2; exit 1; }
ROOT="${GIT_MESH_CARGO_TARGET_ROOT:-$HOME/.cache/git-mesh/cargo-target}"
rm -rf "$ROOT/build"
