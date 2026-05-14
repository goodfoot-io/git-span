//! Rewrite engine — advances anchor_sha values via CAS after a history rewrite.
//!
//! Called by `git mesh rewrite` (the `post-rewrite` hook handler). Reads a map
//! of old→new SHA pairs (git's post-rewrite protocol), and for each mesh
//! advances anchors whose `anchor_sha` matches an old SHA, provided the
//! anchored bytes are identical across the rewrite.

use crate::git::{self, resolve_ref_oid_optional_repo};
use crate::mesh::catalog::{self, Catalog, CATALOG_REF};
use crate::mesh::read::read_mesh;
use crate::Result;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Public output types.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RewriteOutcome {
    pub name: String,
    pub advanced: u32,
    pub skipped_blob_changed: u32,
    pub skipped_path_missing: u32,
    pub errors: u32,
    pub anchors: Vec<AnchorRewriteRecord>,
    pub hard_error: Option<String>,
}

impl RewriteOutcome {
    pub fn is_hard_error(&self) -> bool {
        self.hard_error.is_some()
    }

    fn error(name: &str, e: crate::Error) -> Self {
        Self {
            name: name.to_string(),
            advanced: 0,
            skipped_blob_changed: 0,
            skipped_path_missing: 0,
            errors: 1,
            anchors: Vec::new(),
            hard_error: Some(e.to_string()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AnchorRewriteRecord {
    pub anchor_id: String,
    pub outcome: AnchorRewriteOutcome,
    pub old_sha: String,
    pub new_sha: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnchorRewriteOutcome {
    Advanced,
    SkippedBlobChanged,
    SkippedPathMissing,
    ConflictExhausted,
    NoMatch,
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

pub fn rewrite_meshes(
    repo: &gix::Repository,
    map: &HashMap<String, String>,
) -> Result<Vec<RewriteOutcome>> {
    if map.is_empty() {
        return Ok(Vec::new());
    }
    let catalog = Catalog::load(repo)?;
    let names = catalog.names();
    let mut outcomes = Vec::with_capacity(names.len());
    for name in &names {
        let outcome = rewrite_one_mesh(repo, name, map)
            .unwrap_or_else(|e| RewriteOutcome::error(name, e));
        outcomes.push(outcome);
    }
    Ok(outcomes)
}

// ---------------------------------------------------------------------------
// Per-mesh CAS retry loop (catalog path only).
// ---------------------------------------------------------------------------

fn rewrite_one_mesh(
    repo: &gix::Repository,
    name: &str,
    map: &HashMap<String, String>,
) -> Result<RewriteOutcome> {
    const MAX_RETRIES: usize = 5;
    let mut attempt = 0;

    loop {
        let mesh = match read_mesh(repo, name) {
            Ok(m) => m,
            Err(crate::Error::MeshNotFound(_)) => {
                return Ok(RewriteOutcome {
                    name: name.to_string(),
                    advanced: 0,
                    skipped_blob_changed: 0,
                    skipped_path_missing: 0,
                    errors: 0,
                    anchors: Vec::new(),
                    hard_error: Some("mesh not found".into()),
                });
            }
            Err(e) => return Err(e),
        };

        let mut anchor_records: Vec<AnchorRewriteRecord> = Vec::new();
        let mut new_anchors: Vec<(String, crate::types::Anchor)> = Vec::new();
        let mut advanced = 0u32;
        let mut skipped_blob_changed = 0u32;
        let mut skipped_path_missing = 0u32;

        for (id, anchor) in &mesh.anchors_v2 {
            let Some(new_sha) = map.get(&anchor.anchor_sha) else {
                // Not in map — carry over unchanged.
                new_anchors.push((id.clone(), anchor.clone()));
                continue;
            };

            // Try to read blob at old_sha and new_sha.
            let old_blob = git::path_blob_at(repo, &anchor.anchor_sha, &anchor.path);
            let new_blob = git::path_blob_at(repo, new_sha, &anchor.path);

            match (old_blob, new_blob) {
                (Ok(ob), Ok(nb)) => {
                    if ob != nb {
                        // Blob changed — skip.
                        anchor_records.push(AnchorRewriteRecord {
                            anchor_id: id.clone(),
                            outcome: AnchorRewriteOutcome::SkippedBlobChanged,
                            old_sha: anchor.anchor_sha.clone(),
                            new_sha: Some(new_sha.clone()),
                            path: anchor.path.clone(),
                        });
                        skipped_blob_changed += 1;
                        new_anchors.push((id.clone(), anchor.clone()));
                    } else {
                        // Advance.
                        let advanced_anchor = crate::types::Anchor {
                            anchor_sha: new_sha.clone(),
                            created_at: anchor.created_at.clone(),
                            path: anchor.path.clone(),
                            extent: anchor.extent,
                            blob: anchor.blob.clone(),
                        };
                        anchor_records.push(AnchorRewriteRecord {
                            anchor_id: id.clone(),
                            outcome: AnchorRewriteOutcome::Advanced,
                            old_sha: anchor.anchor_sha.clone(),
                            new_sha: Some(new_sha.clone()),
                            path: anchor.path.clone(),
                        });
                        advanced += 1;
                        new_anchors.push((id.clone(), advanced_anchor));
                    }
                }
                _ => {
                    // Path missing at either old or new.
                    anchor_records.push(AnchorRewriteRecord {
                        anchor_id: id.clone(),
                        outcome: AnchorRewriteOutcome::SkippedPathMissing,
                        old_sha: anchor.anchor_sha.clone(),
                        new_sha: Some(new_sha.clone()),
                        path: anchor.path.clone(),
                    });
                    skipped_path_missing += 1;
                    new_anchors.push((id.clone(), anchor.clone()));
                }
            }
        }

        if advanced == 0 {
            return Ok(RewriteOutcome {
                name: name.to_string(),
                advanced: 0,
                skipped_blob_changed,
                skipped_path_missing,
                errors: 0,
                anchors: anchor_records,
                hard_error: None,
            });
        }

        // Sort by (path, extent) like compact does.
        new_anchors.sort_by(|a, b| {
            (a.1.path.as_str(), extent_sort_key(&a.1.extent))
                .cmp(&(b.1.path.as_str(), extent_sort_key(&b.1.extent)))
        });

        // Catalog write path: insert updated mesh into catalog and CAS commit.
        let catalog_ref_oid = resolve_ref_oid_optional_repo(repo, CATALOG_REF)?;
        let mut catalog = Catalog::load(repo)?;
        let updated_mesh = catalog::build_mesh(name, &mesh.message, &new_anchors, &mesh.config);
        catalog.insert(name, &updated_mesh)?;
        match catalog::commit_catalog(
            repo,
            &catalog,
            &mesh.message,
            catalog_ref_oid.as_deref(),
        ) {
            Ok(_new_commit) => {
                return Ok(RewriteOutcome {
                    name: name.to_string(),
                    advanced,
                    skipped_blob_changed,
                    skipped_path_missing,
                    errors: 0,
                    anchors: anchor_records,
                    hard_error: None,
                });
            }
            Err(_) => {
                attempt += 1;
                if attempt >= MAX_RETRIES {
                    return Ok(RewriteOutcome {
                        name: name.to_string(),
                        advanced: 0,
                        skipped_blob_changed,
                        skipped_path_missing,
                        errors: 1,
                        anchors: anchor_records,
                        hard_error: Some("CAS conflict exhausted retries".into()),
                    });
                }
                // CAS conflict — reload catalog and retry.
                continue;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers.
// ---------------------------------------------------------------------------

fn extent_sort_key(extent: &crate::types::AnchorExtent) -> (u32, u32) {
    match *extent {
        crate::types::AnchorExtent::WholeFile => (0, 0),
        crate::types::AnchorExtent::LineRange { start, end } => (start, end),
    }
}
