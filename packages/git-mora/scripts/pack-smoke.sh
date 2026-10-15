#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
binary="${1:?usage: pack-smoke.sh <native binary>}"
platform="$(node -p 'process.platform + "-" + process.arch')"
binary_name=git-mora
case "$platform" in win32-*) binary_name=git-mora.exe ;; esac
mkdir -p "../../npm/git-mora-$platform/bin"
cp "$binary" "../../npm/git-mora-$platform/bin/$binary_name"

archive_dir="$(mktemp -d)"
trap 'rm -rf "$archive_dir"' EXIT
yarn workspace "git-mora-$platform" pack --out "$archive_dir/platform.tgz"
yarn workspace git-mora pack --out "$archive_dir/installer.tgz"
node scripts/pack-smoke.mjs "$archive_dir/platform.tgz" "$archive_dir/installer.tgz"
