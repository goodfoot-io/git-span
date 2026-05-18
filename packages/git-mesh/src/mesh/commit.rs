//! Mesh commit pipeline — §6.1, §6.2.

use crate::anchor::create_anchor_with_extent_skipping_blob_bounds;
use crate::git::{self};
use crate::mesh::catalog::{Catalog, CATALOG_REF};
use crate::mesh_file::{AnchorRecord, MeshFile};
use crate::staging::{self, StagedConfig};
use crate::types::{AnchorExtent, MeshConfig};
use crate::validation::validate_mesh_name;
use crate::{Error, Result};

pub fn commit_mesh(repo: &gix::Repository, name: &str) -> Result<String> {
    validate_mesh_name(name)?;
    let staging = staging::read_staging(repo, name)?;

    // Detect mesh name collisions before any I/O.
    check_prefix_collision(repo, name)?;

    // Load current state from catalog.
    let (anchor_v2_records, base_config, base_message) = {
        let cat = Catalog::load(repo)?;
        match cat.lookup(name)? {
            Some(m) => (m.anchors, m.config, Some(m.message)),
            None => (
                Vec::new(),
                MeshConfig {
                    copy_detection: crate::types::DEFAULT_COPY_DETECTION,
                    ignore_whitespace: crate::types::DEFAULT_IGNORE_WHITESPACE,
                    follow_moves: crate::types::DEFAULT_FOLLOW_MOVES,
                },
                None,
            ),
        }
    };

    // ── File-backed model ──────────────────────────────────────────
    // Read the worktree .mesh/<name> file for the desired anchor set
    // and why text. This file is the source of truth for what the mesh
    // should contain after committing. Staging is used only for config
    // changes (git mesh config still writes to staging).
    let head_sha = git::head_oid(repo)?;
    let worktree_mesh: Option<MeshFile> = match repo.workdir() {
        Some(wd) => {
            let p = wd.join(".mesh").join(name);
            if p.exists() {
                std::fs::read_to_string(&p)
                    .ok()
                    .and_then(|s| MeshFile::parse(&s).ok())
            } else {
                None
            }
        }
        None => None,
    };

    // Build the desired (path, extent) set from the worktree mesh file.
    // When no .mesh/ file exists, use the catalog anchors as the desired
    // set (handles re-commit of a previously committed mesh).
    let (desired, desired_why): (Vec<(String, AnchorExtent)>, Option<String>) = match &worktree_mesh
    {
        Some(mf) => {
            let why = if mf.why.is_empty() {
                None
            } else {
                Some(mf.why.clone())
            };
            let mut v: Vec<(String, AnchorExtent)> = Vec::with_capacity(mf.anchors.len());
            for a in &mf.anchors {
                let extent = if a.start_line == 0 && a.end_line == 0 {
                    AnchorExtent::WholeFile
                } else {
                    AnchorExtent::LineRange {
                        start: a.start_line,
                        end: a.end_line,
                    }
                };
                // Last-write-wins dedup within file (later entries override).
                let key = (a.path.clone(), extent);
                if let Some(pos) = v.iter().position(|(p, e)| p == &key.0 && e == &key.1) {
                    v.remove(pos);
                }
                v.push(key);
            }
            // Apply staging adds/removes on top of the .mesh/ file content.
            for r in &staging.removes {
                let key = (r.path.clone(), r.extent);
                v.retain(|(p, e)| *p != key.0 || *e != key.1);
            }
            for a in &staging.adds {
                let key = (a.path.clone(), a.extent);
                v.retain(|(p, e)| *p != key.0 || *e != key.1);
                v.push(key);
            }
            // Staging why wins over .mesh/ file why (same semantics as
            // the fallback None branch).
            let why = staging.why.clone().or_else(|| why);
            (v, why)
        }
        None => {
            // Fallback when no .mesh/ worktree file exists: merge catalog
            // anchors with staging adds/removes. Staging adds win over
            // catalog for the same (path, extent).
            let why = staging.why.clone().or_else(|| base_message.clone());

            // Start with catalog anchors.
            let mut v: Vec<(String, AnchorExtent)> = anchor_v2_records
                .iter()
                .map(|(_, a)| (a.path.clone(), a.extent))
                .collect();

            // Apply removes: remove matching (path, extent).
            for r in &staging.removes {
                let key = (r.path.clone(), r.extent);
                v.retain(|(p, e)| *p != key.0 || *e != key.1);
            }

            // Apply adds: append (deduped by last-write-wins).
            for a in &staging.adds {
                let key = (a.path.clone(), a.extent);
                // Remove any existing entry for the same (path, extent).
                v.retain(|(p, e)| *p != key.0 || *e != key.1);
                v.push(key);
            }

            (v, why)
        }
    };

    // Resolve final config: baseline <- staged (last-write-wins).
    let mut new_config = base_config;
    let (new_cd, new_iw, new_fm) = staging::resolve_staged_config(
        &staging,
        (
            base_config.copy_detection,
            base_config.ignore_whitespace,
            base_config.follow_moves,
        ),
    );
    new_config.copy_detection = new_cd;
    new_config.ignore_whitespace = new_iw;
    new_config.follow_moves = new_fm;

    // Detect whether anything meaningful changed.
    let config_changed = new_config != base_config;

    // Compare the desired (path, extent) set with the catalog anchors.
    let desired_set: std::collections::BTreeSet<(String, AnchorExtent)> = desired
        .iter()
        .map(|(p, e)| (p.clone(), *e))
        .collect();
    let catalog_set: std::collections::BTreeSet<(String, AnchorExtent)> = anchor_v2_records
        .iter()
        .map(|(_, a)| (a.path.clone(), a.extent))
        .collect();
    let anchors_changed = desired_set != catalog_set;

    let message_changed = match (&desired_why, &base_message) {
        (Some(w), Some(b)) => w != b,
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (None, None) => false,
    };

    if !anchors_changed && !config_changed && !message_changed {
        // Edge case: only staged configs that produce no change.
        if let Some(first) = staging.configs.first() {
            let (key, value) = match first {
                StagedConfig::CopyDetection(cd) => (
                    "copy-detection",
                    staging::serialize_copy_detection(*cd).to_string(),
                ),
                StagedConfig::IgnoreWhitespace(b) => ("ignore-whitespace", b.to_string()),
                StagedConfig::FollowMoves(b) => ("follow-moves", b.to_string()),
            };
            return Err(Error::ConfigNoOp {
                key: key.into(),
                value,
            });
        }
        return Err(Error::StagingEmpty(name.into()));
    }

    // Determine the git commit message: worktree why wins, else staging why
    // (old model), else inherit the parent mesh commit's message, else
    // hard-fail with `WhyRequired`.
    const FOLLOW_SUBJECT_PREFIX: &str = "mesh: follow ";
    let why_text: Option<String> = desired_why.clone().or_else(|| staging.why.clone());
    let message = match (&why_text, &base_message) {
        (Some(w), _) if !w.is_empty() => {
            // Reject a why whose first line begins with the reserved
            // prefix used by auto-follow commits. Allowing it would cause
            // `why_walking_past_follows` to silently skip the user's
            // commit and surface an older why instead.
            if w.lines().next().unwrap_or("").starts_with(FOLLOW_SUBJECT_PREFIX) {
                return Err(Error::ReservedWhyPrefix {
                    prefix: FOLLOW_SUBJECT_PREFIX.to_string(),
                });
            }
            w.clone()
        }
        // Fall through: w is Some but empty (treat as absent).
        (None, Some(prior)) | (Some(_), Some(prior)) => prior.clone(),
        (None, None) | (Some(_), None) => {
            return Err(Error::WhyRequired(name.into()))
        }
    };

    // Build the combined anchor list. In the file-backed model, the
    // .mesh/<name> file is the source of truth: every desired anchor
    // gets a fresh Anchor record created from the current HEAD state.
    let mut new_anchors: Vec<(String, crate::types::Anchor)> =
        Vec::with_capacity(desired.len());
    for (path, extent) in &desired {
        let (id, anchor_rec) = create_anchor_with_extent_skipping_blob_bounds(
            repo,
            &head_sha,
            path,
            *extent,
        )?;
        new_anchors.push((id, anchor_rec));
    }

    new_anchors.sort_by(|a, b| {
        (a.1.path.as_str(), extent_sort_key(&a.1.extent))
            .cmp(&(b.1.path.as_str(), extent_sort_key(&b.1.extent)))
    });

    // CAS commit to catalog with retries.
    const MAX_RETRIES: usize = 5;
    let new_commit: String;
    let mut attempt: usize = 0;
    loop {
        let current_ref =
            crate::git::resolve_ref_oid_optional_repo(repo, CATALOG_REF)?;
        let mut catalog = Catalog::load(repo)?;

        let mesh = crate::mesh::catalog::build_mesh(
            name, &message, &new_anchors, &new_config,
        );
        catalog.insert(name, &mesh)?;

        match crate::mesh::catalog::commit_catalog(
            repo,
            &catalog,
            &message,
            current_ref.as_deref(),
        ) {
            Ok(commit_oid) => {
                new_commit = commit_oid;
                break;
            }
            Err(_e) => {
                attempt += 1;
                if attempt >= MAX_RETRIES {
                    let found =
                        crate::git::resolve_ref_oid_optional_repo(repo, CATALOG_REF)?
                            .unwrap_or_default();
                    return Err(Error::ConcurrentUpdate {
                        expected: current_ref.unwrap_or_default(),
                        found,
                    });
                }
                // CAS conflict — reload catalog and retry.
                continue;
            }
        }
    }

    // Update path index refs now that the catalog commit succeeded.
    let path_updates = super::path_index::ref_updates_for_mesh(
        repo,
        name,
        &anchor_v2_records,
        &new_anchors,
    )?;
    if !path_updates.is_empty() {
        crate::git::ensure_log_all_ref_updates_always(repo)?;
        crate::git::apply_ref_transaction_repo(repo, &path_updates)?;
    }

    // Clear staging (configs) on success.
    let _ = staging::clear_staging(repo, name);

    // Write worktree mesh file with committed data.
    if let Some(workdir) = repo.workdir() {
        let mesh_path = workdir.join(".mesh").join(name);
        if let Some(parent) = mesh_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let anchor_records: Vec<AnchorRecord> = new_anchors
            .iter()
            .map(|(_, a)| {
                let (start_line, end_line) = match a.extent {
                    AnchorExtent::LineRange { start, end } => (start, end),
                    AnchorExtent::WholeFile => (0, 0),
                };
                // Compute stored_hash from blob if not already set. The
                // canonical hashed bytes must match the resolver's
                // file-backed comparison: whole-file anchors hash the
                // entire blob; line anchors hash the `\n`-joined slice of
                // lines `[start, end]`.
                let stored_hash = if a.stored_hash.is_empty() && !a.blob.is_empty() {
                    let text =
                        crate::git::read_git_text(repo, &a.blob).unwrap_or_default();
                    let hashed: String = match a.extent {
                        AnchorExtent::WholeFile => text,
                        AnchorExtent::LineRange { start, end } => {
                            let lines: Vec<&str> = text.lines().collect();
                            let lo = (start as usize).saturating_sub(1);
                            let hi = (end as usize).min(lines.len());
                            if lo < hi {
                                lines[lo..hi].join("\n")
                            } else {
                                String::new()
                            }
                        }
                    };
                    format!("sha256:{}", crate::staging::sha256_hex(hashed.as_bytes()))
                } else {
                    a.stored_hash.clone()
                };
                let (algorithm, content_hash) = match stored_hash.split_once(':') {
                    Some((alg, hash)) => (alg.to_string(), hash.to_string()),
                    None => ("sha256".to_string(), stored_hash),
                };
                AnchorRecord {
                    path: a.path.clone(),
                    start_line,
                    end_line,
                    algorithm,
                    content_hash,
                }
            })
            .collect();
        let mesh_file = MeshFile {
            anchors: anchor_records,
            why: message.clone(),
        };
        let _ = std::fs::write(&mesh_path, mesh_file.serialize());
    }

    Ok(new_commit)
}

fn extent_sort_key(extent: &AnchorExtent) -> (u32, u32) {
    match *extent {
        AnchorExtent::WholeFile => (0, 0),
        AnchorExtent::LineRange { start, end } => (start, end),
    }
}

/// Refuse a commit whose name would collide with an existing mesh name.
/// The collision is symmetric: `name = "a/b"` cannot coexist with `"a"`,
/// and `name = "a"` cannot coexist with `"a/b"`.
fn check_prefix_collision(repo: &gix::Repository, name: &str) -> Result<()> {
    let catalog = Catalog::load(repo)?;
    let existing = catalog.names();
    for other in existing {
        if other == name {
            continue;
        }
        // `other` is a strict ancestor of `name`.
        if let Some(rest) = name.strip_prefix(&other)
            && rest.starts_with('/')
        {
            return Err(Error::MeshNameCollidesWithExistingMesh {
                staged: name.to_string(),
                blocking: other,
            });
        }
        // `other` is a strict descendant of `name`.
        if let Some(rest) = other.strip_prefix(name)
            && rest.starts_with('/')
        {
            return Err(Error::MeshNameCollidesWithExistingMesh {
                staged: name.to_string(),
                blocking: other,
            });
        }
    }
    Ok(())
}

