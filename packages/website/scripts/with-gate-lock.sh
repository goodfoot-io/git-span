#!/usr/bin/env bash
set -o pipefail

# Single-instance guard for the website gate. Every gate leg binds port 4310
# and shares one handoff file under `os.tmpdir()`, so two gate runs — typically
# in sibling worktrees — would collide. The lock lives in the git common dir,
# the one directory all worktrees share, and is distinct from validate.lock:
# the gate must serialize against itself, not against unrelated validation.
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

lock_path="$common_dir/website-gate.lock"
owner_path="$common_dir/website-gate.lock.owner"

exec 9>"$lock_path"

if flock -x -n 9; then
  printf '%s\n' "$$" "${HOSTNAME:-unknown}" "$PWD" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$owner_path.tmp"
  mv "$owner_path.tmp" "$owner_path"
else
  pid="" host="" worktree="" started=""
  if [ -f "$owner_path" ]; then
    pid="$(sed -n '1p' "$owner_path")"
    host="$(sed -n '2p' "$owner_path")"
    worktree="$(sed -n '3p' "$owner_path")"
    started="$(sed -n '4p' "$owner_path")"
  fi
  echo "ERROR: another website gate run already holds $lock_path" >&2
  echo "  holder: pid ${pid:-unknown} on ${host:-unknown}, started ${started:-unknown}" >&2
  [ -n "$worktree" ] && echo "  worktree: $worktree" >&2
  echo "  The gate owns port 4310 and a shared server handoff file, so only one" >&2
  echo "  run may proceed — re-run once the run above finishes." >&2
  exit 2
fi

bash -c "$1"
