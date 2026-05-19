//! Phase 6: file-backed SQLite stale cache (`cache_v2`).
//!
//! This module supersedes the old catalog-keyed `resolver::persist`
//! cache. It is the single live cache path for `git mesh stale`. There
//! is no fallback to the removed catalog-keyed schema: correctness
//! comes from key-based invalidation, and a miss falls back to the
//! uncached resolver (`stale_meshes_inner`), never to old rows.
//!
//! ## Keys
//!
//! `mesh_tree_key` is the tree object id of the configured mesh root at
//! `HEAD` (or the empty-tree sentinel when absent), replacing the
//! removed `catalog_tree_oid`. The committed key is
//! `(source_tree_key, mesh_tree_key, mesh_root, filter_config_hash,
//! key_salt)`; the dirty overlay key folds in exact staged/worktree
//! content identities and the index checksum.
//!
//! ## Paths
//!
//! * **Warm clean** — keys resolve, no dirty mesh/source files, the
//!   committed manifest is complete: load non-`Fresh` finding rows and
//!   render. Targets `<100ms`.
//! * **Warm dirty** — load committed findings, find anchors affected by
//!   dirty paths/mesh files, load-or-build the row-level overlay, merge,
//!   render.
//! * **Cold / invalidated** — build the committed baseline (and overlay)
//!   from a full resolution and persist it row-level.
//!
//! `moved` (lazy moved-location rows) is provided for the resolver's
//! moved-check acceleration; the per-anchor moved classification itself
//! is already file-backed in `resolver::engine`.

#![allow(dead_code)]

pub(crate) mod baseline;
pub(crate) mod dto;
pub(crate) mod keys;
pub(crate) mod moved;
pub(crate) mod overlay;
pub(crate) mod schema;

#[cfg(test)]
mod tests;

use crate::types::{EngineOptions, LayerSet, MeshResolved};
use crate::{Error, Result};
use baseline::{load_baseline, store_baseline};
use keys::{
    CommittedKey, OverlayKeyInputs, availability_hash, content_identity_fingerprint,
    index_checksum_bytes,
};
use overlay::{DirtyOverlay, apply_overlay, load_overlay, store_overlay};
use schema::{KEY_SALT, hex32, open_cache};
use std::collections::{BTreeSet, HashSet};

/// Tree object id of the mesh root at `HEAD`, or the empty-tree
/// sentinel when the mesh root is absent at `HEAD`.
fn mesh_tree_key(repo: &gix::Repository, mesh_root: &str) -> Result<String> {
    match crate::git::tree_entry_at(repo, "HEAD", std::path::Path::new(mesh_root))? {
        Some((mode, oid)) if mode.is_tree() => Ok(oid.to_string()),
        _ => Ok(keys::EMPTY_TREE_HEX.to_string()),
    }
}

/// Tree object id of the `HEAD` commit — the source tree key.
fn source_tree_key(repo: &gix::Repository) -> Result<String> {
    let head = repo
        .head_commit()
        .map_err(|e| Error::Git(format!("cache_v2 head commit: {e}")))?;
    let tree = head
        .tree_id()
        .map_err(|e| Error::Git(format!("cache_v2 head tree: {e}")))?;
    Ok(tree.detach().to_string())
}

/// Eligibility gate mirroring the resolver's cached-path gate: only the
/// full layer set with no `--since` participates in the cache.
fn ineligible_reason(options: EngineOptions) -> Option<&'static str> {
    if options.since.is_some() {
        return Some("since-option");
    }
    if options.layers != LayerSet::full() {
        return Some("non-full-layer-set");
    }
    None
}

fn is_gitattributes_path(path: &str) -> bool {
    std::path::Path::new(path)
        .components()
        .any(|c| c.as_os_str() == std::ffi::OsStr::new(".gitattributes"))
}

/// Outcome of a cache attempt: a resolved render set, or a reason the
/// caller must fall back to the uncached resolver.
pub(crate) enum CacheAttempt {
    Resolved(Vec<MeshResolved>),
    Fallback(String),
}

/// Attempt to satisfy `git mesh stale` from the file-backed cache.
///
/// Returns [`CacheAttempt::Resolved`] with the reportable mesh set on a
/// cache hit (warm clean or warm dirty) or after a cold rebuild;
/// [`CacheAttempt::Fallback`] when the run is ineligible or any cache
/// operation fails (the caller then runs the uncached resolver).
pub(crate) fn stale_meshes_cached(
    repo: &gix::Repository,
    options: EngineOptions,
) -> Result<CacheAttempt> {
    let _perf = crate::perf::span("resolver.cache_v2");
    if let Some(reason) = ineligible_reason(options) {
        return Ok(CacheAttempt::Fallback(reason.to_string()));
    }

    let mesh_root = crate::mesh_root::resolve_mesh_root(repo, None, None)
        .unwrap_or_else(|_| ".mesh".to_string());

    let db = match open_cache(repo) {
        Ok(db) => db,
        Err(e) => return Ok(CacheAttempt::Fallback(format!("open-cache: {e}"))),
    };

    let committed = CommittedKey {
        source_tree_key: source_tree_key(repo)?,
        mesh_tree_key: mesh_tree_key(repo, &mesh_root)?,
        mesh_root: mesh_root.clone(),
        filter_config_hash: schema::filter_config_hash(repo),
        key_salt: KEY_SALT,
    };
    // Availability inputs: LFS install + sparse/promisor activity. These
    // gate cached `ContentUnavailable` results.
    let availability = availability_hash(
        lfs_installed(),
        sparse_active(repo),
        promisor_active(repo),
    );
    let availability_hex = hex32(&availability);

    // ── Committed baseline (load or cold-build) ───────────────────────
    let baseline = {
        let _perf = crate::perf::span("resolver.cache_v2.baseline");
        match load_baseline(&db, &committed, &availability_hex) {
            Ok(Some(b)) => {
                crate::perf::counter("cache_v2.baseline-hit", 1);
                b
            }
            Ok(None) => {
                crate::perf::counter("cache_v2.baseline-miss", 1);
                let meshes = match build_committed_meshes(repo) {
                    Ok(m) => m,
                    Err(e) => {
                        return Ok(CacheAttempt::Fallback(format!(
                            "build-baseline: {e}"
                        )));
                    }
                };
                if let Err(e) =
                    store_baseline(&db, &committed, &availability_hex, &meshes)
                {
                    crate::perf::note(&format!("cache_v2.store-baseline-failed: {e}"));
                }
                // Reload so the in-memory shape matches the cached one
                // exactly (regrouped reportable form).
                match load_baseline(&db, &committed, &availability_hex) {
                    Ok(Some(b)) => b,
                    _ => baseline::LoadedBaseline {
                        meshes: reportable(meshes),
                        ..Default::default()
                    },
                }
            }
            Err(e) => return Ok(CacheAttempt::Fallback(format!("load-baseline: {e}"))),
        }
    };

    // ── Dirty detection ───────────────────────────────────────────────
    let layer_status = match super::layers::read_layer_status(repo) {
        Ok(s) => s,
        Err(e) => return Ok(CacheAttempt::Fallback(format!("layer-status: {e}"))),
    };
    if layer_status.requires_full_scan {
        return Ok(CacheAttempt::Fallback("dirty-set-requires-full-scan".into()));
    }
    let index_trailer = super::layers::read_index_trailer(repo).ok();
    let conflicted = if layer_status.has_unmerged {
        match super::layers::read_conflicted_paths(repo) {
            Ok(p) => p,
            Err(e) => return Ok(CacheAttempt::Fallback(format!("conflicts: {e}"))),
        }
    } else {
        HashSet::new()
    };

    let mut dirty_paths: BTreeSet<String> = BTreeSet::new();
    dirty_paths.extend(layer_status.worktree_paths.iter().cloned());
    dirty_paths.extend(conflicted.iter().cloned());

    let mut index_warnings = Vec::new();
    if layer_status.index_dirty {
        match super::layers::read_index_layer(repo, &mut index_warnings) {
            Ok(diffs) => dirty_paths.extend(diffs.map.keys().cloned()),
            Err(e) => {
                return Ok(CacheAttempt::Fallback(format!("index-layer: {e}")));
            }
        }
    }
    if dirty_paths.iter().any(|p| is_gitattributes_path(p)) {
        return Ok(CacheAttempt::Fallback(
            "dirty-gitattributes-changes-filtering".into(),
        ));
    }

    let clean = !layer_status.index_dirty
        && layer_status.worktree_paths.is_empty()
        && !layer_status.has_unmerged
        && dirty_paths.is_empty();

    // ── Warm clean path ───────────────────────────────────────────────
    if clean {
        crate::perf::counter("cache_v2.warm-clean", 1);
        crate::perf::counter("cache_v2.fallback", 0);
        for w in index_warnings {
            eprintln!("{w}");
        }
        return Ok(CacheAttempt::Resolved(reportable(baseline.meshes)));
    }

    // ── Warm dirty path ───────────────────────────────────────────────
    crate::perf::counter("cache_v2.warm-dirty", 1);

    // Anchors affected by the dirty source paths or dirty mesh files.
    let affected_meshes = match meshes_affected_by(repo, &dirty_paths, &mesh_root) {
        Ok(set) => set,
        Err(e) => return Ok(CacheAttempt::Fallback(format!("affected: {e}"))),
    };
    crate::perf::counter("cache_v2.affected-meshes", affected_meshes.len() as u64);

    // Overlay key: committed digest + index checksum + exact dirty
    // mesh-file and source-file content identities + layer identity.
    let workdir = crate::git::work_dir(repo)?;
    let dirty_source_fp = content_identity_fingerprint(
        b"gm.cache_v2.dirty-source\0",
        dirty_paths
            .iter()
            .map(|p| (p.as_str(), p.as_str()))
            .collect::<Vec<_>>(),
    );
    let dirty_mesh_ids: Vec<(String, String)> = affected_meshes
        .iter()
        .map(|n| {
            let rel = format!("{mesh_root}/{n}");
            let id = file_content_identity(workdir, &rel);
            (rel, id)
        })
        .collect();
    let dirty_mesh_fp = content_identity_fingerprint(
        b"gm.cache_v2.dirty-mesh\0",
        dirty_mesh_ids
            .iter()
            .map(|(p, i)| (p.as_str(), i.as_str()))
            .collect::<Vec<_>>(),
    );

    let mut overlay_inputs = OverlayKeyInputs::new(&committed);
    overlay_inputs.index_checksum =
        index_checksum_bytes(index_trailer, layer_status.index_dirty);
    overlay_inputs.dirty_source_fingerprint = dirty_source_fp;
    overlay_inputs.dirty_mesh_fingerprint = dirty_mesh_fp;
    // Layer identity: full effective view; tombstone state folds into
    // the affected-mesh identities above. A constant domain marks the
    // read mode so a future `--staged`/`--head` mode gets a distinct key.
    overlay_inputs.layer_fingerprint =
        content_identity_fingerprint(b"gm.cache_v2.mode.effective\0", []);

    let overlay = {
        let _perf = crate::perf::span("resolver.cache_v2.overlay");
        match load_overlay(&db, &overlay_inputs) {
            Ok(Some(o)) => {
                crate::perf::counter("cache_v2.overlay-hit", 1);
                o
            }
            Ok(None) => {
                crate::perf::counter("cache_v2.overlay-miss", 1);
                let names: Vec<String> = affected_meshes.iter().cloned().collect();
                let meshes = if names.is_empty() {
                    Vec::new()
                } else {
                    match super::engine::resolve_named_meshes(repo, &names, options) {
                        Ok(resolved) => {
                            let mut out = Vec::new();
                            for (_n, r) in resolved {
                                match r {
                                    Ok(m) => out.push(m),
                                    Err(Error::MeshNotFound(_)) => {}
                                    Err(e) => {
                                        return Ok(CacheAttempt::Fallback(format!(
                                            "resolve-overlay: {e}"
                                        )));
                                    }
                                }
                            }
                            out
                        }
                        Err(e) => {
                            return Ok(CacheAttempt::Fallback(format!(
                                "resolve-overlay: {e}"
                            )));
                        }
                    }
                };
                let o = DirtyOverlay {
                    affected_meshes: names,
                    meshes,
                };
                if let Err(e) = store_overlay(&db, &overlay_inputs, &o) {
                    crate::perf::note(&format!("cache_v2.store-overlay-failed: {e}"));
                }
                o
            }
            Err(e) => return Ok(CacheAttempt::Fallback(format!("load-overlay: {e}"))),
        }
    };

    // Guard: the index must not have changed under us mid-run.
    if let Some(start) = index_trailer
        && let Ok(end) = super::layers::read_index_trailer(repo)
        && end != start
    {
        return Ok(CacheAttempt::Fallback("index-changed-mid-run".into()));
    }

    for w in index_warnings {
        eprintln!("{w}");
    }
    let merged = apply_overlay(&baseline.meshes, &overlay);
    crate::perf::counter("cache_v2.fallback", 0);
    Ok(CacheAttempt::Resolved(reportable(merged)))
}

/// Keep only meshes that have a non-`Fresh` anchor or a pending op —
/// the same predicate the engine uses for stale discovery output.
fn reportable(meshes: Vec<MeshResolved>) -> Vec<MeshResolved> {
    meshes
        .into_iter()
        .filter(|m| {
            m.anchors
                .iter()
                .any(|a| a.status != crate::types::AnchorStatus::Fresh)
                || !m.pending.is_empty()
        })
        .collect()
}

/// Full HEAD-only resolution of every visible mesh — the cold-build
/// input for the committed baseline.
fn build_committed_meshes(repo: &gix::Repository) -> Result<Vec<MeshResolved>> {
    let _perf = crate::perf::span("resolver.cache_v2.build-baseline");
    let pairs = crate::mesh::read::load_all_meshes(repo)?;
    let names: Vec<String> = pairs.into_iter().map(|(n, _)| n).collect();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let resolved = super::engine::resolve_named_meshes(
        repo,
        &names,
        EngineOptions {
            layers: LayerSet::committed_only(),
            ignore_unavailable: false,
            since: None,
            needs_all_layers: true,
        },
    )?;
    let mut out = Vec::with_capacity(resolved.len());
    for (name, r) in resolved {
        match r {
            Ok(m) => out.push(m),
            Err(Error::MeshNotFound(_)) => {}
            Err(e) => return Err(Error::Git(format!("cache_v2 baseline `{name}`: {e}"))),
        }
    }
    Ok(out)
}

/// Mesh names with at least one anchor whose source path is dirty, plus
/// any mesh whose own mesh file is dirty (so a mesh-file edit
/// re-resolves that mesh).
fn meshes_affected_by(
    repo: &gix::Repository,
    dirty_paths: &BTreeSet<String>,
    mesh_root: &str,
) -> Result<BTreeSet<String>> {
    let mut affected: BTreeSet<String> = BTreeSet::new();
    let prefix = format!("{mesh_root}/");
    for p in dirty_paths {
        if let Some(rest) = p.strip_prefix(&prefix) {
            affected.insert(rest.to_string());
        }
    }
    if !dirty_paths.is_empty() {
        for (name, mesh) in crate::mesh::read::load_all_meshes(repo)? {
            if mesh
                .anchors
                .iter()
                .any(|(_, a)| dirty_paths.contains(&a.path))
            {
                affected.insert(name);
            }
        }
    }
    Ok(affected)
}

/// Exact content identity for a worktree file: a digest of its bytes,
/// or a stable `"absent"` marker. Used so the overlay key changes
/// whenever a dirty mesh file's content changes.
fn file_content_identity(workdir: &std::path::Path, rel: &str) -> String {
    match std::fs::read(workdir.join(rel)) {
        Ok(bytes) => hex32(blake3::hash(&bytes).as_bytes()),
        Err(_) => "absent".to_string(),
    }
}

fn lfs_installed() -> bool {
    std::process::Command::new("git")
        .args(["lfs", "version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn sparse_active(repo: &gix::Repository) -> bool {
    crate::git::common_dir(repo)
        .join("info")
        .join("sparse-checkout")
        .exists()
}

fn promisor_active(repo: &gix::Repository) -> bool {
    let od = crate::git::common_dir(repo).join("objects");
    std::fs::read_dir(od.join("info"))
        .map(|rd| {
            rd.flatten().any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("promisor")
            })
        })
        .unwrap_or(false)
}

/// Best-effort cache gc. Never required for correctness.
pub(crate) fn gc(repo: &gix::Repository, max_age_secs: i64) -> Result<()> {
    let db = open_cache(repo)?;
    db.gc(max_age_secs)
}
