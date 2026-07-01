//! Whole-file resolver: blob-OID equality at the deepest enabled layer
//! per plan §D2. Renames produce `Moved`; symlinks/gitlinks compare by
//! recorded blob/SHA.

use super::super::session::follow_path_to_head_shared;
use super::EngineState;
use crate::git;
use crate::types::{
    submodule_classify, Anchor, AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus,
    DriftSource, MeshConfig, SubmoduleKind,
};
use crate::{Error, Result};
use git_mesh_core::{cheap_fingerprint_with_extent, rk64_to_hex, RK64_ALGORITHM};
use std::path::PathBuf;
use std::str::FromStr;

fn oid_from_hex(hex: &str) -> Result<gix::ObjectId> {
    gix::ObjectId::from_str(hex).map_err(|e| Error::Git(format!("invalid oid `{hex}`: {e}")))
}

/// True when `path` is a submodule gitlink (recorded with mode 160000 in
/// the index or HEAD-derived index). Gitlinks have no readable blob
/// content; their identity is the recorded commit OID.
fn is_gitlink_path(repo: &gix::Repository, path: &str) -> bool {
    crate::git::index_entries(repo)
        .map(|entries| {
            entries
                .iter()
                .any(|en| en.path == path && en.mode.is_commit())
        })
        .unwrap_or(false)
}

/// Canonical content bytes for a whole-file anchor at a resolved layer
/// OID. For a gitlink the canonical content is the recorded commit OID
/// hex string (matching how `git mesh add` hashes gitlinks); for a
/// regular path it is the blob text. This keeps the resolver's
/// file-backed hash comparison consistent with the add-time hash.
fn canonical_layer_bytes(repo: &gix::Repository, oid_hex: &str, gitlink: bool) -> Vec<u8> {
    if gitlink {
        oid_hex.as_bytes().to_vec()
    } else if oid_hex.is_empty() {
        Vec::new()
    } else {
        git::read_git_text(repo, oid_hex)
            .unwrap_or_default()
            .into_bytes()
    }
}

/// Scan the deepest-enabled layer's tracked paths for a file whose
/// canonical content hashes to `stored_hash`. Used when the anchored
/// whole-file path no longer resolves: if the exact stored content now
/// lives at a different path the anchor `Moved`; otherwise it is
/// `Deleted`. Returns the relocated path on a hit.
///
/// `deepest` selects the content source:
/// - `Head`/`Index`: hash the blob recorded in HEAD's tree / the index.
/// - `Worktree`: hash the on-disk file bytes.
///
/// `exclude` is the original anchored path (already known absent); it is
/// skipped so a relocation is a genuinely different path.
///
/// When `anchored_absent_at_head` is true the anchored path itself is
/// gone from HEAD (a committed `git mv`/deletion), so a HEAD-present
/// path is a valid relocation target. Otherwise HEAD-present paths are
/// skipped so an unrelated committed file is not mistaken for the move
/// destination.
fn find_relocated_whole_file(
    repo: &gix::Repository,
    state: &mut EngineState,
    workdir: &std::path::Path,
    deepest: DriftSource,
    stored_hash: &str,
    exclude: &str,
    anchored_absent_at_head: bool,
) -> Option<String> {
    let entries = git::index_entries(repo).ok()?;
    let is_rename_target = if anchored_absent_at_head {
        Some(super::rename_target_predicate(repo, exclude))
    } else {
        None
    };
    for en in entries {
        if en.stage != gix::index::entry::Stage::Unconflicted {
            continue;
        }
        if en.path == exclude {
            continue;
        }
        // A path absent from HEAD is always a candidate. A HEAD-present
        // path qualifies only when it is new as of the committed rename
        // (see `rename_target_predicate`), so a coincidental content
        // match in an unrelated pre-existing file is not a relocation.
        if state.head_blob_at(repo, &en.path).ok().flatten().is_some() {
            match &is_rename_target {
                Some(pred) if pred(repo, &en.path) => {}
                _ => continue,
            }
        }
        let gitlink = en.mode.is_commit();
        let bytes: Vec<u8> = match deepest {
            DriftSource::Worktree => {
                let abs = workdir.join(&en.path);
                match std::fs::read(&abs) {
                    Ok(b) => b,
                    Err(_) => continue,
                }
            }
            DriftSource::Index | DriftSource::Head => {
                canonical_layer_bytes(repo, &en.oid.to_string(), gitlink)
            }
        };
        let computed = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(&bytes, &AnchorExtent::WholeFile)));
        if computed == stored_hash {
            return Some(en.path);
        }
    }
    None
}

pub(crate) fn resolve_whole_file(
    repo: &gix::Repository,
    state: &mut EngineState,
    cfg: &MeshConfig,
    mesh_name: &str,
    anchor_id: &str,
    r: Anchor,
) -> Result<AnchorResolved> {
    // File-backed model: the anchored content is the blob at `r.path`
    // in HEAD. Carry that OID so `--patch`/`--stat` diff against the
    // anchored HEAD content instead of the drifted worktree file.
    let anchored_blob = if !r.blob.is_empty() {
        oid_from_hex(&r.blob).ok()
    } else {
        state
            .head_blob_at(repo, &r.path)?
            .and_then(|o| oid_from_hex(&o).ok())
    };
    let anchored = AnchorLocation {
        path: PathBuf::from(&r.path),
        extent: AnchorExtent::WholeFile,
        blob: anchored_blob,
    };
    if !r.anchor_sha.is_empty() && !state.commit_reachable(repo, &r.anchor_sha)? {
        return Ok(AnchorResolved {
            anchor_id: anchor_id.into(),
            anchor_sha: r.anchor_sha,
            anchored,
            current: None,
            status: AnchorStatus::Deleted,
            source: None,
            layer_sources: vec![],
            content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
            locus: None,
        });
    }

    if r.anchor_sha == state.head_sha
        && super::anchor_path_is_layer_clean(state, &r.path)
        && let Some(head_blob) = state.head_blob_at(repo, &r.path)?
        && head_blob == r.blob
    {
        return Ok(AnchorResolved {
            anchor_id: anchor_id.into(),
            anchor_sha: r.anchor_sha,
            anchored,
            current: Some(AnchorLocation {
                path: PathBuf::from(&r.path),
                extent: AnchorExtent::WholeFile,
                blob: oid_from_hex(&head_blob).ok(),
            }),
            status: AnchorStatus::Fresh,
            source: None,
            layer_sources: vec![],
            content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
            locus: None,
        });
    }

    let workdir = git::work_dir(repo)?;
    // Phase 2: rename trail consumes per-commit deltas from the shared
    // session instead of running its own `anchor..HEAD` rev_walk.
    let current_path = follow_path_to_head_shared(
        repo,
        &mut state.session,
        mesh_name,
        anchor_id,
        &r.path,
        &mut state.warnings,
    )
    .unwrap_or_else(|| r.path.clone());

    let moved = current_path != r.path;

    // Per-layer blob OIDs for whole-file comparison.
    let head_blob: Option<String> = state.head_blob_at(repo, &current_path)?;
    let deepest = if state.layers.worktree {
        DriftSource::Worktree
    } else if state.layers.index {
        DriftSource::Index
    } else {
        DriftSource::Head
    };

    if super::anchor_path_is_layer_clean(state, &current_path)
        && let Some(head_blob) = head_blob.as_ref()
        && head_blob == &r.blob
    {
        let status = if moved {
            AnchorStatus::Moved
        } else {
            AnchorStatus::Fresh
        };
        let source = if moved { Some(deepest) } else { None };
        let layer_sources = if moved { vec![deepest] } else { vec![] };
        return Ok(AnchorResolved {
            anchor_id: anchor_id.into(),
            anchor_sha: r.anchor_sha,
            anchored,
            current: Some(AnchorLocation {
                path: PathBuf::from(&current_path),
                extent: AnchorExtent::WholeFile,
                blob: oid_from_hex(head_blob).ok(),
            }),
            status,
            source,
            layer_sources,
            content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
            locus: None,
        });
    }

    let index_blob: Option<String> = if state.layers.index {
        if let Some((_mode, sha)) = index_entry_for(repo, &current_path) {
            Some(sha)
        } else {
            head_blob.clone() // no index entry → same as HEAD
        }
    } else {
        head_blob.clone()
    };

    let worktree_blob: Option<Option<String>> = if state.layers.worktree {
        let abs = workdir.join(&current_path);
        if let Ok(md) = std::fs::symlink_metadata(&abs) {
            if md.file_type().is_symlink() {
                let target = std::fs::read_link(&abs)
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let oid = git::hash_blob(target.as_bytes())
                    .ok()
                    .map(|o| o.to_string());
                Some(oid)
            } else if md.file_type().is_file()
                && let Ok(bytes) = std::fs::read(&abs)
                && let Ok(oid) = git::hash_blob(&bytes)
            {
                Some(Some(oid.to_string()))
            } else {
                Some(index_blob.clone())
            }
        } else {
            Some(None) // deleted in worktree
        }
    } else {
        None // worktree layer not enabled
    };

    // The deepest-layer blob determines `current`.
    let current_blob: Option<String> = if let Some(wt) = worktree_blob.as_ref() {
        wt.clone()
    } else {
        index_blob.clone()
    };

    let _ = cfg;
    let is_gitlink = is_gitlink_path(repo, &current_path);
    let status: AnchorStatus;
    let source: Option<DriftSource>;
    let layer_sources: Vec<DriftSource>;

    // Determine which layers independently show drift (blob OID != anchor blob,
    // or rk64 of current content != stored_hash).
    let head_drifts = if !r.stored_hash.is_empty() {
        match &head_blob {
            Some(oid) => {
                let bytes = canonical_layer_bytes(repo, oid, is_gitlink);
                let computed = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(&bytes, &AnchorExtent::WholeFile)));
                computed != r.stored_hash
            }
            None => true,
        }
    } else {
        head_blob.as_deref() != Some(r.blob.as_str())
    };
    let index_drifts = if !r.stored_hash.is_empty() {
        state.layers.index
            && match &index_blob {
                Some(oid) => {
                    let bytes = canonical_layer_bytes(repo, oid, is_gitlink);
                    let computed = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(&bytes, &AnchorExtent::WholeFile)));
                    computed != r.stored_hash
                }
                None => true,
            }
    } else {
        state.layers.index && index_blob.as_deref() != Some(r.blob.as_str())
    };
    let worktree_drifts = if !r.stored_hash.is_empty() {
        state.layers.worktree
            && match &worktree_blob {
                Some(Some(oid)) => {
                    if is_gitlink {
                        // Gitlink: identity is the recorded commit OID hex.
                        let computed = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(oid.as_bytes(), &AnchorExtent::WholeFile)));
                        computed != r.stored_hash
                    } else {
                        // Worktree blob OID may not exist in repo (computed
                        // via hash_blob). Re-read file from disk for hash.
                        let abs = workdir.join(&current_path);
                        match std::fs::read(&abs) {
                            Ok(bytes) => {
                                let computed = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(&bytes, &AnchorExtent::WholeFile)));
                                computed != r.stored_hash
                            }
                            Err(_) => true,
                        }
                    }
                }
                Some(None) => true,
                None => false,
            }
    } else {
        state.layers.worktree
            && worktree_blob
                .as_ref()
                .map(|b| b.as_deref() != Some(r.blob.as_str()))
                .unwrap_or(false)
    };

    let cur_blob_oid = current_blob.as_deref().and_then(|s| oid_from_hex(s).ok());
    let mut current_loc = Some(AnchorLocation {
        path: PathBuf::from(&current_path),
        extent: AnchorExtent::WholeFile,
        blob: cur_blob_oid,
    });
    match current_blob.as_deref() {
        None => {
            // The anchored path no longer resolves at the deepest layer.
            // File-backed model: the exact stored content may have
            // relocated verbatim to a different path (e.g. `git mv` not
            // yet committed, or a copy + `git rm`). Scan tracked paths
            // for the stored hash before deciding. Outcomes:
            //  - relocated (including a committed `git mv` target) →
            //    `Moved` (current = new path)
            //  - path absent from HEAD with no relocation found
            //    (committed deletion) → `Deleted`
            //  - path still at HEAD, removed only in the index/worktree
            //    → `Changed` with the layer source and no `current`,
            //    which the drift-label formatter renders as
            //    "deleted in the working tree" / "deleted in the index".
            // In no case is a removal mislabeled "changed in …".
            let file_backed = !r.stored_hash.is_empty();
            let head_path_absent =
                file_backed && state.head_blob_at(repo, &r.path).ok().flatten().is_none();
            let relocated = if file_backed {
                find_relocated_whole_file(
                    repo,
                    state,
                    workdir,
                    deepest,
                    &r.stored_hash,
                    &current_path,
                    head_path_absent,
                )
            } else {
                None
            };
            match relocated {
                Some(new_path) => {
                    status = AnchorStatus::Moved;
                    source = Some(deepest);
                    layer_sources = vec![deepest];
                    return Ok(AnchorResolved {
                        anchor_id: anchor_id.into(),
                        anchor_sha: r.anchor_sha,
                        anchored,
                        current: Some(AnchorLocation {
                            path: PathBuf::from(&new_path),
                            extent: AnchorExtent::WholeFile,
                            blob: None,
                        }),
                        status,
                        source,
                        layer_sources,
                        content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
                                locus: None,
                    });
                }
                None if head_path_absent => {
                    // Directory promoted to submodule: the anchored path
                    // lives inside a gitlink and cannot resolve at HEAD.
                    let is_submodule = git::index_entries(repo)
                        .ok()
                        .map(|entries| {
                            !matches!(
                                submodule_classify(&entries, &r.path),
                                SubmoduleKind::None,
                            )
                        })
                        .unwrap_or(false);
                    let status = if is_submodule {
                        AnchorStatus::Submodule
                    } else {
                        AnchorStatus::Deleted
                    };
                    return Ok(AnchorResolved {
                        anchor_id: anchor_id.into(),
                        anchor_sha: r.anchor_sha,
                        anchored,
                        current: None,
                        status,
                        source: None,
                        layer_sources: vec![],
                        content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
                                locus: None,
                    });
                }
                None => {
                    // Removed only in the index/worktree (path still at
                    // HEAD). Attribute to the shallowest drifting layer
                    // so the formatter renders "deleted in the index"
                    // vs "deleted in the working tree" correctly;
                    // `current = None` keeps it from reading "changed".
                    let removed_layer = if index_drifts && !worktree_drifts {
                        DriftSource::Index
                    } else {
                        deepest
                    };
                    return Ok(AnchorResolved {
                        anchor_id: anchor_id.into(),
                        anchor_sha: r.anchor_sha,
                        anchored,
                        current: None,
                        status: AnchorStatus::Changed,
                        source: Some(removed_layer),
                        layer_sources: vec![removed_layer],
                        content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
                                locus: None,
                    });
                }
            }
        }
        Some(cur) => {
            // Determine if current content matches the anchored state.
            let cur_matches = if !r.stored_hash.is_empty() {
                // File-backed model: compute SHA-256 of deepest-layer
                // canonical content and compare against stored_hash.
                let text = if is_gitlink {
                    // Gitlink identity is the recorded commit OID hex.
                    cur.as_bytes().to_vec()
                } else {
                    match deepest {
                        DriftSource::Worktree => {
                            // Same git-normalized canonicalization the
                            // line-anchor worktree path and `git mesh add`
                            // use (clean filter / custom driver / CRLF→LF),
                            // so a freshly-added whole-file anchor under EOL
                            // or filter normalization is not falsely drifted.
                            match super::super::layers::read_worktree_normalized(
                                repo,
                                &mut state.custom_filters,
                                &current_path,
                            ) {
                                Ok(b) => b,
                                // A required custom filter that fails has
                                // no canonical content; preserve the
                                // pre-existing raw-bytes comparison for
                                // this uncomparable path (add records the
                                // same raw bytes for it).
                                Err(Error::FilterFailed { .. }) => {
                                    std::fs::read(workdir.join(&current_path)).unwrap_or_default()
                                }
                                Err(_) => Vec::new(),
                            }
                        }
                        DriftSource::Index | DriftSource::Head => {
                            canonical_layer_bytes(repo, cur, false)
                        }
                    }
                };
                let computed = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(&text, &AnchorExtent::WholeFile)));
                computed == r.stored_hash
            } else {
                cur == r.blob
            };
            if cur_matches && moved {
                status = AnchorStatus::Moved;
                source = Some(deepest);
                // MOVED: single row per design requirement 4.
                layer_sources = vec![deepest];
            } else if cur_matches {
                status = AnchorStatus::Fresh;
                source = None;
                layer_sources = vec![];
            } else if let Some(new_path) = {
                // Cross-path relocation: the stored whole-file content
                // was duplicated verbatim to a different tracked path
                // (staged copy-then-replace, or a committed `git mv` the
                // follow-walk did not pick up). Scan before `Changed`.
                let file_backed = !r.stored_hash.is_empty();
                if file_backed {
                    let anchored_absent_at_head = state.head_blob_at(repo, &r.path)?.is_none();
                    find_relocated_whole_file(
                        repo,
                        state,
                        workdir,
                        deepest,
                        &r.stored_hash,
                        &current_path,
                        anchored_absent_at_head,
                    )
                } else {
                    None
                }
            } {
                status = AnchorStatus::Moved;
                source = Some(deepest);
                layer_sources = vec![deepest];
                current_loc = Some(AnchorLocation {
                    path: PathBuf::from(new_path),
                    extent: AnchorExtent::WholeFile,
                    blob: None,
                });
            } else {
                status = AnchorStatus::Changed;
                source = Some(deepest);
                // Collect all drifting layers in I → W → H order.
                let mut ls: Vec<DriftSource> = Vec::new();
                if index_drifts {
                    ls.push(DriftSource::Index);
                }
                if worktree_drifts {
                    ls.push(DriftSource::Worktree);
                }
                if head_drifts {
                    ls.push(DriftSource::Head);
                }
                layer_sources = if ls.is_empty() { vec![deepest] } else { ls };
            }
        }
    }

    Ok(AnchorResolved {
        anchor_id: anchor_id.into(),
        anchor_sha: r.anchor_sha,
        anchored,
        current: current_loc,
        status,
        source,
        layer_sources,
        content_equivalent: false, // whole-file anchors are not equivalence-checked for --fix
        locus: None,
    })
}

fn index_entry_for(repo: &gix::Repository, path: &str) -> Option<(String, String)> {
    let entries = git::index_entries(repo).ok()?;
    let entry = entries
        .into_iter()
        .find(|e| e.path == path && e.stage == gix::index::entry::Stage::Unconflicted)?;
    let mut buf = [0u8; 6];
    let mode_str = entry.mode.as_bytes(&mut buf).to_string();
    Some((mode_str, entry.oid.to_string()))
}
