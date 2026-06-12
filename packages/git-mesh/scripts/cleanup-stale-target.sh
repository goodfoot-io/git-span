#!/usr/bin/env bash
set -uo pipefail
# Remove ./target if it is a stale symlink from pre-per-worktree-target days.
# Idempotent and silent on the happy path.
node -e "try { if (require('fs').lstatSync('target').isSymbolicLink()) { require('fs').unlinkSync('target'); } } catch (e) { if (e.code !== 'ENOENT') throw e; }"

# Freshness stamp — invalidate the shared task target directories when
# dependencies, toolchain, or cargo config change.  Without this, `cargo
# clean` only touches the default target dir and leaves stale artifacts in
# the per-package `check/` and `build/` subdirectories (see
# scripts/cargo-build-system.md for the directory layout).
#
# The default root must match the root every cargo task actually uses
# ($HOME/.cache/git-mesh/cargo-target) — stamping the per-worktree
# target-cache/ fallback would guard a directory the scripted tasks never
# write to. Both crates (git-mesh and git-mesh-core) share this root, so the
# stamp folds in both lockfiles and both cargo configs: a change to either
# crate's resolution or toolchain wipes the whole root in one consistent step.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg_dir="$(dirname "$script_dir")"
core_dir="$(dirname "$pkg_dir")/git-mesh-core"
target_root="${GIT_MESH_CARGO_TARGET_ROOT:-$HOME/.cache/git-mesh/cargo-target}"
stamp_file="$target_root/.freshness-stamp"

# Collect inputs that invalidate cached build artifacts.
lock_hash=$(sha256sum "$pkg_dir/Cargo.lock" 2>/dev/null | cut -d' ' -f1)
core_lock_hash=$(sha256sum "$core_dir/Cargo.lock" 2>/dev/null | cut -d' ' -f1)
rustc_ver=$(rustc --version 2>/dev/null)
config_hash=$(sha256sum "$pkg_dir/.cargo/config.toml" 2>/dev/null | cut -d' ' -f1)
core_config_hash=$(sha256sum "$core_dir/.cargo/config.toml" 2>/dev/null | cut -d' ' -f1)
current_stamp="${lock_hash:-no-lock}${core_lock_hash:-no-core-lock}${rustc_ver:-no-rustc}${config_hash:-no-config}${core_config_hash:-no-core-config}"

if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$current_stamp" ]; then
  exit 0
fi

# Stamp missing or stale — remove cached artifacts so the next build starts
# from a consistent state. The wipe runs under the *exclusive* target-root
# lock so it can never delete artifacts out from under an in-flight cargo
# task in a sibling worktree (those hold the shared lock for their full
# duration — see with-target-lock.sh).
bash "$script_dir/with-target-lock.sh" exclusive bash -c '
  set -uo pipefail
  target_root="$1"
  stamp_file="$2"
  current_stamp="$3"
  # Re-check under the lock: a peer may have refreshed the stamp already.
  if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$current_stamp" ]; then
    exit 0
  fi
  for dir in "$target_root"/*/; do
    [ -d "$dir" ] || continue
    rm -rf "$dir"
  done
  mkdir -p "$target_root"
  printf "%s" "$current_stamp" > "$stamp_file"
' _ "$target_root" "$stamp_file" "$current_stamp"
