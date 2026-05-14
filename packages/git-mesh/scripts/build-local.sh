#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

target_root="${GIT_MESH_CARGO_TARGET_ROOT:-./target-cache}"
built="$target_root/build/release/git-mesh"

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/man/man1"

env CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR="$target_root/build" cargo build --release
install -m 0755 "$built" "$HOME/.local/bin/git-mesh"

declare -A seen=()
seen["$(readlink -f "$HOME/.local/bin/git-mesh")"]=1
while IFS= read -r path_bin; do
  [ -n "$path_bin" ] || continue
  target="$(readlink -f "$path_bin")"
  [ -n "${seen[$target]:-}" ] && continue
  seen["$target"]=1
  install -m 0755 "$built" "$target"
  echo "Updated $path_bin -> $target"
done < <(type -ap git-mesh)

yarn build:man
install -m 0644 man/git-mesh.1 "$HOME/.local/share/man/man1/git-mesh.1"
