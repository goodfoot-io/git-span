//! Auto-follow helper for `git mesh stale --auto-follow`.
//!
//! For each mesh with eligible `Moved` anchors (verbatim blob, same path, no
//! Changed sibling), `follow_moves` writes a single new mesh commit that
//! replaces the affected anchor entries and records the audit trail.

use crate::anchor::create_anchor_with_extent_skipping_blob_bounds;
use crate::git::{self, resolve_ref_oid_optional_repo};
use crate::mesh::catalog::{Catalog, CATALOG_REF, build_mesh, commit_catalog};
use crate::mesh::path_index;
use std::collections::HashSet;
use crate::types::AnchorExtent;
use crate::{Error, Result};
use std::path::PathBuf;

/// A single resolved follow target: replace `anchor_id` in the mesh with
/// re-anchored `(new_path, new_extent)` at HEAD.
pub struct FollowDecision {
    pub anchor_id: String,
    pub new_path: PathBuf,
    pub new_extent: AnchorExtent,
}

/// Write a new mesh commit that replaces each anchor named in `decisions`
/// with its new location (re-anchored at HEAD).  The commit message is
/// inherited verbatim from the parent commit to preserve the user's authored
/// why — the audit trail is the new commit SHA, parent pointer, and reflog.
///
/// Uses the same CAS retry pattern as `commit_mesh` (MAX_RETRIES = 5).
pub fn follow_moves(
    repo: &gix::Repository,
    name: &str,
    decisions: &[FollowDecision],
) -> Result<String> {
    assert!(!decisions.is_empty(), "follow_moves called with no decisions");

    let head_sha = git::head_oid(repo)?;

    const MAX_RETRIES: usize = 5;
    let mut attempt: usize = 0;

    let new_commit: String;
    'retry: loop {
        let m = Catalog::load(repo)?
            .lookup(name)?
            .ok_or_else(|| Error::MeshNotFound(name.into()))?;

        // Build new anchor list: replace each matched id, keep all others.
        let mut combined: Vec<(String, crate::types::Anchor)> = Vec::new();
        'outer: for (id, anchor) in &m.anchors_v2 {
            for dec in decisions {
                if *id == dec.anchor_id {
                    // Re-anchor at HEAD with the new (path, extent).
                    let path_str = dec
                        .new_path
                        .to_str()
                        .ok_or_else(|| Error::Git("non-UTF-8 path in FollowDecision".into()))?;
                    let (new_id, new_anchor) = create_anchor_with_extent_skipping_blob_bounds(
                        repo,
                        &head_sha,
                        path_str,
                        dec.new_extent,
                    )?;
                    combined.push((new_id, new_anchor));
                    continue 'outer;
                }
            }
            combined.push((id.clone(), anchor.clone()));
        }

        // Sort by (path, extent) — same canonical order as commit_mesh.
        combined.sort_by(|a, b| {
            (a.1.path.as_str(), extent_sort_key(&a.1.extent))
                .cmp(&(b.1.path.as_str(), extent_sort_key(&b.1.extent)))
        });

        // Guardrail: reject duplicate (path, extent) in the rebuilt list.
        {
            let mut seen: HashSet<(String, (u32, u32))> = HashSet::new();
            for (_id, anchor) in &combined {
                let key = (anchor.path.clone(), extent_sort_key(&anchor.extent));
                if !seen.insert(key) {
                    attempt += 1;
                    if attempt >= MAX_RETRIES {
                        return Err(Error::ConcurrentUpdate {
                            expected: String::new(),
                            found: String::new(),
                        });
                    }
                    continue 'retry;
                }
            }
        }

        // Commit message: structured audit subject.
        let n = decisions.len();
        let message = format!(
            "mesh: follow {} moved anchor{}\n",
            n,
            if n == 1 { "" } else { "s" }
        );

        // Catalog RMW path: update mesh in catalog, create commit, CAS.
        let current_cat_ref =
            resolve_ref_oid_optional_repo(repo, CATALOG_REF)?;
        let mut catalog = Catalog::load(repo)?;
        let updated_mesh = build_mesh(name, &m.message, &combined, &m.config);
        catalog.insert(name, &updated_mesh)?;
        match commit_catalog(repo, &catalog, &message, current_cat_ref.as_deref()) {
            Ok(commit_oid) => {
                new_commit = commit_oid.clone();
                // Update path index refs (independent of catalog).
                let old_anchors = &m.anchors_v2;
                let path_updates =
                    path_index::ref_updates_for_mesh(repo, name, old_anchors, &combined)?;
                if !path_updates.is_empty() {
                    crate::git::ensure_log_all_ref_updates_always(repo)?;
                    let _ = crate::git::apply_ref_transaction_repo(repo, &path_updates);
                }
                break;
            }
            Err(_e) => {
                attempt += 1;
                if attempt >= MAX_RETRIES {
                    return Err(Error::ConcurrentUpdate {
                        expected: String::new(),
                        found: resolve_ref_oid_optional_repo(repo, CATALOG_REF)?
                            .unwrap_or_default(),
                    });
                }
                continue 'retry;
            }
        }
    }

    Ok(new_commit)
}

fn extent_sort_key(extent: &AnchorExtent) -> (u32, u32) {
    match *extent {
        AnchorExtent::WholeFile => (0, 0),
        AnchorExtent::LineRange { start, end } => (start, end),
    }
}
