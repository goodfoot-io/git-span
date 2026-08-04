#!/usr/bin/env bash
set -o pipefail

# Single-instance guard: only one validation may run at a time, across every
# worktree of this repo. The lock lives in the git common dir — the one
# directory all worktrees share — so validations in sibling worktrees
# serialize while unrelated repos stay independent. flock releases the lock
# automatically when the holder exits (even on a crash), so a dead validation
# can never wedge future runs.
#
# On conflict the default is to alert on stdout and exit 2; `--wait` blocks
# until the running validation finishes, then proceeds.
WAIT=0
for arg in "$@"; do
  case "$arg" in
    --wait) WAIT=1 ;;
    *)
      echo "ERROR: unknown option '$arg' (only --wait is supported)" >&2
      exit 2
      ;;
  esac
done

common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -z "$common_dir" ]; then
  echo "ERROR: not inside a git repository — cannot take the validation lock" >&2
  exit 1
fi

lock_path="$common_dir/validate.lock"
owner_path="$common_dir/validate.lock.owner"

exec 9>"$lock_path"

acquire_lock() {
  if flock -x -n 9; then
    # Record the holder (pid, host, worktree, start time) so blocked runs can
    # point at the worktree in question. Written atomically via tmp + mv while
    # the lock is held, so readers always see a complete record.
    printf '%s\n' "$$" "${HOSTNAME:-unknown}" "$PWD" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$owner_path.tmp"
    mv "$owner_path.tmp" "$owner_path"
    return 0
  fi
  return 1
}

holder_info() {
  local pid="" host="" worktree="" started=""
  if [ -f "$owner_path" ]; then
    pid="$(sed -n '1p' "$owner_path")"
    host="$(sed -n '2p' "$owner_path")"
    worktree="$(sed -n '3p' "$owner_path")"
    started="$(sed -n '4p' "$owner_path")"
  fi
  echo "another validation is already running (pid ${pid:-unknown} on ${host:-unknown}, started ${started:-unknown})"
  [ -n "$worktree" ] && echo "  worktree: $worktree"
}

if ! acquire_lock; then
  if [ "$WAIT" -eq 1 ]; then
    holder_info
    echo "Waiting for it to finish — validation will start once the lock is released."
    waited=0
    while ! acquire_lock; do
      waited=$((waited + 1))
      if [ $((waited % 12)) -eq 0 ]; then
        echo "still waiting for the other validation to finish..."
      fi
      sleep 5
    done
    echo "validation lock acquired — starting."
  else
    holder_info
    echo "Only one validation may run at a time — re-run with 'yarn validate --wait'"
    echo "to wait for the running validation to finish."
    exit 2
  fi
fi

# Guardrail: integration tests must not reference `std::os::unix` directly —
# they go through tests/support/mod.rs cross-platform helpers so the suite
# compiles and runs on Windows. Fail fast before the (slow) yarn pipeline.
guardrail_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/packages/git-span/tests"
if [ -d "$guardrail_root" ]; then
  offenders=""
  while IFS= read -r f; do
    # Allow os::unix only in tests/support/ cross-platform helpers.
    case "$f" in
      "$guardrail_root/support/"*) continue ;;
    esac
    if grep -q 'os::unix' "$f"; then
      offenders="$offenders$f"$'\n'
    fi
  done < <(find "$guardrail_root" -type f -name '*.rs')
  if [ -n "$offenders" ]; then
    echo "ERROR: forbidden 'os::unix' reference in integration tests" >&2
    echo "Use the cross-platform helpers in tests/support/mod.rs instead." >&2
    printf '%s' "$offenders" >&2
    exit 1
  fi
fi

{
  git span drift &&
  yarn typecheck &&
  yarn lint &&
  yarn test &&
  SKIP_INSTALL=1 yarn build &&
  (
    if ! git diff --exit-code -- plugins-claude/git-span/hooks plugins-codex/git-span/hooks; then
      echo "ERROR: rebuild produced uncommitted bundle changes — commit the rebuilt plugin bundles" >&2
      exit 1
    fi
  )
} 2>&1 | tee yarn-validate-output.log

EXIT_CODE=${PIPESTATUS[0]}
echo "Exit code: $EXIT_CODE" | tee -a yarn-validate-output.log
exit "$EXIT_CODE"
