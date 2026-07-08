#!/bin/bash
# git-mesh reconciliation trigger -- advisory, never blocks.
# Spawns the git-mesh dispatcher detached with --post-rewrite, passing the
# old->new SHA mapping through on stdin. The dispatcher demotes any
# post-commit records whose stamped SHA was rewritten so they are
# re-promoted and re-detected against the new commit.
command -v node >/dev/null 2>&1 || exit 0

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 0
DISPATCHER="${REPO_ROOT}/plugins/git-mesh/hooks/bin/dispatcher.mjs"
[ -f "$DISPATCHER" ] || exit 0

# Capture stdin (old->new SHA mapping from git post-rewrite) before
# backgrounding. nohup and & can close the pipe before the dispatcher reads it.
INPUT=$(cat)
echo "$INPUT" | nohup node "${DISPATCHER}" --repo-root "${REPO_ROOT}" --post-rewrite \
  > /dev/null 2>&1 &

exit 0
