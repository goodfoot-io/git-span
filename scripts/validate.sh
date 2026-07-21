#!/usr/bin/env bash
set -o pipefail

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
  git span stale &&
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
exit $EXIT_CODE
