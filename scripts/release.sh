#!/usr/bin/env bash
set -euo pipefail

# Resolve to a path the platform's `node` can consume. On Git Bash/MSYS,
# plain `pwd` yields `/c/...` which Windows Node mis-resolves in `require()`;
# `pwd -W` yields `C:/...` which Node handles on every platform.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -W)" ;;
  *)                    REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" ;;
esac
CLI_PKG="$REPO_ROOT/packages/git-span/package.json"
EXT_PKG="$REPO_ROOT/packages/extension/package.json"

# --- Read versions ---
CLI_VERSION=$(node -pe "require('$CLI_PKG').version")
EXT_VERSION=$(node -pe "require('$EXT_PKG').version")

if [[ ! "$CLI_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: Version '$CLI_VERSION' in packages/git-span/package.json is not valid semver." >&2
  exit 1
fi

# --- Version lock check ---
if [[ "$CLI_VERSION" != "$EXT_VERSION" ]]; then
  echo "ERROR: CLI version ($CLI_VERSION) does not match extension version ($EXT_VERSION)." >&2
  echo "       Bump both packages to the same version before releasing." >&2
  exit 1
fi

TAG="git-span-v$CLI_VERSION"

# --- Branch check ---
BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "ERROR: Releases must be run from the 'main' branch (currently on '$BRANCH')." >&2
  exit 1
fi

# --- Origin sync check ---
git -C "$REPO_ROOT" fetch origin main
LOCAL_HEAD=$(git -C "$REPO_ROOT" rev-parse HEAD)
ORIGIN_MAIN=$(git -C "$REPO_ROOT" rev-parse origin/main)
if [[ "$LOCAL_HEAD" != "$ORIGIN_MAIN" ]]; then
  echo "ERROR: Local 'main' ($LOCAL_HEAD) does not match origin/main ($ORIGIN_MAIN)." >&2
  echo "       Fast-forward or rebase local main onto origin/main before releasing." >&2
  exit 1
fi

# --- Tag existence check ---
if git -C "$REPO_ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
  echo "ERROR: Tag '$TAG' already exists locally." >&2
  exit 1
fi
REMOTE_TAGS=$(git -C "$REPO_ROOT" ls-remote --tags origin "refs/tags/$TAG")
if [[ -n "$REMOTE_TAGS" ]]; then
  echo "ERROR: Tag '$TAG' already exists on remote." >&2
  exit 1
fi

# --- Uncommitted changes check (tracked and untracked) ---
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "ERROR: There are uncommitted or untracked changes. Commit or stash them before releasing." >&2
  exit 1
fi

echo "Releasing $TAG from branch '$BRANCH'..."

git -C "$REPO_ROOT" tag "$TAG"
git -C "$REPO_ROOT" push origin "$TAG"

echo "Done. Tag $TAG pushed."
