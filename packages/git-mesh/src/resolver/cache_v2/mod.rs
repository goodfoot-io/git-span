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

pub(crate) use baseline::WholeResult;

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
    Resolved {
        meshes: Vec<MeshResolved>,
        whole_result: Option<WholeResult>,
    },
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
    mesh_root: &str,
    options: EngineOptions,
) -> Result<CacheAttempt> {
    let _perf = crate::perf::span("resolver.cache_v2");
    if std::env::var("GIT_MESH_CACHE_V2").as_deref() == Ok("0") {
        return Ok(CacheAttempt::Fallback("disabled-by-env".into()));
    }
    if let Some(reason) = ineligible_reason(options) {
        return Ok(CacheAttempt::Fallback(reason.to_string()));
    }

    // The mesh root is resolved once in `cli::dispatch` (the single
    // precedence chain) and threaded here so the cache is keyed and
    // populated against the same root the writer and all readers use
    // (F1) — not a hardcoded `.mesh`.
    let mesh_root = mesh_root.to_string();

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
    // gate cached `ContentUnavailable` results. LFS detection scans the
    // actual anchored corpus (committed `.gitattributes` in any ancestor
    // directory of an anchored path, plus any anchored file whose committed
    // blob is itself an LFS pointer), not only the root `.gitattributes` —
    // a subdirectory `.gitattributes` or a pointer blob committed without
    // root attributes must still force the `git lfs version` probe so a
    // cached `ContentUnavailable` cannot survive an LFS install.
    let corpus_has_lfs = corpus_has_lfs(repo, &mesh_root);
    let availability =
        availability_hash(lfs_installed(corpus_has_lfs), sparse_active(repo), promisor_active(repo));
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
                let meshes = match build_committed_meshes(repo, &mesh_root) {
                    Ok(m) => m,
                    Err(e) => {
                        return Ok(CacheAttempt::Fallback(format!("build-baseline: {e}")));
                    }
                };
                if let Err(e) = store_baseline(&db, &committed, &availability_hex, &meshes) {
                    crate::perf::note(&format!("cache_v2.store-baseline-failed: {e}"));
                }
                // The whole-result entry is NOT stored here. The cold
                // baseline build can run on a DIRTY tree (any baseline miss
                // builds it, regardless of worktree state), and the
                // whole-result render must be byte-identical to the effective
                // cache-off resolution — which reads source content from the
                // worktree. Storing an effective render under the
                // committed-only key while the tree is dirty would freeze
                // worktree drift into a committed-keyed entry (an F1-class
                // bug). The whole result is therefore built and stored only
                // on the warm-CLEAN path below, where the effective and
                // committed-key views coincide by construction.
                //
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
        return Ok(CacheAttempt::Fallback(
            "dirty-set-requires-full-scan".into(),
        ));
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

    // Uncommitted mesh files that `git status -uno` never reports — every
    // worktree mesh file absent from HEAD (untracked, including
    // gitignored). The committed baseline only contains HEAD meshes, so
    // these must enter the dirty-overlay path to be surfaced at all; and
    // marking them dirty is what later lets a deleted untracked mesh drop
    // out of the result (gone from the worktree ⇒ not dirty ⇒ not in the
    // overlay ⇒ not rendered), instead of being replayed from the cache.
    match uncommitted_mesh_paths(repo, &mesh_root) {
        Ok(paths) => dirty_paths.extend(paths),
        Err(e) => {
            return Ok(CacheAttempt::Fallback(format!(
                "uncommitted-mesh-scan: {e}"
            )));
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
        // The render input must carry the full anchor set (Fresh +
        // non-Fresh) and must be BYTE-IDENTICAL to the effective cache-off
        // resolution (`stale_meshes_inner`), across Human, JSON, and
        // porcelain. The row-level committed baseline (committed_only) is
        // *not* sufficient: on a HEAD-committed CHANGED anchor it fills
        // `current.blob` with the HEAD blob and labels interior-anchor drift
        // "changed" rather than "changed in the working tree", both of which
        // diverge from the effective resolver.
        //
        // The tree is clean here, so the effective and committed-key views
        // coincide: an effective resolution over the committed mesh names
        // produces exactly what cache-off produces, and is safe to store
        // under the committed key. Reuse a stored whole result when present
        // (a prior clean run built it); otherwise build it now from the
        // effective resolution, store it (unless the corpus carries an
        // interior anchor — see below), and render from it.
        let whole_result = match baseline.whole_result {
            Some(wr) => Some(wr),
            None => {
                match build_clean_whole_result(repo, &mesh_root, options) {
                    Ok(Some((wr, has_interior_anchor))) => {
                        // Fail-closed: never STORE a whole result for a
                        // corpus that carries an interior anchor. A
                        // whole-result hit lets run_stale skip its
                        // per-invocation interior-anchor scan (the cached
                        // result is presumed clean), but the whole result
                        // persists no violation record — caching a poisoned
                        // corpus would silently drop the loud interior-anchor
                        // report on every subsequent run. We still RENDER from
                        // the freshly-built effective result this run (so the
                        // drift labels match cache-off); we just do not
                        // persist it.
                        if !has_interior_anchor {
                            if let Err(e) = baseline::store_whole_result(
                                &db,
                                &committed,
                                &wr.meshes,
                                &wr.mesh_anchor_totals,
                            ) {
                                crate::perf::note(&format!(
                                    "cache_v2.store-whole-result-failed: {e}"
                                ));
                            }
                            Some(wr)
                        } else {
                            // Render from the effective result this run, but
                            // return `whole_result: None` so run_stale keeps
                            // its interior-anchor scan.
                            return Ok(CacheAttempt::Resolved {
                                meshes: reportable(wr.meshes),
                                whole_result: None,
                            });
                        }
                    }
                    Ok(None) => None,
                    Err(e) => {
                        return Ok(CacheAttempt::Fallback(format!(
                            "build-whole-result: {e}"
                        )));
                    }
                }
            }
        };
        let meshes = match &whole_result {
            Some(wr) => reportable(wr.meshes.clone()),
            None => reportable(baseline.meshes),
        };
        return Ok(CacheAttempt::Resolved {
            meshes,
            whole_result,
        });
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
    // Each dirty source file's identity is a digest of its worktree
    // bytes (the same content identity dirty mesh files use below), not
    // the path string — so a worktree-only edit forces a key change and
    // a recompute even when the index and commit are unchanged.
    let dirty_source_ids: Vec<(String, String)> = dirty_paths
        .iter()
        .map(|p| {
            let id = file_content_identity(workdir, p.as_str());
            (p.clone(), id)
        })
        .collect();
    let dirty_source_fp = content_identity_fingerprint(
        b"gm.cache_v2.dirty-source\0",
        dirty_source_ids
            .iter()
            .map(|(p, i)| (p.as_str(), i.as_str()))
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
    overlay_inputs.index_checksum = index_checksum_bytes(index_trailer, layer_status.index_dirty);
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
                    match super::engine::resolve_named_meshes(repo, &mesh_root, &names, options) {
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
                            return Ok(CacheAttempt::Fallback(format!("resolve-overlay: {e}")));
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

    // ── Committed render base (dirty-path parity, baseline-reuse) ─────
    // The render base here covers the UNAFFECTED meshes — the ones whose
    // anchors no dirty path touches. For such a mesh the worktree content
    // equals the committed content, so the only way effective resolution
    // diverges from the already-loaded `committed_only` baseline is the
    // worktree LAYER FLAG, not file content: it sets `current.blob = None`
    // ([anchor.rs L960]). Step 0's exhaustive field diff
    // (`notes/spike-normalization-sufficiency.md`) confirmed `current.blob`
    // is the ONLY divergent `AnchorResolved` field; `normalize_committed_anchor`
    // closes it. The within-mesh ordering divergence the SQLite-regrouped
    // baseline carries is fixed by `build_committed_render_base` reshaping to
    // committed-record order. We therefore reuse the cheap baseline instead
    // of re-resolving the whole committed corpus — warm-dirty cost now scales
    // with the dirty-mesh count, not corpus size.
    //
    // We do NOT store this render: it reflects the dirty-tree worktree-layer
    // view, and storing it under the committed key would freeze worktree
    // drift into a committed-keyed entry (an F1-class bug). The affected-mesh
    // OVERLAY is still authoritative for meshes in the dirty set (its key
    // folds in exact worktree content identities and the index checksum), so
    // we overlay it on top — and worktree-only (uncommitted) meshes, which
    // have no committed record, come solely from the overlay.
    let committed_base = match build_committed_render_base(repo, &mesh_root, &baseline.meshes) {
        Ok(meshes) => meshes,
        Err(e) => {
            return Ok(CacheAttempt::Fallback(format!(
                "build-dirty-committed-base: {e}"
            )));
        }
    };
    let merged = apply_overlay(&committed_base, &overlay);
    crate::perf::counter("cache_v2.fallback", 0);
    Ok(CacheAttempt::Resolved {
        meshes: reportable(merged),
        whole_result: None,
    })
}

/// Build the warm-clean whole-result by resolving the committed meshes with
/// the EFFECTIVE layer set, then re-shaping each mesh's anchor list to the
/// committed record. Returns `Ok(None)` only when there are no committed
/// meshes; otherwise `Ok(Some((whole_result, has_interior_anchor)))`.
///
/// The tree is clean when this runs (it is called only from the warm-clean
/// path), so the effective resolution reads the same source content the
/// committed view would — making the result byte-identical to the effective
/// cache-off path (`stale_meshes_inner`) by construction. This is what makes
/// the cached `current.blob` (F3) and interior-anchor drift label (F2) match
/// cache-off, where a `committed_only` resolution diverges.
///
/// Anchor DEFINITIONS still come from the committed mesh records (F1): each
/// resolved mesh's anchors are rebuilt from its committed record, keeping the
/// effective finding when present and synthesizing `Fresh` when absent, so the
/// committed-keyed entry never freezes a worktree-only anchor. (On a clean
/// tree the committed and effective definitions coincide; the committed-record
/// shape is retained as a defensive invariant the key depends on.)
fn build_clean_whole_result(
    repo: &gix::Repository,
    mesh_root: &str,
    options: EngineOptions,
) -> Result<Option<(WholeResult, bool)>> {
    let file_records = committed_mesh_records(repo, mesh_root)?;
    if file_records.is_empty() {
        return Ok(None);
    }

    let has_interior_anchor = file_records.values().any(|m| {
        m.anchors
            .iter()
            .any(|(_, a)| crate::mesh_root::classify_interior_anchor(mesh_root, &a.path).is_some())
    });

    let mesh_anchor_totals: Vec<(String, usize)> = file_records
        .iter()
        .map(|(n, m)| (n.clone(), m.anchors.len()))
        .collect();

    // Effective resolution over the committed mesh names. `options` is the
    // full layer set (the cache-eligibility gate rejects any non-full set),
    // so this mirrors `stale_meshes_inner`'s source resolution exactly.
    let names: Vec<String> = file_records.keys().cloned().collect();
    let resolved = super::engine::resolve_named_meshes(repo, mesh_root, &names, options)?;
    let mut resolved_by_name: std::collections::HashMap<String, MeshResolved> =
        std::collections::HashMap::with_capacity(resolved.len());
    for (name, r) in resolved {
        match r {
            Ok(m) => {
                resolved_by_name.insert(name, m);
            }
            Err(Error::MeshNotFound(_)) => {}
            Err(e) => return Err(Error::Git(format!("cache_v2 whole-result `{name}`: {e}"))),
        }
    }

    // Re-shape to the committed record (F1): one resolved mesh per committed
    // record, in committed-name order, anchors driven by the committed record.
    let mut backfilled: Vec<MeshResolved> = Vec::with_capacity(file_records.len());
    for (name, record) in &file_records {
        let resolved = resolved_by_name.get(name);
        let message = resolved
            .map(|m| m.message.clone())
            .unwrap_or_else(|| record.message.clone());
        let follow_moves = resolved
            .map(|m| m.follow_moves)
            .unwrap_or(record.config.follow_moves);
        let mut rebuilt: Vec<crate::types::AnchorResolved> =
            Vec::with_capacity(record.anchors.len());
        for (anchor_id, a) in &record.anchors {
            match resolved.and_then(|m| m.anchors.iter().find(|r| &r.anchor_id == anchor_id)) {
                Some(existing) => rebuilt.push(existing.clone()),
                None => rebuilt.push(fresh_anchor_resolved_from_mesh(anchor_id, a)),
            }
        }
        // Preserve only SYNTHETIC injected anchors not tied to a file record
        // (e.g. MergeConflict placeholders carry an empty `anchor_id`).
        // Resolved anchors with a real `anchor_id` absent from the committed
        // record are worktree-only definitions and are dropped, keeping the
        // committed-keyed entry free of phantom worktree anchors.
        if let Some(m) = resolved {
            for r in &m.anchors {
                if r.anchor_id.is_empty() {
                    rebuilt.push(r.clone());
                }
            }
        }
        backfilled.push(MeshResolved {
            name: name.clone(),
            message,
            anchors: rebuilt,
            pending: resolved.map(|m| m.pending.clone()).unwrap_or_default(),
            follow_moves,
        });
    }

    Ok(Some((
        WholeResult {
            meshes: backfilled,
            mesh_anchor_totals,
        },
        has_interior_anchor,
    )))
}

/// Normalize a `committed_only` baseline [`AnchorResolved`] to its EFFECTIVE
/// (worktree-layer-on) equivalent for an UNAFFECTED mesh.
///
/// The Step 0 spike (`notes/spike-normalization-sufficiency.md`) diffed every
/// `AnchorResolved` field for `committed_only` vs effective resolution on both
/// parity corpora and found the ONLY divergent field is `current.blob`: the
/// committed view fills it with the HEAD blob, while effective resolution sets
/// it to `None` whenever the worktree layer is present
/// ([`anchor.rs L960`](../engine/anchor.rs) — a layer-flag effect, independent
/// of file content). For an unaffected anchor (no dirty path touches it) the
/// two resolutions agree on everything else — `source`, `layer_sources`,
/// `locus`, `status`, ordering — so this is a single-field, content-independent,
/// repo-access-free transform. The byte-identity oracle remains the fail-closed
/// backstop for any field a different corpus might surface.
fn normalize_committed_anchor(mut a: crate::types::AnchorResolved) -> crate::types::AnchorResolved {
    if let Some(current) = a.current.as_mut() {
        current.blob = None;
    }
    a
}

/// Build the warm-DIRTY render base by REUSING the already-loaded
/// `committed_only` baseline instead of paying a full effective
/// [`resolve_named_meshes`]. Mirrors the SHAPE of [`build_clean_whole_result`]
/// — one resolved mesh per committed record from [`committed_mesh_records`],
/// anchors in committed-record order, `Fresh` synthesized via
/// [`fresh_anchor_resolved_from_mesh`] — but draws each non-`Fresh` anchor from
/// `baseline_meshes` (the loaded `committed_only` findings) normalized via
/// [`normalize_committed_anchor`], paying NO resolution cost.
///
/// The baseline stores only non-`Fresh` findings, regrouped by `(mesh_order,
/// name)` ([`baseline.rs L411`](./baseline.rs)); reconstructing the full anchor
/// set from the committed records — and re-shaping to committed-record order —
/// is what fixes the anchor-ordering divergence, so we never rely on the
/// baseline's stored order. The unaffected meshes this produces are correct as
/// rendered; the affected (dirty) meshes are replaced by `apply_overlay`, which
/// supplies the authoritative effective re-resolution.
fn build_committed_render_base(
    repo: &gix::Repository,
    mesh_root: &str,
    baseline_meshes: &[MeshResolved],
) -> Result<Vec<MeshResolved>> {
    let file_records = committed_mesh_records(repo, mesh_root)?;
    if file_records.is_empty() {
        return Ok(Vec::new());
    }

    let baseline_by_name: std::collections::HashMap<&str, &MeshResolved> = baseline_meshes
        .iter()
        .map(|m| (m.name.as_str(), m))
        .collect();

    let mut backfilled: Vec<MeshResolved> = Vec::with_capacity(file_records.len());
    for (name, record) in &file_records {
        let baseline = baseline_by_name.get(name.as_str()).copied();
        let mut rebuilt: Vec<crate::types::AnchorResolved> =
            Vec::with_capacity(record.anchors.len());
        for (anchor_id, a) in &record.anchors {
            match baseline.and_then(|m| m.anchors.iter().find(|r| &r.anchor_id == anchor_id)) {
                Some(existing) => rebuilt.push(normalize_committed_anchor(existing.clone())),
                None => rebuilt.push(fresh_anchor_resolved_from_mesh(anchor_id, a)),
            }
        }
        backfilled.push(MeshResolved {
            name: name.clone(),
            message: record.message.clone(),
            anchors: rebuilt,
            pending: Vec::new(),
            follow_moves: record.config.follow_moves,
        });
    }

    Ok(backfilled)
}

/// Synthesize a `Fresh` `AnchorResolved` from a mesh-file anchor record,
/// matching the shape produced by [`fresh_anchor_resolved`] in the CLI layer.
fn fresh_anchor_resolved_from_mesh(
    anchor_id: &str,
    a: &crate::types::Anchor,
) -> crate::types::AnchorResolved {
    crate::types::AnchorResolved {
        anchor_id: anchor_id.to_string(),
        anchor_sha: a.anchor_sha.clone(),
        anchored: crate::types::AnchorLocation {
            path: std::path::PathBuf::from(&a.path),
            extent: a.extent,
            blob: None,
        },
        current: None,
        status: crate::types::AnchorStatus::Fresh,
        content_equivalent: false,
        source: None,
        layer_sources: Vec::new(),
        acknowledged_by: None,
        locus: None,
    }
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

/// Mesh-relative paths (`<mesh_root>/<name>`) of worktree mesh files that
/// are not committed at `HEAD` — untracked files, including gitignored
/// ones, which `git status -uno` does not enumerate.
///
/// Returned in `<mesh_root>/<name>` form so they slot directly into the
/// `dirty_paths` set, where [`meshes_affected_by`] turns the mesh-root
/// prefix back into a mesh name.
fn uncommitted_mesh_paths(repo: &gix::Repository, mesh_root: &str) -> Result<Vec<String>> {
    let reader = crate::mesh_file_reader::MeshFileReader::new(repo, mesh_root.to_string());
    let committed: HashSet<String> = reader.committed_mesh_names()?.into_iter().collect();
    Ok(reader
        .worktree_mesh_names()?
        .into_iter()
        .filter(|name| !committed.contains(name))
        .map(|name| format!("{mesh_root}/{name}"))
        .collect())
}

/// Full HEAD-only resolution of every mesh committed at `HEAD` — the
/// cold-build input for the committed baseline.
///
/// When more than one mesh exists and multiple CPUs are available, meshes
/// are partitioned across threads. Each thread builds an independent
/// [`EngineState`](super::engine::EngineState) with
/// [`LayerSet::committed_only()`] and resolves its subset in parallel.
/// Results are merged in the original enumeration order, so output is
/// deterministic and identical to the serial path.
fn build_committed_meshes(repo: &gix::Repository, mesh_root: &str) -> Result<Vec<MeshResolved>> {
    let _perf = crate::perf::span("resolver.cache_v2.build-baseline");
    // The committed baseline is keyed by the HEAD mesh tree and resolved
    // with `committed_only`, so it must enumerate exactly the meshes that
    // exist at HEAD. Enumerating the worktree filesystem (the old
    // behavior) baked untracked/gitignored mesh files into a HEAD-keyed
    // baseline; deleting such a file changed neither the key nor `git
    // status -uno`, so the warm-clean path replayed the deleted mesh.
    // Worktree-only meshes are uncommitted state handled by the
    // dirty-overlay path below.
    let reader = crate::mesh_file_reader::MeshFileReader::new(repo, mesh_root.to_string());
    let names: Vec<String> = reader.committed_mesh_names()?;
    if names.is_empty() {
        return Ok(Vec::new());
    }

    // Single-mesh or single-CPU: resolve serially.
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    if names.len() <= 1 || cpus <= 1 {
        let resolved = super::engine::resolve_named_meshes(
            repo,
            mesh_root,
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
        return Ok(out);
    }

    // Parallel: work-stealing resolution over the pre-parsed corpus. Each
    // worker owns one EngineState so its session caches amortize across
    // every chunk it steals; results return in enumeration order.
    let options = EngineOptions {
        layers: LayerSet::committed_only(),
        ignore_unavailable: false,
        since: None,
        needs_all_layers: true,
    };
    let resolved = super::engine::resolve_named_meshes_parallel(
        repo,
        mesh_root,
        &names,
        options,
        cpus.min(names.len()),
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

/// Committed mesh records (`name` → `Mesh`) read from the HEAD layer only.
///
/// Used to backfill the whole-result cache entry's per-mesh anchor sets and
/// `mesh_anchor_totals` from committed content, so the stored entry matches
/// its committed key. Reading the worktree-effective view here would freeze
/// uncommitted worktree edits into a committed-keyed entry (phantom anchors
/// on a later warm-clean read after the worktree is reverted without a
/// commit).
fn committed_mesh_records(
    repo: &gix::Repository,
    mesh_root: &str,
) -> Result<std::collections::HashMap<String, crate::types::Mesh>> {
    let reader = crate::mesh_file_reader::MeshFileReader::new(repo, mesh_root.to_string());
    let names = reader.committed_mesh_names()?;
    let mut out = std::collections::HashMap::with_capacity(names.len());
    for name in names {
        if let Some(file) = reader.read_head(&name)? {
            out.insert(name.clone(), crate::types::mesh_from_file(&name, &file));
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
        for (name, mesh) in crate::mesh::read::load_all_meshes_in(repo, mesh_root)?.0 {
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

/// Whether a committed `.gitattributes` blob at `path` contains a
/// `filter=lfs` pattern. `false` when absent, unreadable, or no LFS filter.
fn gitattributes_blob_has_lfs(repo: &gix::Repository, path: &std::path::Path) -> bool {
    let oid = match crate::git::tree_entry_at(repo, "HEAD", path) {
        Ok(Some((mode, oid))) if mode.is_blob() => oid,
        _ => return false,
    };
    match repo.find_object(oid) {
        Ok(obj) => {
            let data = obj.into_blob().detach().data;
            // Look for `filter=lfs` anywhere in the attributes file.
            data.windows(10).any(|w| w == b"filter=lfs")
        }
        Err(_) => false,
    }
}

/// Whether the committed blob at `path` is itself a git-LFS pointer.
fn committed_blob_is_lfs_pointer(repo: &gix::Repository, path: &std::path::Path) -> bool {
    let oid = match crate::git::tree_entry_at(repo, "HEAD", path) {
        Ok(Some((mode, oid))) if mode.is_blob() => oid,
        _ => return false,
    };
    match repo.find_object(oid) {
        Ok(obj) => {
            let data = obj.into_blob().detach().data;
            crate::resolver::layers::lfs::lfs_pointer_oid(&data).is_some()
        }
        Err(_) => false,
    }
}

/// Conservative LFS detection over the actual anchored corpus.
///
/// Returns `true` (forcing the `git lfs version` availability probe) when
/// LFS is configured anywhere that could affect an anchored file:
///   * the root `HEAD:.gitattributes` declares `filter=lfs` (the common case
///     the previous root-only check covered), or
///   * a `.gitattributes` committed in any ancestor directory of an anchored
///     path declares `filter=lfs`, or
///   * an anchored file's committed blob is itself an LFS pointer (LFS in use
///     even with no discoverable `.gitattributes`).
///
/// Returns `false` only when no anchored file has any LFS signal — preserving
/// the no-fork win for the genuinely-no-LFS common case. Reads committed blobs
/// via `gix`; no subprocess.
fn corpus_has_lfs(repo: &gix::Repository, mesh_root: &str) -> bool {
    if gitattributes_blob_has_lfs(repo, std::path::Path::new(".gitattributes")) {
        return true;
    }
    let Ok(records) = committed_mesh_records(repo, mesh_root) else {
        // Cannot enumerate the committed corpus — be conservative and fork,
        // matching the fail-closed posture for availability gating.
        return true;
    };
    // Distinct anchored source paths across all committed meshes.
    let mut anchored_paths: BTreeSet<String> = BTreeSet::new();
    for mesh in records.values() {
        for (_, a) in &mesh.anchors {
            anchored_paths.insert(a.path.clone());
        }
    }
    // `.gitattributes` files already probed, to avoid re-reading the same blob.
    let mut probed_attrs: HashSet<std::path::PathBuf> = HashSet::new();
    probed_attrs.insert(std::path::PathBuf::from(".gitattributes"));
    for rel in &anchored_paths {
        let path = std::path::Path::new(rel);
        // Each ancestor directory's `.gitattributes`.
        let mut dir = path.parent();
        while let Some(d) = dir {
            let attrs = d.join(".gitattributes");
            if probed_attrs.insert(attrs.clone()) && gitattributes_blob_has_lfs(repo, &attrs) {
                return true;
            }
            dir = d.parent();
        }
        // The anchored blob itself.
        if committed_blob_is_lfs_pointer(repo, path) {
            return true;
        }
    }
    false
}

fn lfs_installed(corpus_has_lfs: bool) -> bool {
    if !corpus_has_lfs {
        // Common case: no LFS patterns in committed .gitattributes — skip fork.
        return false;
    }
    // LFS content present — preserve exact git lfs version semantics.
    std::process::Command::new("git")
        .args(["lfs", "version"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
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
            rd.flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with("promisor"))
        })
        .unwrap_or(false)
}

/// Best-effort cache gc. Never required for correctness.
pub(crate) fn gc(repo: &gix::Repository, max_age_secs: i64) -> Result<()> {
    let db = open_cache(repo)?;
    db.gc(max_age_secs)
}
