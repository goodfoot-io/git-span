#!/usr/bin/env bash
set -uo pipefail
# Remove ./target if it is a stale symlink from pre-per-worktree-target days.
# Idempotent and silent on the happy path.
node -e "try { if (require('fs').lstatSync('target').isSymbolicLink()) { require('fs').unlinkSync('target'); } } catch (e) { if (e.code !== 'ENOENT') throw e; }"

# Freshness stamp — invalidate the shared task target directories when
# dependencies, toolchain, or cargo config change.  Without this, `cargo
# clean` only touches the default target dir and leaves stale artifacts in
# the per-package `check/` and `build/` subdirectories (see
# scripts/cargo-build-system.md for the directory layout).
#
# The default root must match the root every cargo task actually uses
# (/var/cache/git-span/cargo-target) — stamping the per-worktree
# target-cache/ fallback would guard a directory the scripted tasks never
# write to. Both crates (git-span and git-span-core) share this root, so the
# stamp folds in both lockfiles and both cargo configs: a change to either
# crate's resolution or toolchain wipes the whole root in one consistent step.
#
# The stamp computation is the single source of truth in
# cargo-target-stamp.sh, shared with with-target-lock.sh (which refreshes the
# stamp after every successful build). Three decisions fall out of the stamp
# state: fresh → exit 0; MISSING → record the stamp and DO NOT wipe (a root
# without a stamp proves nothing changed — it predates the stamp feature or a
# wipe already cleared it, and wiping warm artifacts on no evidence is the
# main-220 regression); stale → wipe the whole root (inputs really changed).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$script_dir/cargo-target-stamp.sh"
target_root="${GIT_SPAN_CARGO_TARGET_ROOT:-/var/cache/git-span/cargo-target}"
stamp_file="$target_root/.freshness-stamp"

current_stamp="$(compute_target_stamp)"

if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$current_stamp" ]; then
  exit 0
fi

# Stamp missing or stale — reconcile the root's state under the *exclusive*
# target-root lock so we can never delete artifacts out from under an
# in-flight cargo task in a sibling worktree (those hold the shared lock for
# their full duration — see with-target-lock.sh).
bash "$script_dir/with-target-lock.sh" exclusive bash -c '
  set -uo pipefail
  target_root="$1"
  stamp_file="$2"
  current_stamp="$3"
  # Re-check under the lock: a peer may have refreshed the stamp already.
  if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$current_stamp" ]; then
    exit 0
  fi
  # The tripwire dir is a dotfile dir, so the */ glob below never matches it
  # and these logs survive any wipe. Events are recorded durably here because
  # they are fast — well under the fingerprint-tripwire threshold in
  # with-target-lock.sh — so their stderr would never be persisted otherwise.
  tripwire_dir="$target_root/.fingerprint-tripwire"
  mkdir -p "$tripwire_dir"
  # Missing stamp — no evidence the inputs changed (lockfiles, toolchain, and
  # config all hash to the current value). Wiping warm artifacts on a missing
  # stamp is the main-220 whole-root-wipe regression: record the stamp and
  # leave every artifact in place; the next run hits the fresh-stamp fast
  # path. The STAMP evidence line mirrors the WIPE line format so the tripwire
  # log implicates or exonerates the stamp lifecycle.
  if [ ! -f "$stamp_file" ]; then
    printf "STAMP %s created-missing\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$tripwire_dir/wipe-events.log"
    printf "%s" "$current_stamp" > "$stamp_file"
    exit 0
  fi
  # The wipe fires here — the stamp is present but stale, so the inputs
  # really changed. Array, not a space-joined string:
  # GIT_SPAN_CARGO_TARGET_ROOT is a documented user override and may contain
  # spaces — an unquoted re-loop would split each wiped path into fragments
  # and rm -rf outside the root.
  dirs=()
  for dir in "$target_root"/*/; do
    [ -d "$dir" ] || continue
    dirs+=("$dir")
  done
  wipe_line="WIPE $(date -u +%Y-%m-%dT%H:%M:%SZ) stale removing${dirs[*]:+ ${dirs[*]}}"
  printf "%s\n" "$wipe_line" >> "$tripwire_dir/wipe-events.log"
  echo "$wipe_line"
  for dir in "${dirs[@]}"; do
    rm -rf "$dir"
  done
  mkdir -p "$target_root"
  printf "%s" "$current_stamp" > "$stamp_file"
' _ "$target_root" "$stamp_file" "$current_stamp"
