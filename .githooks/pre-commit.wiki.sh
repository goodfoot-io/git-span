#!/bin/bash
# Single wiki concern, single invocation:
#   wiki check --fix creates/extends .wiki meshes for uncovered fragment links and
#   auto-fixes drifted wiki links/anchors/frontmatter in the working tree.
# --no-exit-code makes this best-effort: the hook never aborts a commit.
# --print-applied routes created/extended mesh paths to stdout; everything else
# goes to stderr (shown on the terminal).
set -e

command -v wiki >/dev/null 2>&1 || exit 0
WIKI_BIN=$(command -v wiki)

# ── Single-pass: auto-fix + mesh coverage, re-stage only fix deltas ───────────
# --fix rewrites in place (requires --source=worktree); --print-applied prints
# created/extended mesh paths to stdout; --no-exit-code = advisory (best-effort).
#
# wiki check --fix has no flag that reports which .md files it rewrote (only
# --print-applied's mesh paths are machine-readable). So we snapshot the
# content hash of every tracked .md file before running --fix and compare
# after it runs. But a changed worktree hash alone cannot distinguish "changed
# only by --fix" from "already dirty before the hook ran and also fixed" —
# `git add` is whole-file, so re-staging the latter sweeps another session's
# in-progress edits into this commit wholesale. Therefore each tracked .md is
# snapshotted as {worktree-hash, index-hash}: a file whose pre-hook worktree
# hash differs from its index hash was already dirty and is NEVER staged; its
# post-fix state stays in the worktree for its owner, with a warning. Only
# files clean before the hook get their fix delta re-staged.

# Print the repo-relative .md pages a mesh anchors, one per line. Anchor lines
# look like "<path>[#L<start>-L<end>] rk64:<hex>"; prose below them never ends
# in an anchor-shaped token. A path that does not resolve through the snapshot
# tables is treated as dirty by the caller, so false positives fail closed.
mesh_md_anchors() {
    local mesh="$1"
    [ -f "$mesh" ] || return 1
    sed -n -E 's/^(.*)[[:space:]]rk64:[0-9a-f]+$/\1/p' -- "$mesh" |
        sed -E 's/#L[0-9]+(-L[0-9]+)?$//' |
        grep '\.md$' || true
}

TRACKED_MD=()
declare -A PRE_WT_HASH PRE_IDX_HASH
while IFS= read -r -d '' f; do
    [ -f "$f" ] || continue
    wt_hash=$(git hash-object -- "$f")
    idx_hash=$(git ls-files -s -- "$f" | awk '{print $2}')
    TRACKED_MD+=("$f")
    PRE_WT_HASH["$f"]="$wt_hash"
    PRE_IDX_HASH["$f"]="${idx_hash:-}"
done < <(git ls-files -z -- '*.md')

APPLIED=$("$WIKI_BIN" check --fix --print-applied --no-exit-code --source=worktree)

WIKI_FIXED=()
SKIPPED_DIRTY=()
for f in "${TRACKED_MD[@]}"; do
    [ -f "$f" ] || continue
    after_hash=$(git hash-object -- "$f")
    [ "$after_hash" != "${PRE_WT_HASH[$f]}" ] || continue
    if [ -n "${PRE_IDX_HASH[$f]}" ] && [ "${PRE_WT_HASH[$f]}" = "${PRE_IDX_HASH[$f]}" ]; then
        WIKI_FIXED+=("$f")
    else
        SKIPPED_DIRTY+=("$f")
    fi
done

if [ ${#WIKI_FIXED[@]} -gt 0 ]; then
    git add -- "${WIKI_FIXED[@]}"
    echo "Re-staged wiki-fixed files:"
    printf '%s\n' "${WIKI_FIXED[@]}"
fi

if [ ${#SKIPPED_DIRTY[@]} -gt 0 ]; then
    {
        echo "pre-commit.wiki: WARNING: --fix touched files that were already dirty"
        echo "pre-commit.wiki: before this hook ran; NOT staging them so their"
        echo "pre-commit.wiki: unrelated in-progress edits stay out of this commit"
        echo "pre-commit.wiki: (left unstaged in the worktree for their owner):"
        printf '  %s\n' "${SKIPPED_DIRTY[@]}"
    } >&2
fi

if [ -n "$APPLIED" ]; then
    MESHES_TO_STAGE=()
    SKIPPED_MESHES=()
    declare -A SKIPPED_MESH_PAGES
    while IFS= read -r mesh_path; do
        [ -n "$mesh_path" ] || continue
        # Stage a scaffolded mesh only when every page it anchors was clean
        # before the hook ran (pages this run fixed qualify: their fix delta
        # is staged above, so the committed mesh matches committed content).
        dirty_pages=()
        if ! mesh_pages="$(mesh_md_anchors "$mesh_path")"; then
            dirty_pages+=("<unreadable: $mesh_path>")
        else
            while IFS= read -r page; do
                [ -n "$page" ] || continue
                if [ -z "${PRE_IDX_HASH[$page]:-}" ] ||
                    [ "${PRE_WT_HASH[$page]:-}" != "${PRE_IDX_HASH[$page]}" ]; then
                    dirty_pages+=("$page")
                fi
            done <<< "$mesh_pages"
        fi
        if [ ${#dirty_pages[@]} -eq 0 ]; then
            MESHES_TO_STAGE+=("$mesh_path")
        else
            SKIPPED_MESHES+=("$mesh_path")
            SKIPPED_MESH_PAGES["$mesh_path"]="${dirty_pages[*]}"
        fi
    done <<< "$APPLIED"

    if [ ${#MESHES_TO_STAGE[@]} -gt 0 ]; then
        for mesh_path in "${MESHES_TO_STAGE[@]}"; do
            git add -- "$mesh_path"
        done
        echo "Staged scaffolded meshes:"
        printf '%s\n' "${MESHES_TO_STAGE[@]}"
    fi

    if [ ${#SKIPPED_MESHES[@]} -gt 0 ]; then
        {
            echo "pre-commit.wiki: WARNING: not staging scaffolded meshes anchored"
            echo "pre-commit.wiki: to pages that were already dirty before this hook"
            echo "pre-commit.wiki: ran (or unreadable meshes); left for their owner:"
            for mesh_path in "${SKIPPED_MESHES[@]}"; do
                printf '  %s (dirty: %s)\n' "$mesh_path" "${SKIPPED_MESH_PAGES[$mesh_path]}"
            done
        } >&2
    fi
fi
exit 0
