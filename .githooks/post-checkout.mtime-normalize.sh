#!/bin/bash
# post-checkout.mtime-normalize.sh — pin the mtimes of tracked files under
# the cargo crate roots to the time of the last commit that touched each
# file, so the shared Cargo target root (GIT_SPAN_CARGO_TARGET_ROOT, see
# packages/git-span/scripts/cargo-build-system.md) stays warm across
# worktrees that check out the same commit.
#
# Why: cargo's mtime-mode fingerprints record source-file mtimes. A fresh
# checkout writes files with "now" mtimes, so every new worktree looked
# stale and paid a full cold rebuild (~31s) even though the shared cache
# already held identical artifacts. Pinning mtimes to commit times makes
# "same commit" mean "same mtimes", so a new worktree hits the cache.
#
# Only clean files are pinned. Files with uncommitted edits keep their own
# mtimes: cargo must rebuild them, and pinning would push sibling worktrees
# at the same commit into rebuilding against them.
set -euo pipefail

top="$(git rev-parse --show-toplevel)" || exit 0
[ -n "$top" ] || exit 0

# Cargo crate roots, discovered from tracked manifests.
mapfile -t manifests < <(git -C "$top" ls-files 'packages/*/Cargo.toml' 'npm/*/Cargo.toml')
dirs=()
for m in "${manifests[@]}"; do
    dirs+=("$(dirname "$m")")
done
[ "${#dirs[@]}" -gt 0 ] || exit 0

# Files with uncommitted edits must keep their own mtimes.
dirty_set=""
while IFS= read -r -d '' f; do dirty_set+="$f"$'\0'; done \
    < <(git -C "$top" diff --name-only -z HEAD)

# One walk over the crate history, newest commit first. Git emits each
# commit as `ts\0\n` followed by its changed paths, each `\0`-terminated,
# with the next commit's `ts\0\n` starting right after the previous
# commit's last path. Split on \n that yields:
#     [ts1] [paths1 ts2] [paths2 ts3] ... [pathsN]
# The first time a path appears is its most recent commit, so the ts
# current at that moment is the pin for that path. NULs are mapped to
# \036 because bash variables cannot hold NUL bytes.
walk="$(
    git -C "$top" log HEAD --format=%ct --name-only -z -- "${dirs[@]}" \
        | tr '\0' '\036'
)" || exit 0

declare -A pin
mapfile -t lines <<<"$walk"
[ "${#lines[@]}" -gt 0 ] || exit 0
ts="${lines[0]%$'\036'}"
n="${#lines[@]}"
for (( k = 1; k < n; k++ )); do
    line="${lines[k]}"
    if (( k == n - 1 )); then
        # Final line carries only the oldest commit's paths (no next ts).
        while IFS= read -r -d $'\036' name; do
            [ -n "$name" ] || continue
            [ -z "${pin[$name]-}" ] || continue
            pin["$name"]="$ts"
        done <<<"$line"$'\036'
    else
        # Every other line: paths of the current commit, then the next
        # commit's ts as the last token. The trailing \036 must be stripped
        # first: in ${var##*sep} the * is free to span separators, so
        # against a line that ends with one it matches the whole string.
        no_rs="${line%$'\036'}"
        ts_next="${no_rs##*$'\036'}"
        line="${no_rs%$'\036'"$ts_next"}"
        while IFS= read -r -d $'\036' name; do
            [ -n "$name" ] || continue
            [ -z "${pin[$name]-}" ] || continue
            pin["$name"]="$ts"
        done <<<"$line"$'\036'
        ts="$ts_next"
    fi
done

missing=0
for d in "${dirs[@]}"; do
    while IFS= read -r -d '' f; do
        case "$dirty_set" in *"$f"$'\0'*) continue ;; esac
        if [ -n "${pin[$f]-}" ]; then
            touch -h -d "@${pin[$f]}" "$top/$f" 2>/dev/null || true
        else
            missing=$((missing + 1))
        fi
    done < <(git -C "$top" ls-files -z -- "$d")
done
if [ "$missing" -gt 0 ]; then
    echo "post-checkout.mtime-normalize: $missing tracked crate files have no commit-time pin (parse drift?); cache warmth not guaranteed" >&2
fi

exit 0
