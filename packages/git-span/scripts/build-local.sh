#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

target_root="${GIT_SPAN_CARGO_TARGET_ROOT:-$HOME/.cache/git-span/cargo-target}"
built="$target_root/git-span/build/release/git-span"

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/man/man1"

bash scripts/with-target-lock.sh shared env CARGO_BUILD_JOBS=1 CARGO_TARGET_DIR="$target_root/git-span/build" cargo build --release --locked
install -m 0755 "$built" "$HOME/.local/bin/git-span"

declare -A seen=()
seen["$(readlink -f "$HOME/.local/bin/git-span")"]=1
while IFS= read -r path_bin; do
  [ -n "$path_bin" ] || continue
  target="$(readlink -f "$path_bin")"
  [ -n "${seen[$target]:-}" ] && continue
  seen["$target"]=1
  install -m 0755 "$built" "$target"
  echo "Updated $path_bin -> $target"
done < <(type -ap git-span)

yarn build:man
install -m 0644 man/git-span.1 "$HOME/.local/share/man/man1/git-span.1"
