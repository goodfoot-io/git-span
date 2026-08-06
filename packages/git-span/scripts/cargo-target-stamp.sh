#!/usr/bin/env bash
#
# cargo-target-stamp.sh — single source of truth for the shared cargo target
# root's freshness stamp. Sourced by with-target-lock.sh (refresh after a
# successful build) and cleanup-stale-target.sh (the wipe decision); define
# functions only, never execute anything on source, and never touch the
# sourcing shell's option flags.
#
# The stamp folds in every input that invalidates cached artifacts: both
# crates' lockfiles (a resolution change rebuilds the whole graph), the rustc
# version (a toolchain switch invalidates everything), and both crates'
# .cargo/config.toml (the [target.*].linker value is hashed into every unit
# fingerprint). Both crates (git-span and git-span-core) share one target root,
# so a change to either crate's inputs wipes the root in one consistent step —
# see scripts/cargo-build-system.md for the layout and the stamp lifecycle.
#
# The `|| true` guards keep every substitution safe under `set -e`: a missing
# lockfile/config or an absent rustc yields the same fallback markers the
# original inline computation produced (no-lock / no-rustc / no-config).
#
# Usage (source-only):
#   . "$script_dir/cargo-target-stamp.sh"
#   stamp="$(compute_target_stamp)"
#   refresh_target_stamp "$target_root"

# pkg_dir is the git-span package that owns this script; core_dir its sibling.
# BASH_SOURCE resolves the script's own location regardless of which script
# sources it or the caller's cwd.
_ccs_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ccs_pkg_dir="$(dirname "$_ccs_script_dir")"
_ccs_core_dir="$(dirname "$_ccs_pkg_dir")/git-span-core"

# Echo the current stamp string: sha256 of both Cargo.lock files, the rustc
# version, and sha256 of both .cargo/config.toml files, concatenated.
compute_target_stamp() {
  local lock_hash core_lock_hash rustc_ver config_hash core_config_hash
  lock_hash="$(sha256sum "$_ccs_pkg_dir/Cargo.lock" 2>/dev/null | cut -d' ' -f1 || true)"
  core_lock_hash="$(sha256sum "$_ccs_core_dir/Cargo.lock" 2>/dev/null | cut -d' ' -f1 || true)"
  rustc_ver="$(rustc --version 2>/dev/null || true)"
  config_hash="$(sha256sum "$_ccs_pkg_dir/.cargo/config.toml" 2>/dev/null | cut -d' ' -f1 || true)"
  core_config_hash="$(sha256sum "$_ccs_core_dir/.cargo/config.toml" 2>/dev/null | cut -d' ' -f1 || true)"
  printf "%s" "${lock_hash:-no-lock}${core_lock_hash:-no-core-lock}${rustc_ver:-no-rustc}${config_hash:-no-config}${core_config_hash:-no-core-config}"
}

# Write the stamp for <target_root> only if it is missing or differs from the
# computed value — a no-op when the root already reflects the current inputs,
# so every caller can call it unconditionally after a healthy build.
refresh_target_stamp() {
  local target_root="$1"
  local stamp_file current_stamp
  stamp_file="$target_root/.freshness-stamp"
  current_stamp="$(compute_target_stamp)"
  if [ ! -f "$stamp_file" ] || [ "$(cat "$stamp_file")" != "$current_stamp" ]; then
    printf "%s" "$current_stamp" > "$stamp_file"
  fi
}
