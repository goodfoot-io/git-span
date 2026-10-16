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

# `git mora --help` and `git mora <command> --help` open man pages, so install them where man-db finds
# them next to ~/.local/bin; the HTML help (git config help.format html) is installed beside them.
mkdir -p "$HOME/.local/share/man/man1" "$HOME/.local/share/doc/git-mora"
install -m 0644 man/*.1 "$HOME/.local/share/man/man1/"
install -m 0644 doc/*.html "$HOME/.local/share/doc/git-mora/"
