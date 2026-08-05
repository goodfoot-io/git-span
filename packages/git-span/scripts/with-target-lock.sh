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

ROOT="${GIT_SPAN_CARGO_TARGET_ROOT:-$HOME/.cache/git-span/cargo-target}"
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

# Fingerprint tripwire: tee the wrapped run's stderr into a temp file and
# persist it when the run is slow, so a cold rebuild's cargo fingerprint log
# (CARGO_LOG=cargo::core::compiler::fingerprint=info names the stale input
# directly — e.g. "stale: changed ...") survives as evidence. The
# worktree-divergent [target.*].linker config hash makes a cross-worktree cold
# run ~80-265s; warm runs stay ~1s and leave no trace, so the shared check
# cache is not littered. GIT_SPAN_FINGERPRINT_TRIPWIRE=0 restores the plain
# pass-through (byte-identical, for CI/release flows); GIT_SPAN_FINGERPRINT_THRESHOLD
# tunes persistence (elapsed seconds, default 15).
if [ "${GIT_SPAN_FINGERPRINT_TRIPWIRE:-1}" = "0" ]; then
  exec "$@"
fi

threshold="${GIT_SPAN_FINGERPRINT_THRESHOLD:-15}"
tmp_log="$(mktemp "$ROOT/.tripwire.XXXXXX")"

start="$(date +%s)"
set +e
# stderr is teed live (terminal output unchanged) and captured; stdout is
# untouched. No trap: the wrapped command keeps its terminal signals.
CARGO_LOG=cargo::core::compiler::fingerprint=info "$@" 2> >(tee "$tmp_log" >&2)
status=$?
# The tee runs as a process-substitution child — wait for it to finish
# flushing before persisting or discarding the capture.
wait
set -e
elapsed="$(($(date +%s) - start))"

if [ "$elapsed" -ge "$threshold" ]; then
  tripwire_dir="$ROOT/.fingerprint-tripwire"
  mkdir -p "$tripwire_dir"
  cmd_name="$(basename "${1:-}")"
  [ -n "$cmd_name" ] || cmd_name="$(basename "$0")"
  worktree_id="$(printf '%s' "$PWD" | tr '/' '-')"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$tmp_log" "$tripwire_dir/fingerprint-${ts}-${elapsed}s-exit${status}-${cmd_name}-${worktree_id}.$$.log"
else
  rm -f "$tmp_log"
fi

exit "$status"
