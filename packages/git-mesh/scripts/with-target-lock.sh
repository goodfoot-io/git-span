#!/usr/bin/env bash
#
# with-target-lock.sh — reader/writer lock over the shared cargo target root.
#
# Every cargo task (build/check/clippy/nextest) runs under a *shared* lock;
# anything that deletes from the shared root (clean-shared-build.sh,
# cleanup-stale-target.sh) takes the *exclusive* lock. This closes the race
# where one worktree's `build:clean` rm -rf's artifacts out from under a
# sibling worktree's in-flight build, leaving fingerprints that claim
# freshness for rlibs that no longer exist (E0460/E0463 "can't find crate").
#
# Concurrent cargo tasks still run in parallel (shared locks coexist); cargo's
# own .cargo-lock continues to serialize builds within each task directory.
#
# Usage: with-target-lock.sh {shared|exclusive} <command> [args...]
set -euo pipefail

mode="${1:?usage: with-target-lock.sh shared|exclusive <command> [args...]}"
shift

if [ -z "${HOME:-}" ]; then
  echo "ERROR: \$HOME is unset — refusing to operate on an empty path" >&2
  exit 1
fi

ROOT="${GIT_MESH_CARGO_TARGET_ROOT:-$HOME/.cache/git-mesh/cargo-target}"
mkdir -p "$ROOT"
exec 9>"$ROOT/.target.lock"

case "$mode" in
  shared)    flock -s -w 1800 9 ;;
  exclusive) flock -x -w 1800 9 ;;
  *) echo "ERROR: unknown lock mode '$mode' (expected shared|exclusive)" >&2; exit 1 ;;
esac || {
  echo "ERROR: could not acquire $mode lock on $ROOT/.target.lock within 30 minutes" >&2
  exit 1
}

exec "$@"
