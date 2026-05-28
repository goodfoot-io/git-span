//! `git mesh stale --fix` — rewrite `Moved` and `Changed` anchors in
//! place by editing the mesh worktree files. No commit is produced; the
//! operator inspects the rewrite with `git diff` and stages it manually.
//!
//! The per-layer hashing rule (Worktree > Index > HEAD) drives both
//! which layer's content to read and which hashing convention to use.
//! `current.blob` is unreliable on the `Changed`/`Moved` branches (see
//! `notes/current-blob-unreliable-for-fix.md`), so we read content per
//! surfacing layer rather than via `current.blob`.

use crate::cli::commit::{hash_anchor_content, hash_bytes_with_extent, read_worktree_mesh,
    write_worktree_mesh};
use crate::types::{AnchorExtent, AnchorStatus, DriftSource, MeshResolved};
use anyhow::Result;
use std::collections::HashSet;

/// Re-anchor every `Moved`/`Changed` anchor in `meshes` by rewriting the
/// matching mesh worktree files. Returns the set of `anchor_id`s actually
/// rewritten (anchors whose hash/location were updated this invocation).
///
/// Terminal statuses (`Deleted`, `ContentUnavailable`, `MergeConflict`,
/// `Submodule`, `Orphaned`) are left untouched. `Fresh` anchors are not
/// candidates either.
pub(crate) fn apply_fix(
    repo: &gix::Repository,
    meshes: &[MeshResolved],
    mesh_root: &str,
) -> Result<HashSet<String>> {
    let mut rewritten: HashSet<String> = HashSet::new();

    // Resolve HEAD once for HEAD-layer rewrites. Some test scenarios may
    // have no HEAD yet (unborn branch); in that case we simply skip
    // HEAD-layer rewrites and leave the affected anchors as-is.
    let head_oid: Option<String> = repo
        .rev_parse_single("HEAD")
        .ok()
        .map(|id| id.detach().to_string());

    for m in meshes {
        // Read the on-disk mesh file. If it cannot be parsed (e.g. textual
        // conflict markers), skip the mesh entirely — operator must resolve.
        let mut mesh_file = match read_worktree_mesh(repo, mesh_root, &m.name) {
            Ok(mf) => mf,
            Err(_) => continue,
        };

        let mut any_rewritten = false;

        for resolved in &m.anchors {
            if !matches!(resolved.status, AnchorStatus::Moved | AnchorStatus::Changed) {
                continue;
            }
            let Some(current) = &resolved.current else {
                continue;
            };

            // Pick the deepest drifting layer: W > I > H.
            let layer = match resolved
                .layer_sources
                .iter()
                .copied()
                .max_by_key(|s| match s {
                    DriftSource::Worktree => 3,
                    DriftSource::Index => 2,
                    DriftSource::Head => 1,
                }) {
                Some(s) => s,
                None => continue,
            };

            let cur_path_str = current.path.to_string_lossy().to_string();
            let cur_extent = current.extent;

            // Compute the canonical hash from the surfacing layer.
            let hash_hex: String = match layer {
                DriftSource::Worktree => {
                    match hash_anchor_content(repo, &cur_path_str, &cur_extent, None) {
                        Ok((_alg, h)) => h,
                        Err(_) => continue,
                    }
                }
                DriftSource::Head => {
                    let oid = match head_oid.as_deref() {
                        Some(o) => o,
                        None => continue,
                    };
                    match hash_anchor_content(repo, &cur_path_str, &cur_extent, Some(oid)) {
                        Ok((_alg, h)) => h,
                        Err(_) => continue,
                    }
                }
                DriftSource::Index => {
                    // Read the index entry's blob bytes, then hash per extent.
                    let entries = match crate::git::index_entries(repo) {
                        Ok(e) => e,
                        Err(_) => continue,
                    };
                    let entry = match entries
                        .into_iter()
                        .find(|en| en.path == cur_path_str && en.stage == gix::index::entry::Stage::Unconflicted)
                    {
                        Some(e) => e,
                        None => continue,
                    };
                    let blob_oid_hex = entry.oid.to_string();
                    let bytes = match crate::git::read_blob_bytes(repo, &blob_oid_hex) {
                        Ok(b) => b,
                        Err(_) => continue,
                    };
                    // Validate line extent against blob.
                    if let AnchorExtent::LineRange { start, end } = cur_extent {
                        let line_count = std::str::from_utf8(&bytes)
                            .map(|s| s.lines().count() as u32)
                            .unwrap_or(0);
                        if start < 1 || end < start || end > line_count {
                            continue;
                        }
                        if std::str::from_utf8(&bytes).is_err() {
                            continue;
                        }
                    }
                    hash_bytes_with_extent(&bytes, &cur_extent)
                }
            };

            // Locate the AnchorRecord matching the anchored (path, extent).
            let (anc_start, anc_end) = match resolved.anchored.extent {
                AnchorExtent::LineRange { start, end } => (start, end),
                AnchorExtent::WholeFile => (0, 0),
            };
            let anc_path = resolved.anchored.path.to_string_lossy().to_string();

            let record = mesh_file.anchors.iter_mut().find(|r| {
                r.path == anc_path && r.start_line == anc_start && r.end_line == anc_end
            });
            let Some(record) = record else { continue };

            // Rewrite in place.
            let (new_start, new_end) = match cur_extent {
                AnchorExtent::LineRange { start, end } => (start, end),
                AnchorExtent::WholeFile => (0, 0),
            };
            record.path = cur_path_str;
            record.start_line = new_start;
            record.end_line = new_end;
            record.algorithm = "sha256".to_string();
            record.content_hash = hash_hex;
            rewritten.insert(resolved.anchor_id.clone());
            any_rewritten = true;
        }

        if any_rewritten {
            write_worktree_mesh(repo, mesh_root, &m.name, &mesh_file)?;
        }
    }

    Ok(rewritten)
}
