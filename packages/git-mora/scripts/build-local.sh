#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
bash scripts/cargo.sh build build --release --locked
binary="git-mora"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) binary="git-mora.exe" ;;
esac
mkdir -p "$HOME/.local/bin"
install -m 0755 "${GIT_SPAN_CARGO_TARGET_ROOT:-/var/cache/git-span/cargo-target}/git-mora/build/release/$binary" \
  "$HOME/.local/bin/$binary"
