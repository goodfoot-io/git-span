#!/usr/bin/env bash
set -euo pipefail
if [ -z "${HOME:-}" ]; then echo "ERROR: \$HOME is unset — refusing to operate on an empty path" >&2; exit 1; fi
# Safely clean the git-span codegen (build) target subdirectory. Takes the
# *exclusive* target-root lock (see with-target-lock.sh): cargo tasks hold the
# shared lock for their full duration, so this rm -rf can never run while
# another worktree's build is in flight, and concurrent clean invocations
# serialize against each other.
#
# Only the `git-span/build` (codegen/rlib) tree is removed — the non-codegen
# `git-span/check` (rmeta) tree is left intact because the two are
# deliberately isolated (see scripts/cargo-build-system.md).
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${GIT_SPAN_CARGO_TARGET_ROOT:-$HOME/.cache/git-span/cargo-target}"
exec bash "$script_dir/with-target-lock.sh" exclusive rm -rf "$ROOT/git-span/build"
