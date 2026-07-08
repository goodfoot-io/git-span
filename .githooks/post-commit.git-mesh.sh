#!/bin/bash
# git-mesh reconciliation trigger -- advisory, never blocks.
# Spawns the git-mesh dispatcher detached; it promotes pre-commit anchor
# records and, if any are pending, reconciles stale meshes in the
# background. All logging lives in .mesh/dispatcher.log.
command -v node >/dev/null 2>&1 || exit 0

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
DISPATCHER="${REPO_ROOT}/plugins/git-mesh/hooks/bin/dispatcher.mjs"
[ -f "$DISPATCHER" ] || exit 0

# Capture HEAD before backgrounding so the dispatcher uses the commit that
# triggered the hook, not whatever HEAD points to when it eventually runs.
COMMIT_SHA=$(git rev-parse HEAD)

nohup node "${DISPATCHER}" --repo-root "${REPO_ROOT}" --commit-sha "${COMMIT_SHA}" \
  > /dev/null 2>&1 &

exit 0
