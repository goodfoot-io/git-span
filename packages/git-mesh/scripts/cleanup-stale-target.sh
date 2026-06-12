#!/usr/bin/env bash
# Remove ./target if it is a stale symlink from pre-per-worktree-target days.
# Idempotent and silent on the happy path.
node -e "try { if (require('fs').lstatSync('target').isSymbolicLink()) { require('fs').unlinkSync('target'); } } catch (e) { if (e.code !== 'ENOENT') throw e; }"

# Freshness stamp — invalidate script-specific target directories when
# dependencies, toolchain, or cargo config change.  Without this, `cargo
# clean` only touches the default target dir and leaves stale artifacts in
# the `typecheck/`, `lint/`, `test/`, and `build/` subdirectories.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg_dir="$(dirname "$script_dir")"
target_cache="${GIT_MESH_CARGO_TARGET_ROOT:-$pkg_dir/target-cache}"
stamp_file="$target_cache/.freshness-stamp"

# Collect inputs that invalidate cached build artifacts.
lock_hash=$(sha256sum "$pkg_dir/Cargo.lock" 2>/dev/null | cut -d' ' -f1)
rustc_ver=$(rustc --version 2>/dev/null)
config_hash=$(sha256sum "$pkg_dir/.cargo/config.toml" 2>/dev/null | cut -d' ' -f1)
current_stamp="${lock_hash:-no-lock}${rustc_ver:-no-rustc}${config_hash:-no-config}"

if [ -f "$stamp_file" ] && [ "$(cat "$stamp_file")" = "$current_stamp" ]; then
  exit 0
fi

# Stamp missing or stale — remove cached artifacts so the next build starts
# from a consistent state.
for dir in "$target_cache"/*/; do
  [ -d "$dir" ] || continue
  rm -rf "$dir"
done

mkdir -p "$target_cache"
printf '%s' "$current_stamp" > "$stamp_file"
