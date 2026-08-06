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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Linker wrapper materialization. The [target.*].linker config pins a BARE
# name (`linker = "cc.mold-wrapper"`): Cargo 1.97 hashes the *resolved* linker
# value into every unit fingerprint, so a relative-path linker (resolved to a
# per-worktree absolute path) makes sibling worktrees recompute every
# fingerprint and rebuild the whole graph (dirty: ConfigSettingsChanged). A
# bare name is hashed literally — identical from every worktree — and the PATH
# lookup happens at spawn time. To make that lookup succeed everywhere, ensure
# the wrapper exists at a shared, worktree-invariant location and prepend it
# to PATH for the wrapped command and any cargo/rustc it spawns. The copy is
# copy-if-missing only: a user-installed wrapper is never clobbered, and
# because the fingerprint covers the literal name (not the wrapper path or
# content), wrapper staleness can never cause rebuilds.
wrapper_dir="$HOME/.local/bin"
wrapper="$wrapper_dir/cc.mold-wrapper"
if [ ! -x "$wrapper" ]; then
  mkdir -p "$wrapper_dir"
  if ! cp "$script_dir/cc.mold-wrapper.sh" "$wrapper" || ! chmod +x "$wrapper"; then
    echo "ERROR: could not install the mold cc wrapper at $wrapper (required by [target.*].linker = \"cc.mold-wrapper\")" >&2
    exit 1
  fi
fi
export PATH="$wrapper_dir:$PATH"

# Freshness-stamp helpers: compute_target_stamp / refresh_target_stamp (see
# cargo-target-stamp.sh). A successful build below refreshes the root's
# .freshness-stamp so it records the inputs the cache was built with; the
# refresh is advisory and must never fail the build.
# shellcheck disable=SC1091
. "$script_dir/cargo-target-stamp.sh"

refresh_stamp_on_success() {
  local status="$1"
  if [ "$status" -eq 0 ]; then
    refresh_target_stamp "$ROOT" || {
      echo "WARNING: could not refresh $ROOT/.freshness-stamp (stamp is advisory; cleanup-stale-target.sh re-evaluates)" >&2
    }
  fi
}

# Fingerprint tripwire: tee the wrapped run's stderr into a temp file and
# persist it when a slow run's capture shows cargo fingerprint invalidation
# evidence, so a cold rebuild's log (CARGO_LOG=cargo::core::compiler::fingerprint=info
# names the stale input directly — e.g. "stale: changed ...", "dirty:
# ConfigSettingsChanged", "dependency on X is newer than we are") survives for
# the cache-invalidation investigation. Persistence is gated on BOTH elapsed
# >= GIT_SPAN_FINGERPRINT_THRESHOLD (default 15s) and at least one fingerprint
# marker in the capture: the worktree-divergent [target.*].linker config hash
# makes a cross-worktree cold run ~80-265s and emits markers throughout, while
# warm runs — fast or slow; nextest routinely exceeds 15s across 34 worktrees —
# emit none and are discarded, so the evidence dir stays clean and bounded
# (captures are pruned after 14 days). GIT_SPAN_FINGERPRINT_TRIPWIRE=0 restores
# the plain pass-through (byte-identical output, for CI/release flows); the
# threshold default is 15 seconds.
if [ "${GIT_SPAN_FINGERPRINT_TRIPWIRE:-1}" = "0" ]; then
  set +e
  "$@"
  status=$?
  set -e
  refresh_stamp_on_success "$status"
  exit "$status"
fi

threshold="${GIT_SPAN_FINGERPRINT_THRESHOLD:-15}"
# A non-numeric threshold would make the -ge gate below fail under set -e,
# losing both the evidence and the wrapped command's status — sanitize early.
case "$threshold" in
  ''|*[!0-9]*) threshold=15 ;;
esac

tmp_log="$(mktemp "$ROOT/.tripwire.XXXXXX")"
# Accepted orphan behavior: a SIGTERM to this wrapper's pid (timeout/supervisors)
# kills only the wrapper — the wrapped cargo keeps running orphaned, still
# holding the flock via the inherited fd 9, and this dotfile temp file is left
# behind (0-N bytes, invisible to the wipe globs). Terminal ^C is unaffected
# (process-group SIGINT). The flock outliving its wrapper is the lesser evil
# to releasing it under an in-flight build.

start="$(date +%s)"
set +e
# stderr is teed live and captured; stdout is untouched. The tee makes stderr
# a pipe, not a tty, so cargo/nextest fall back to non-interactive formatting
# (no color/progress; nextest switches to line-per-test output) — content is
# preserved, the tty format is not. Deliberately accepted for capture. No
# trap: the wrapped command keeps its terminal signals.
CARGO_LOG=cargo::core::compiler::fingerprint=info "$@" 2> >(tee "$tmp_log" >&2)
status=$?
# The tee runs as a process-substitution child — wait for it to finish
# flushing before persisting or discarding the capture.
wait
set -e
elapsed="$(($(date +%s) - start))"

# Persist only on evidence: the capture must contain a real cargo fingerprint
# invalidation marker — the cargo 1.97 line formats: "dirty:
# ConfigSettingsChanged", `stale: changed "..."`, the mtime-mode "is newer
# than we are", and the "failed to read" fingerprint read error — AND elapsed
# >= threshold. Fast runs and evidence-free slow runs both discard the temp
# file. Test-name noise like `resolver::dirty::tests` matches none of these
# patterns.
if [ "$elapsed" -ge "$threshold" ] && grep -Eq 'dirty: ConfigSettingsChanged|stale: changed "|is newer than we are|failed to read' "$tmp_log"; then
  tripwire_dir="$ROOT/.fingerprint-tripwire"
  mkdir -p "$tripwire_dir"
  # Retention: prune fingerprint captures older than 14 days.
  find "$tripwire_dir" -name 'fingerprint-*.log' -mtime +14 -delete
  # cmd_name is the wrapped command's first word, skipping the `env` prefix
  # every scripted caller inserts (with-target-lock.sh shared env ...).
  cmd_name=""
  for word in "$@"; do
    [ "$word" = "env" ] && continue
    cmd_name="$(basename "$word")"
    break
  done
  [ -n "$cmd_name" ] || cmd_name="$(basename "$0")"
  worktree_id="$(printf '%s' "$PWD" | tr '/' '-')"
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$tmp_log" "$tripwire_dir/fingerprint-${ts}-${elapsed}s-exit${status}-${cmd_name}-${worktree_id}.$$.log"
else
  rm -f "$tmp_log"
fi

refresh_stamp_on_success "$status"

exit "$status"
