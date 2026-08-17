#!/usr/bin/env bash
set -o pipefail

# Single-instance guard for the website gate. Every gate leg binds port 4310
# and shares one handoff file under `os.tmpdir()`, so two gate runs — typically
# in sibling worktrees — would collide. The locks live in the git common dir,
# the one directory all worktrees share.
#
# Two locks are taken, both exclusive and both non-blocking:
#
#   website-gate.lock  excludes other gate runs (port 4310 + the handoff file).
#   validate.lock      excludes `yarn validate`, which runs
#                      `SKIP_INSTALL=1 yarn build` at the workspace root and so
#                      would rebuild the website out from under an audit that is
#                      mid-build or mid-assertion against it. `scripts/validate.sh`
#                      takes the same lock, so the exclusion is symmetric in both
#                      directions with no change needed on that side.
#
# flock releases on exit (crash included), so a dead run can never wedge the
# next one. On conflict this fails fast and names the holder rather than
# blocking silently forever.

if [ "$#" -ne 1 ]; then
  echo "usage: with-gate-lock.sh <shell-command>" >&2
  exit 2
fi

common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -z "$common_dir" ]; then
  echo "ERROR: not inside a git repository — cannot take the website gate lock" >&2
  exit 1
fi

gate_lock_path="$common_dir/website-gate.lock"
gate_owner_path="$common_dir/website-gate.lock.owner"
validate_lock_path="$common_dir/validate.lock"
validate_owner_path="$common_dir/validate.lock.owner"

# Record the holder (pid, host, worktree, start time) so blocked runs can point
# at the worktree in question. Written atomically via tmp + mv while the lock is
# held, so readers always see a complete record. Same line format as
# scripts/validate.sh writes, so either owner file reads the same way.
claim_owner() {
  printf '%s\n' "$$" "${HOSTNAME:-unknown}" "$PWD" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$1.tmp"
  mv "$1.tmp" "$1"
}

report_holder() {
  local owner_file="$1"
  local pid="" host="" worktree="" started=""
  if [ -f "$owner_file" ]; then
    pid="$(sed -n '1p' "$owner_file")"
    host="$(sed -n '2p' "$owner_file")"
    worktree="$(sed -n '3p' "$owner_file")"
    started="$(sed -n '4p' "$owner_file")"
  fi
  echo "  holder: pid ${pid:-unknown} on ${host:-unknown}, started ${started:-unknown}" >&2
  [ -n "$worktree" ] && echo "  worktree: $worktree" >&2
  return 0
}

exec 9>"$gate_lock_path"

if ! flock -x -n 9; then
  echo "ERROR: another website gate run already holds $gate_lock_path" >&2
  report_holder "$gate_owner_path"
  echo "  The gate owns port 4310 and a shared server handoff file, so only one" >&2
  echo "  run may proceed — re-run once the run above finishes." >&2
  exit 2
fi
claim_owner "$gate_owner_path"

exec 8>"$validate_lock_path"

if ! flock -x -n 8; then
  echo "ERROR: a validation run already holds $validate_lock_path" >&2
  report_holder "$validate_owner_path"
  echo "  \`yarn validate\` rebuilds every package — the website included — so it" >&2
  echo "  cannot overlap a gate run auditing the built site. Re-run the gate once" >&2
  echo "  the validation above finishes." >&2
  exit 2
fi
claim_owner "$validate_owner_path"

bash -c "$1"
