#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mode="${1:?usage: cargo.sh build|check <cargo arguments...>}"
shift
case "$mode" in
  build|check) ;;
  *) echo "ERROR: expected build or check target directory" >&2; exit 1 ;;
esac

# Reuse the same root lock and linker provisioning as git-span, with separate
# mora directories so check metadata never satisfies a codegen fingerprint.
exec bash ../git-span/scripts/with-target-lock.sh shared \
  env CARGO_TARGET_DIR="${GIT_SPAN_CARGO_TARGET_ROOT:-/var/cache/git-span/cargo-target}/git-mora/$mode" \
  cargo "$@"
