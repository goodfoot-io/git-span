#!/usr/bin/env bash
set -uo pipefail

# Run cargo check for the Rust CLI and the extension package typecheck in
# parallel. Let Yarn resolve package-local tool binaries for the extension.

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PIDS=()
EXIT=0

# --- Rust CLI typecheck ---
if [ -f "$WORKSPACE_ROOT/packages/git-span/Cargo.toml" ]; then
  echo "Running cargo check for packages/git-span..."
  # Delegate to the package-level `typecheck` script so this entry point uses
  # the exact same flags (RUSTFLAGS, --locked), shared target lock, and target
  # directory (git-span/check). A second flag profile writing into the same
  # check/ target dir rebuilds crates in place with new SVHs and leaves E0460
  # "possibly newer version of crate" wreckage when runs interleave.
  (cd "$WORKSPACE_ROOT/packages/git-span" && yarn typecheck) &
  PIDS+=($!)
else
  echo "Warning: packages/git-span/Cargo.toml not found, skipping cargo check." >&2
fi

if [ -d "$WORKSPACE_ROOT/packages/extension" ]; then
  echo "Running extension typecheck..."
  (cd "$WORKSPACE_ROOT/packages/extension" && yarn typecheck) &
  PIDS+=($!)
else
  echo "Warning: packages/extension not found, skipping TypeScript typecheck." >&2
fi

for PID in "${PIDS[@]}"; do
  wait "$PID" || EXIT=1
done

exit $EXIT
