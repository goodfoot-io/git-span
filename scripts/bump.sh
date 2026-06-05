#!/usr/bin/env bash
set -euo pipefail

# Resolve to a path the platform's `node` can consume. On Git Bash/MSYS,
# plain `pwd` yields `/c/...` which Windows Node mis-resolves; `pwd -W`
# yields `C:/...` which Node handles on every platform.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd -W)" ;;
  *)                    REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)" ;;
esac
SOURCE="$REPO_ROOT/packages/git-mesh/package.json"
LEVEL="${1:-patch}"

case "$LEVEL" in
  major|minor|patch) ;;
  *)
    echo "Usage: yarn bump [major|minor|patch]" >&2
    exit 1
    ;;
esac

NEW_VERSION=$(node -e "
  const fs = require('fs');
  const raw = fs.readFileSync('$SOURCE', 'utf8');
  const pkg = JSON.parse(raw);
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  const next = '$LEVEL' === 'major' ? [maj + 1, 0, 0]
             : '$LEVEL' === 'minor' ? [maj, min + 1, 0]
             : [maj, min, pat + 1];
  const newVersion = next.join('.');
  const updated = raw.replace(/\"version\": \"[^\"]+\"/, JSON.stringify('version') + ': ' + JSON.stringify(newVersion));
  fs.writeFileSync('$SOURCE', updated);
  console.log(newVersion);
")

echo "Bumped packages/git-mesh to $NEW_VERSION"
echo ""
bash "$REPO_ROOT/scripts/sync-versions.sh"

# Refresh the workspace lockfile so the bumped versions resolve. Run from the
# repo root regardless of the caller's CWD.
echo ""
(cd "$REPO_ROOT" && yarn install)

# Regenerate the version-stamped manpage so the checked-in artifact tracks the
# new version. The manpage embeds the version in its `.TH` header, so without
# this the `generated_manpage_matches_checked_in_artifact` test fails on the
# very next `yarn validate` after a bump.
echo ""
echo "Regenerating manpage for $NEW_VERSION"
(cd "$REPO_ROOT/packages/git-mesh" && yarn build:man)
