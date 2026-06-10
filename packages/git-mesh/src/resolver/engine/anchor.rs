//! Per-anchor layered resolution: HEAD walk + index/worktree hunk
//! application + LFS short-circuit + slice comparison.

use super::super::layers::{read_worktree_normalized, resolve_lfs_anchor};
use super::super::session::resolve_at_head_shared;
use super::super::walker::{Tracked, apply_hunks_to_range};
use super::EngineState;
use super::whole_file::resolve_whole_file;
use crate::git;
use crate::types::{
    Anchor, AnchorExtent, AnchorLocation, AnchorResolved, AnchorStatus, DriftSource, MeshConfig,
    UnavailableReason,
};
use crate::{Error, Result};
use git_mesh_core::{
    cheap_fingerprint_indexed, cheap_fingerprint_with_extent, rk64_from_hex, rk64_to_hex,
    RK64_ALGORITHM,
};
use git_mesh_core::{LineIndex, scan_indexed_rk64};
use std::path::PathBuf;
use std::str::FromStr;

fn oid_from_hex(hex: &str) -> Result<gix::ObjectId> {
    gix::ObjectId::from_str(hex).map_err(|e| Error::Git(format!("invalid oid `{hex}`: {e}")))
}

fn lines_equal(a: &[&str], b: &[&str], ignore_ws: bool) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).all(|(x, y)| {
        if ignore_ws {
            let xs: String = x.split_whitespace().collect();
            let ys: String = y.split_whitespace().collect();
            xs == ys
        } else {
            x == y
        }
    })
}

fn string_from_utf8_lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Read the text content of an index blob by OID.
fn read_blob_text(repo: &gix::Repository, oid_hex: &str) -> String {
    git::read_git_text(repo, oid_hex).unwrap_or_default()
}

/// Compare the content slice at `tracked` position against the anchored
/// slice. Returns `true` when the slice differs (i.e. this layer drifts).
fn slice_differs(
    text: &str,
    tracked: &Tracked,
    anchored_lines: &[&str],
    anchored_start: u32,
    anchored_end: u32,
    ignore_ws: bool,
) -> bool {
    let current_lines: Vec<&str> = text.lines().collect();
    let a_lo = (anchored_start as usize).saturating_sub(1);
    let a_hi = (anchored_end as usize).min(anchored_lines.len());
    let c_lo = (tracked.start as usize).saturating_sub(1);
    let c_hi = (tracked.end as usize).min(current_lines.len());
    let a_slice = if a_lo <= a_hi {
        &anchored_lines[a_lo..a_hi]
    } else {
        &[][..]
    };
    let c_slice = if c_lo <= c_hi {
        &current_lines[c_lo..c_hi]
    } else {
        &[][..]
    };
    !lines_equal(a_slice, c_slice, ignore_ws)
}

/// File-backed `Moved` relocation scan for line anchors.
///
/// The anchor's canonical content is identified by `stored_hash`
/// (`rk64:<hex>` of the `\n`-joined slice at add time). When the
/// content at the tracked range no longer matches, the same content may
/// have relocated elsewhere in `text` (lines shifted up/down, block
/// moved). Scan every window of `span` lines and return the 1-based
/// `(start, end)` whose rk64 fingerprint equals `stored_hash`, preferring
/// the window closest to `near_start` so a small shift maps to the
/// nearest occurrence.
fn find_relocated_range(
    text: &str,
    span: usize,
    stored_hash: &str,
    near_start: u32,
) -> Option<(u32, u32)> {
    if span == 0 {
        return None;
    }
    let fp = parse_stored_fingerprint(stored_hash)?;
    let extent = AnchorExtent::LineRange {
        start: 1,
        end: span as u32,
    };
    let files = [(String::new(), text.as_bytes().to_vec())];
    git_mesh_core::scan_for_content_hash_rk64(&files, fp, extent, Some(near_start))
        .into_iter()
        .next()
        .map(|loc| (loc.start_line, loc.end_line))
}

/// [`find_relocated_range`] over a prebuilt [`LineIndex`].  Uses
/// [`scan_indexed_rk64`] to avoid rebuilding the index and re-reading
/// the file per anchor — the central amortization Tier 2 enables.
fn find_relocated_range_indexed(
    idx: &LineIndex,
    span: usize,
    stored_hash: &str,
    near_start: u32,
) -> Option<(u32, u32)> {
    if span == 0 {
        return None;
    }
    let fp = parse_stored_fingerprint(stored_hash)?;
    let extent = AnchorExtent::LineRange {
        start: 1,
        end: span as u32,
    };
    let files = [(String::new(), idx.clone())];
    scan_indexed_rk64(&files, fp, extent, Some(near_start))
        .into_iter()
        .next()
        .map(|loc| (loc.start_line, loc.end_line))
}

/// Parse the rk64 fingerprint from a `"rk64:<16-hex>"` stored hash string.
/// Returns `None` for non-rk64 or malformed tokens so a caller silently
/// falls through to the no-relocation-found path.
fn parse_stored_fingerprint(stored_hash: &str) -> Option<u64> {
    let hex = stored_hash.strip_prefix("rk64:")?;
    rk64_from_hex(hex)
}

/// Cross-file `Moved` relocation scan for line anchors whose anchored
/// path no longer resolves at the deepest layer (e.g. `git rm`, or a
/// verbatim copy to a new path + remove of the original).
///
/// Scans tracked paths for the stored content. A relocation target is
/// either content that appeared where there was nothing committed (a
/// verbatim copy to a fresh path) or — when `anchored_absent_at_head` is
/// true — a HEAD-present path that received the content via a committed
/// `git mv`. When the original anchored path is still present at HEAD
/// (`anchored_absent_at_head == false`) HEAD-present candidates are
/// skipped so a coincidental match of trivial generic content in an
/// unrelated committed file does not masquerade as a relocation. Returns
/// `(path, start, end)` on the first hit; the original `exclude` path is
/// skipped.
fn find_relocated_range_in_paths(
    repo: &gix::Repository,
    state: &mut EngineState,
    deepest: DriftSource,
    span: usize,
    stored_hash: &str,
    exclude: &str,
    anchored_absent_at_head: bool,
) -> Option<(String, u32, u32)> {
    let entries = git::index_entries(repo).ok()?;
    let workdir = git::work_dir(repo).ok()?;
    // One breadth-first HEAD-tree enumeration replaces a per-index-entry
    // root-to-leaf traversal in the `head_blob_at` probe below — the scan
    // visits every tracked path, so warming the memo up front is strictly
    // cheaper than letting each path miss individually.
    let head_sha = state.head_sha.clone();
    state.session.warm_head_blob_memo(repo, &head_sha);
    // When the anchored path is gone from HEAD (committed `git mv` /
    // deletion), a HEAD-present path is a valid relocation target only
    // if it is new as of the rename commit — see
    // `rename_target_predicate`. This excludes a coincidental match in
    // an unrelated pre-existing file.
    let is_rename_target = if anchored_absent_at_head {
        Some(super::rename_target_predicate(repo, exclude))
    } else {
        None
    };
    for en in entries {
        if en.stage != gix::index::entry::Stage::Unconflicted {
            continue;
        }
        if en.path == exclude || en.mode.is_commit() {
            continue;
        }
        // A path absent from HEAD is always a candidate. A HEAD-present
        // path qualifies only via the committed-rename predicate.
        if state.head_blob_at(repo, &en.path).ok().flatten().is_some() {
            match &is_rename_target {
                Some(pred) if pred(repo, &en.path) => {}
                _ => continue,
            }
        }
        // Session-scoped memo: the same `(path, layer)` is rescanned by
        // every drifted-absent anchor in the run, so without amortization
        // the read cost is `O(anchors × candidates)`. The memo collapses
        // each `(path, layer)` to a single read; `relocation_candidate_reads`
        // counts only memo misses.
        let memo_key = (en.path.clone(), deepest);
        let text: String = match state.session.relocation_text_memo.get(&memo_key) {
            Some(Some(t)) => t.clone(),
            Some(None) => continue, // previously unreadable
            None => {
                state.session.relocation_candidate_reads += 1;
                let read: Option<String> = match deepest {
                    DriftSource::Worktree => std::fs::read(workdir.join(&en.path))
                        .ok()
                        .map(|b| string_from_utf8_lossy(&b)),
                    DriftSource::Index | DriftSource::Head => {
                        Some(read_blob_text(repo, &en.oid.to_string()))
                    }
                };
                state
                    .session
                    .relocation_text_memo
                    .insert(memo_key, read.clone());
                match read {
                    Some(t) => t,
                    None => continue,
                }
            }
        };
        if let Some((s, e)) = find_relocated_range(&text, span, stored_hash, 1) {
            return Some((en.path, s, e));
        }
    }
    None
}

pub(crate) fn resolve_anchor_inner(
    repo: &gix::Repository,
    state: &mut EngineState,
    cfg: &MeshConfig,
    mesh_name: &str,
    anchor_id: &str,
    r: Anchor,
) -> Result<AnchorResolved> {
    if matches!(r.extent, AnchorExtent::WholeFile) {
        return resolve_whole_file(repo, state, cfg, mesh_name, anchor_id, r);
    }
    let (anchored_start, anchored_end) = match r.extent {
        AnchorExtent::LineRange { start, end } => (start, end),
        AnchorExtent::WholeFile => unreachable!(),
    };
    // File-backed model: the anchored content is the blob at `r.path`
    // in HEAD (the mesh file at HEAD pins by content hash; HEAD is the
    // reference point). Carry that blob OID so renderers (`--patch`,
    // `--stat`) diff against the anchored HEAD content rather than
    // falling back to the drifted worktree file.
    let anchored_blob = if !r.blob.is_empty() {
        oid_from_hex(&r.blob).ok()
    } else {
        state
            .head_blob_at(repo, &r.path)?
            .and_then(|o| oid_from_hex(&o).ok())
    };
    let anchored = AnchorLocation {
        path: PathBuf::from(&r.path),
        extent: r.extent,
        blob: anchored_blob,
    };
    if !r.anchor_sha.is_empty() && !state.commit_reachable(repo, &r.anchor_sha)? {
        return Ok(AnchorResolved {
            anchor_id: anchor_id.into(),
            anchor_sha: r.anchor_sha,
            anchored,
            current: None,
            status: AnchorStatus::Deleted,
            content_equivalent: false,
            source: None,
            layer_sources: vec![],
            acknowledged_by: None,
            locus: None,
        });
    }

    if r.anchor_sha == state.head_sha {
        let head_loc = Some(Tracked {
            path: r.path.clone(),
            start: anchored_start,
            end: anchored_end,
        });
        if let Some(resolved) = clean_head_fast_path(
            repo,
            state,
            anchor_id,
            &r,
            anchored.clone(),
            &head_loc,
            anchored_start,
            anchored_end,
        )? {
            return Ok(resolved);
        }
    }

    let head_loc = resolve_at_head_shared(
        repo,
        &mut state.session,
        &r,
        mesh_name,
        anchor_id,
        &mut state.warnings,
    )?;

    let head_path: Option<String> = head_loc.as_ref().map(|t| t.path.clone());
    if state.layers.index || state.layers.worktree {
        let p = head_path.as_deref().unwrap_or(r.path.as_str());
        if state.conflicted_paths.contains(p) {
            return Ok(AnchorResolved {
                anchor_id: anchor_id.into(),
                anchor_sha: r.anchor_sha,
                anchored,
                current: Some(AnchorLocation {
                    path: PathBuf::from(p),
                    extent: AnchorExtent::LineRange {
                        start: anchored_start,
                        end: anchored_end,
                    },
                    blob: None,
                }),
                status: AnchorStatus::MergeConflict,
                content_equivalent: false,
                source: None,
                layer_sources: vec![],
                acknowledged_by: None,
                locus: None,
            });
        }
    }

    if let Some(resolved) = clean_head_fast_path(
        repo,
        state,
        anchor_id,
        &r,
        anchored.clone(),
        &head_loc,
        anchored_start,
        anchored_end,
    )? {
        return Ok(resolved);
    }

    // Track per-layer positions. Each option is `None` if the path was
    // deleted at that layer.
    let head_tracked = head_loc.clone();

    // Index layer: apply hunks on top of head_tracked.
    let mut index_tracked: Option<Tracked> = head_tracked.clone();
    let mut index_blob_oid: Option<String> = None;
    let mut index_hunk_applied = false;
    if state.layers.index
        && let Some(t) = index_tracked.as_ref()
        && let Some(diffs) = state.index_diffs.as_ref()
        && let Some(entry) = diffs.map.get(&t.path)
    {
        if entry.deleted {
            index_tracked = None;
        } else {
            let (s, e) = apply_hunks_to_range(&entry.hunks, t.start, t.end);
            let new_path = entry.new_path.clone();
            index_tracked = Some(Tracked {
                path: new_path,
                start: s,
                end: e,
            });
            index_blob_oid = entry.new_blob.clone();
            index_hunk_applied = true;
        }
    }

    // Worktree layer: apply hunks on top of index_tracked.
    let mut worktree_tracked: Option<Tracked> = index_tracked.clone();
    let mut worktree_hunk_applied = false;
    if state.layers.worktree
        && let Some(t) = worktree_tracked.as_ref()
        && let Some(diffs) = state.worktree_diffs.as_ref()
        && let Some(entry) = diffs.map.get(&t.path)
    {
        if entry.deleted {
            worktree_tracked = None;
        } else {
            let (s, e) = apply_hunks_to_range(&entry.hunks, t.start, t.end);
            let new_path = entry.new_path.clone();
            worktree_tracked = Some(Tracked {
                path: new_path,
                start: s,
                end: e,
            });
            worktree_hunk_applied = true;
        }
    }

    // The deepest enabled layer's tracked position determines `current`.
    let (tracked, deepest_layer) = if state.layers.worktree {
        (worktree_tracked.as_ref(), DriftSource::Worktree)
    } else if state.layers.index {
        (index_tracked.as_ref(), DriftSource::Index)
    } else {
        (head_tracked.as_ref(), DriftSource::Head)
    };

    // LFS short-circuit: if the deepest tracked path is LFS-managed, delegate.
    // Memoized per path on the engine state — an unmemoized check builds a
    // fresh gitattributes stack on every anchor.
    if let Some(t) = tracked
        && state.is_lfs_path_memo(repo, &t.path)
    {
        return Ok(resolve_lfs_anchor(
            repo,
            &mut state.lfs,
            anchor_id,
            &r,
            anchored,
            t,
            deepest_layer,
            index_blob_oid.as_deref(),
            worktree_hunk_applied,
        ));
    }

    // Read the deepest layer's content for `current` and overall status.
    let current = match tracked {
        None => None,
        Some(t) => {
            let (cur_text, cur_blob) = match deepest_layer {
                DriftSource::Worktree => {
                    match read_worktree_normalized(repo, &mut state.custom_filters, &t.path) {
                        Ok(bytes) => (string_from_utf8_lossy(&bytes), None),
                        Err(Error::FilterFailed { filter }) => {
                            return Ok(unavailable(
                                anchor_id,
                                &r,
                                anchored,
                                UnavailableReason::FilterFailed { filter },
                            ));
                        }
                        Err(e) => return Err(e),
                    }
                }
                DriftSource::Index => {
                    if let Some(filter) = state.filter_short_circuit(repo, &t.path)? {
                        return Ok(unavailable(
                            anchor_id,
                            &r,
                            anchored,
                            UnavailableReason::FilterFailed { filter },
                        ));
                    }
                    let oid = match index_blob_oid.clone() {
                        Some(o) => Some(o),
                        None => state.head_blob_at(repo, &t.path)?,
                    };
                    match oid {
                        Some(o) => {
                            let txt = git::read_git_text(repo, &o).unwrap_or_default();
                            (txt, oid_from_hex(&o).ok())
                        }
                        None => (String::new(), None),
                    }
                }
                DriftSource::Head => {
                    if let Some(filter) = state.filter_short_circuit(repo, &t.path)? {
                        return Ok(unavailable(
                            anchor_id,
                            &r,
                            anchored,
                            UnavailableReason::FilterFailed { filter },
                        ));
                    }
                    let oid = state.head_blob_at(repo, &t.path)?;
                    let txt = match &oid {
                        Some(o) => git::read_git_text(repo, o).unwrap_or_default(),
                        None => String::new(),
                    };
                    (txt, oid.and_then(|o| oid_from_hex(&o).ok()))
                }
            };
            Some((t.clone(), cur_text, cur_blob))
        }
    };

    let status: AnchorStatus;
    let source: Option<DriftSource>;
    let current_loc: Option<AnchorLocation>;
    let layer_sources: Vec<DriftSource>;
    // Only set true on the in-place `Changed` arm below where the current
    // slice is whitespace-equivalent to the genuine original anchored slice;
    // `false` everywhere else (Fresh, Moved, Deleted, current==None).
    let mut content_equivalent = false;

    match current {
        None => {
            let anchored_text = if !r.blob.is_empty() {
                git::read_git_text(repo, &r.blob)?
            } else {
                match state.head_blob_at(repo, &r.path)? {
                    Some(oid) => git::read_git_text(repo, &oid).unwrap_or_default(),
                    None => String::new(),
                }
            };
            let anchored_lines: Vec<&str> = anchored_text.lines().collect();
            let computed_layer_sources = compute_layer_sources(
                repo,
                &r,
                &head_tracked,
                &index_tracked,
                &worktree_tracked,
                &mut *state,
                &anchored_lines,
                anchored_start,
                anchored_end,
                cfg.ignore_whitespace,
                index_hunk_applied,
                worktree_hunk_applied,
                &index_blob_oid,
            )?;
            // File-backed model: `current == None` means the anchored
            // path was deleted at the deepest enabled layer (`git rm`,
            // worktree delete) or is absent from HEAD (`git mv`). The
            // mesh stores content hashes, so before classifying:
            //  - relocated verbatim to a new path (including a committed
            //    `git mv` target) → `Moved`
            //  - path also absent from HEAD with no relocation found
            //    (committed deletion) → `Deleted`
            //  - path still at HEAD, removed only in the index/worktree
            //    → `Changed` with the layer source and no `current`,
            //    rendered "deleted in the working tree/index".
            // A removal is never mislabeled "changed in …".
            let file_backed = !r.stored_hash.is_empty() && r.blob.is_empty();
            let head_path_absent = file_backed && state.head_blob_at(repo, &r.path)?.is_none();
            if file_backed {
                let span = (anchored_end as usize).saturating_sub(anchored_start as usize) + 1;
                let relocated = find_relocated_range_in_paths(
                    repo,
                    state,
                    deepest_layer,
                    span,
                    &r.stored_hash,
                    &r.path,
                    head_path_absent,
                );
                if let Some((new_path, rs, re)) = relocated {
                    status = AnchorStatus::Moved;
                    source = Some(deepest_layer);
                    layer_sources = vec![deepest_layer];
                    current_loc = Some(AnchorLocation {
                        path: PathBuf::from(new_path),
                        extent: AnchorExtent::LineRange { start: rs, end: re },
                        blob: None,
                    });
                } else if head_path_absent {
                    status = AnchorStatus::Deleted;
                    source = None;
                    current_loc = None;
                    layer_sources = vec![];
                } else {
                    // Removed only in the index/worktree (still at
                    // HEAD). Keep the per-layer attribution from
                    // `compute_layer_sources` so the drift-label
                    // formatter renders "deleted in the index" vs
                    // "deleted in the working tree" correctly; with
                    // `current = None` it never reads "changed in …".
                    status = AnchorStatus::Changed;
                    source = computed_layer_sources
                        .first()
                        .copied()
                        .or(Some(deepest_layer));
                    current_loc = None;
                    layer_sources = if computed_layer_sources.is_empty() {
                        vec![deepest_layer]
                    } else {
                        computed_layer_sources
                    };
                }
            } else if head_path_absent {
                status = AnchorStatus::Deleted;
                source = None;
                current_loc = None;
                layer_sources = vec![];
            } else {
                status = AnchorStatus::Changed;
                source = computed_layer_sources
                    .first()
                    .copied()
                    .or(Some(deepest_layer));
                current_loc = None;
                layer_sources = if computed_layer_sources.is_empty() {
                    vec![deepest_layer]
                } else {
                    computed_layer_sources
                };
            }
        }
        Some((t, cur_text, cur_blob)) => {
            let anchored_text = if !r.blob.is_empty() {
                git::read_git_text(repo, &r.blob)?
            } else {
                match state.head_blob_at(repo, &r.path)? {
                    Some(oid) => git::read_git_text(repo, &oid).unwrap_or_default(),
                    None => String::new(),
                }
            };
            let anchored_lines: Vec<&str> = anchored_text.lines().collect();
            let current_lines: Vec<&str> = cur_text.lines().collect();
            let a_lo = (anchored_start as usize).saturating_sub(1);
            let a_hi = (anchored_end as usize).min(anchored_lines.len());
            let c_lo = (t.start as usize).saturating_sub(1);
            let c_hi = (t.end as usize).min(current_lines.len());
            let a_slice = if a_lo <= a_hi {
                &anchored_lines[a_lo..a_hi]
            } else {
                &[][..]
            };
            let c_slice = if c_lo <= c_hi {
                &current_lines[c_lo..c_hi]
            } else {
                &[][..]
            };
            // Tier 2: amortize one LineIndex per file across anchors.
            // Build or retrieve the index for this (path, layer) and compute
            // rk64 freshness hashes against it. The borrow is scoped so it is
            // released before compute_layer_sources takes &mut state.
            let (equal, worktree_recorded_fresh) = {
                let cached_idx = state.session.get_or_build_line_index(
                    cur_text.clone().into_bytes(),
                    &t.path,
                    deepest_layer,
                );
                let file_idx: &LineIndex = cached_idx.get();

                let equal = if !r.stored_hash.is_empty() && r.blob.is_empty() {
                    let computed_hash = format!(
                        "{RK64_ALGORITHM}:{}",
                        rk64_to_hex(cheap_fingerprint_indexed(
                            file_idx,
                            &AnchorExtent::LineRange { start: t.start, end: t.end },
                        ))
                    );
                    computed_hash == r.stored_hash
                } else {
                    lines_equal(a_slice, c_slice, cfg.ignore_whitespace)
                };

                // Worktree-fresh terminal verdict — extends the
                // worktree-is-authority principle (in-place case, main-93) to
                // the relocation case. When the worktree layer is enabled and
                // the worktree slice at the anchor's *recorded* range hashes
                // to `stored_hash`, the anchor accurately represents the
                // working tree and is `Fresh`, regardless of where the layered
                // hunk walk placed `current` by shifting the recorded range
                // through a deeper layer's diff. The shift is double-counting:
                // the anchor was re-anchored to the worktree range, so applying
                // the worktree diff on top of it moves `current` off the
                // content even though the content sits exactly where the anchor
                // records it. A genuine relocation (the recorded-range slice
                // does *not* match) falls through to the layered classification
                // below and may still be `Moved`; `--head`/`--staged` views do
                // not enable the worktree layer, so they are unaffected.
                let worktree_recorded_fresh = state.layers.worktree
                    && !r.stored_hash.is_empty()
                    && r.blob.is_empty()
                    && t.path == r.path
                    && {
                        format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_indexed(
                            file_idx,
                            &AnchorExtent::LineRange {
                                start: anchored_start,
                                end: anchored_end,
                            },
                        ))) == r.stored_hash
                    };

                (equal, worktree_recorded_fresh)
            }; // cached_idx / file_idx borrow released

            // Compute per-layer drift: compare each enabled layer's content
            // independently against the anchor. Emit a Finding per drifting
            // layer in shallow-to-deep order (I → W → H).
            let computed_layer_sources = compute_layer_sources(
                repo,
                &r,
                &head_tracked,
                &index_tracked,
                &worktree_tracked,
                &mut *state,
                &anchored_lines,
                anchored_start,
                anchored_end,
                cfg.ignore_whitespace,
                index_hunk_applied,
                worktree_hunk_applied,
                &index_blob_oid,
            )?;

            let inferred_source = computed_layer_sources.first().copied();

            // A committed cross-path rename relocates the anchored content
            // to a new path. The mesh stores an address plus a content
            // hash, so when the stored content is still present (here, at
            // the rename-followed `head_tracked` path) the correct state
            // is `Moved`, not `Deleted` — the `if equal` branch below
            // classifies it as `Moved` with `current` at the new path.
            // File-backed `Moved`: when the tracked-range content no
            // longer matches `stored_hash`, the same content may have
            // relocated within the file (lines shifted, block moved).
            // Scan for the relocated window before classifying `Changed`.
            let file_backed = !r.stored_hash.is_empty() && r.blob.is_empty();
            let span = (anchored_end as usize).saturating_sub(anchored_start as usize) + 1;
            let relocated: Option<(u32, u32)> = if !equal && file_backed {
                // Re-acquire the cached line index (built during the
                // freshness block above — always a hit).
                match state.session.get_line_index(&t.path, deepest_layer) {
                    Some(cached_idx) => {
                        find_relocated_range_indexed(
                            cached_idx.get(),
                            span,
                            &r.stored_hash,
                            anchored_start,
                        )
                    }
                    None => {
                        // Defensive: if the cache entry is somehow absent,
                        // fall back to the un-indexed scan.
                        find_relocated_range(&cur_text, span, &r.stored_hash, anchored_start)
                    }
                }
            } else {
                None
            };
            // Cross-path relocation: the stored content was duplicated
            // verbatim to a different tracked path (e.g. a staged
            // copy-then-replace, or a committed `git mv` whose rename
            // detection the follow-walk did not pick up). When the
            // anchored range still resolves but no longer matches, scan
            // other tracked paths for the exact stored content before
            // classifying `Changed`.
            let relocated_path: Option<(String, u32, u32)> =
                if !equal && file_backed && relocated.is_none() {
                    let anchored_absent_at_head = state.head_blob_at(repo, &r.path)?.is_none();
                    find_relocated_range_in_paths(
                        repo,
                        state,
                        deepest_layer,
                        span,
                        &r.stored_hash,
                        &r.path,
                        anchored_absent_at_head,
                    )
                } else {
                    None
                };

            let cur_blob_oid = if worktree_hunk_applied {
                None
            } else if state.layers.index && index_blob_oid.is_some() {
                index_blob_oid.as_deref().and_then(|o| oid_from_hex(o).ok())
            } else {
                cur_blob
            };

            if worktree_recorded_fresh {
                status = AnchorStatus::Fresh;
                source = None;
                layer_sources = vec![];
                current_loc = Some(AnchorLocation {
                    path: PathBuf::from(r.path.clone()),
                    extent: AnchorExtent::LineRange {
                        start: anchored_start,
                        end: anchored_end,
                    },
                    blob: cur_blob_oid,
                });
            } else if equal {
                if t.path == r.path && t.start == anchored_start && t.end == anchored_end {
                    status = AnchorStatus::Fresh;
                    source = None;
                    layer_sources = vec![];
                } else {
                    status = AnchorStatus::Moved;
                    source = inferred_source;
                    // MOVED means bytes are equal; per design requirement 4,
                    // keep the single-row shape (source=first drifting layer).
                    layer_sources = if let Some(s) = inferred_source {
                        vec![s]
                    } else {
                        vec![]
                    };
                }
                current_loc = Some(AnchorLocation {
                    path: PathBuf::from(t.path.clone()),
                    extent: AnchorExtent::LineRange {
                        start: t.start,
                        end: t.end,
                    },
                    blob: cur_blob_oid,
                });
            } else if let Some((rstart, rend)) = relocated {
                // Content found intact at a different range → Moved.
                status = AnchorStatus::Moved;
                source = inferred_source.or(Some(deepest_layer));
                layer_sources = if let Some(s) = inferred_source {
                    vec![s]
                } else {
                    vec![deepest_layer]
                };
                current_loc = Some(AnchorLocation {
                    path: PathBuf::from(t.path.clone()),
                    extent: AnchorExtent::LineRange {
                        start: rstart,
                        end: rend,
                    },
                    blob: cur_blob_oid,
                });
            } else if let Some((rpath, rstart, rend)) = relocated_path {
                // Exact stored content found verbatim at a different
                // path → Moved.
                status = AnchorStatus::Moved;
                source = Some(deepest_layer);
                layer_sources = vec![deepest_layer];
                current_loc = Some(AnchorLocation {
                    path: PathBuf::from(rpath),
                    extent: AnchorExtent::LineRange {
                        start: rstart,
                        end: rend,
                    },
                    blob: None,
                });
            } else if file_backed && current_lines.len() < anchored_start as usize {
                // The tracked range no longer exists: the current file is
                // shorter than the anchored range's start line, so the
                // anchored content was not changed-in-place — it was
                // deleted (the file was truncated past where the anchor
                // pointed). No in-file or cross-path relocation matched
                // the stored content, so this is a genuine deletion of
                // the tracked region, not a `Changed`. Per the card's
                // distinct state vocabulary this is `Deleted`.
                status = AnchorStatus::Deleted;
                source = None;
                layer_sources = vec![];
                current_loc = None;
            } else {
                status = AnchorStatus::Changed;
                source = inferred_source.or(Some(deepest_layer));
                layer_sources = if computed_layer_sources.is_empty() {
                    vec![deepest_layer]
                } else {
                    computed_layer_sources
                };
                // Content-equivalence gate for `--fix`. `content_equivalent`
                // is true only when the current slice is a whitespace-only
                // reshaping of the *genuine* original anchored slice. For
                // file-backed anchors `a_slice` reads the HEAD blob, which may
                // already carry the change (HEAD-layer drift); verify it is
                // the true original by hashing it against `stored_hash`. When
                // the original bytes are unrecoverable the hash mismatches and
                // we leave the anchor drifting — fail-closed. Pinned-blob
                // anchors read `a_slice` from the anchored blob, so it is the
                // original by construction.
                let anchored_is_original = if !r.stored_hash.is_empty() && r.blob.is_empty() {
                    let a_joined = a_slice.join("\n");
                    format!("{RK64_ALGORITHM}:{}",
                        rk64_to_hex(cheap_fingerprint_with_extent(
                            a_joined.as_bytes(),
                            &AnchorExtent::WholeFile,
                        )))
                        == r.stored_hash
                } else {
                    !r.blob.is_empty()
                };
                content_equivalent =
                    anchored_is_original && lines_equal(a_slice, c_slice, true);
                current_loc = Some(AnchorLocation {
                    path: PathBuf::from(t.path.clone()),
                    extent: AnchorExtent::LineRange {
                        start: t.start,
                        end: t.end,
                    },
                    blob: cur_blob_oid,
                });
            }
        }
    }

    Ok(AnchorResolved {
        anchor_id: anchor_id.into(),
        anchor_sha: r.anchor_sha,
        anchored,
        current: current_loc,
        status,
        content_equivalent,
        source,
        layer_sources,
        acknowledged_by: None,
        locus: None,
    })
}

fn unavailable(
    anchor_id: &str,
    r: &Anchor,
    anchored: AnchorLocation,
    reason: UnavailableReason,
) -> AnchorResolved {
    AnchorResolved {
        anchor_id: anchor_id.into(),
        anchor_sha: r.anchor_sha.clone(),
        anchored,
        current: None,
        status: AnchorStatus::ContentUnavailable(reason),
        content_equivalent: false,
        source: None,
        layer_sources: vec![],
        acknowledged_by: None,
        locus: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn clean_head_fast_path(
    repo: &gix::Repository,
    state: &mut EngineState,
    anchor_id: &str,
    r: &Anchor,
    anchored: AnchorLocation,
    head_loc: &Option<Tracked>,
    anchored_start: u32,
    anchored_end: u32,
) -> Result<Option<AnchorResolved>> {
    if !super::anchor_path_is_layer_clean(state, &r.path) {
        return Ok(None);
    }
    let Some(t) = head_loc.as_ref() else {
        return Ok(None);
    };
    if state.filter_short_circuit(repo, &t.path)?.is_some() {
        return Ok(None);
    }
    let Some(head_blob) = state.head_blob_at(repo, &t.path)? else {
        return Ok(None);
    };
    if head_blob != r.blob {
        return Ok(None);
    }
    // A committed cross-path rename relocates the anchored content. The
    // mesh stores an address plus a content hash; the rename-followed
    // `t.path` still holds the stored bytes, so the correct state is
    // `Moved` (handled by the `status` computation below), never
    // `Deleted`.
    let status = if t.path == r.path && t.start == anchored_start && t.end == anchored_end {
        AnchorStatus::Fresh
    } else {
        AnchorStatus::Moved
    };
    let current_blob = if state.layers.worktree {
        None
    } else {
        oid_from_hex(&head_blob).ok()
    };
    state.session.anchors_fast_path_hits += 1;
    Ok(Some(AnchorResolved {
        anchor_id: anchor_id.into(),
        anchor_sha: r.anchor_sha.clone(),
        anchored,
        current: Some(AnchorLocation {
            path: PathBuf::from(t.path.clone()),
            extent: AnchorExtent::LineRange {
                start: t.start,
                end: t.end,
            },
            blob: current_blob,
        }),
        status,
        content_equivalent: false,
        source: None,
        layer_sources: vec![],
        acknowledged_by: None,
        locus: None,
    }))
}

/// Compute the list of layers that drift from the *next-deeper* layer, in
/// shallow-to-deep order: Worktree → Index → Head.
///
/// Each enabled layer is compared against its next-deeper neighbor:
/// - Worktree vs Index: worktree drifts when (a) the path is present in
///   the index but absent in the worktree, (b) a worktree hunk was
///   applied for the path, or (c) the resolved worktree slice differs
///   from the index slice at the anchored range.
/// - Index vs Head: index drifts when (a) the path is present at HEAD
///   but absent in the index, (b) an index hunk was applied, or (c) the
///   resolved index slice differs from the HEAD slice at the anchored
///   range.
/// - Head vs Anchor: HEAD drifts when (a) the path is absent from HEAD or
///   (b) HEAD's slice differs from the anchored slice.
///
/// The `source` returned by the caller is the first (shallowest) entry of
/// the resulting list; `layer_sources` is the full list. Both follow the
/// shallow-to-deep order Worktree → Index → Head.
#[allow(clippy::too_many_arguments)]
fn compute_layer_sources(
    repo: &gix::Repository,
    r: &Anchor,
    head_tracked: &Option<Tracked>,
    index_tracked: &Option<Tracked>,
    worktree_tracked: &Option<Tracked>,
    state: &mut EngineState,
    anchored_lines: &[&str],
    anchored_start: u32,
    anchored_end: u32,
    ignore_ws: bool,
    index_hunk_applied: bool,
    worktree_hunk_applied: bool,
    index_blob_oid: &Option<String>,
) -> Result<Vec<DriftSource>> {
    let layer_index = state.layers.index;
    let layer_worktree = state.layers.worktree;

    // Read each layer's content as text, scoped to the layer's tracked
    // path. `None` represents "path absent at this layer".
    let head_text: Option<(String, Tracked)> = match head_tracked.as_ref() {
        None => None,
        Some(t) => {
            if state.filter_short_circuit(repo, &t.path)?.is_some() {
                // Fail-closed: can't read — treat as "absent" so adjacent
                // comparisons surface drift.
                None
            } else {
                let oid = state.head_blob_at(repo, &t.path)?;
                let txt = match &oid {
                    Some(o) => git::read_git_text(repo, o).unwrap_or_default(),
                    None => String::new(),
                };
                Some((txt, t.clone()))
            }
        }
    };

    let index_text: Option<(String, Tracked)> = if layer_index {
        match index_tracked.as_ref() {
            None => None,
            Some(t) => {
                let oid = if index_hunk_applied {
                    match index_blob_oid.clone() {
                        Some(o) => Some(o),
                        None => state.head_blob_at(repo, &t.path)?,
                    }
                } else {
                    state.head_blob_at(repo, &t.path)?
                };
                let txt = match &oid {
                    Some(o) => read_blob_text(repo, o),
                    None => String::new(),
                };
                Some((txt, t.clone()))
            }
        }
    } else {
        head_text.clone()
    };

    let worktree_text: Option<(String, Tracked)> = if layer_worktree {
        match worktree_tracked.as_ref() {
            None => None,
            Some(t) => {
                if worktree_hunk_applied {
                    match read_worktree_normalized(repo, &mut state.custom_filters, &t.path) {
                        Ok(bytes) => Some((string_from_utf8_lossy(&bytes), t.clone())),
                        Err(_) => None,
                    }
                } else {
                    let oid = match index_blob_oid.clone() {
                        Some(o) => Some(o),
                        None => state.head_blob_at(repo, &t.path)?,
                    };
                    let txt = match &oid {
                        Some(o) => read_blob_text(repo, o),
                        None => String::new(),
                    };
                    Some((txt, t.clone()))
                }
            }
        }
    } else {
        index_text.clone()
    };

    let mut sources: Vec<DriftSource> = Vec::new();

    // Worktree drifts from Index when (a) worktree absent while index
    // present, or (b) the worktree slice differs from the index slice.
    if layer_worktree {
        let drifts = match (&worktree_text, &index_text) {
            (None, Some(_)) => true,
            (Some(_), None) => false,
            (None, None) => false,
            (Some((wt_txt, wt_t)), Some((idx_txt, idx_t))) => {
                slice_pair_differs(wt_txt, wt_t, idx_txt, idx_t, ignore_ws)
            }
        };
        if drifts {
            sources.push(DriftSource::Worktree);
        }
    }

    // Index drifts from HEAD when (a) index absent while HEAD present,
    // or (b) the index slice differs from the HEAD slice.
    if layer_index {
        let drifts = match (&index_text, &head_text) {
            (None, Some(_)) => true,
            (Some(_), None) => false,
            (None, None) => false,
            (Some((idx_txt, idx_t)), Some((head_txt, head_t))) => {
                slice_pair_differs(idx_txt, idx_t, head_txt, head_t, ignore_ws)
            }
        };
        if drifts {
            sources.push(DriftSource::Index);
        }
    }

    // HEAD drifts from the anchor when (a) HEAD absent or (b) HEAD slice
    // differs from anchored slice (old model) or (c) HEAD content hash
    // does not match stored_hash (file-backed model).
    let head_drifts = if !r.stored_hash.is_empty() && r.blob.is_empty() {
        match &head_text {
            None => true,
            Some((txt, t)) => {
                let head_lines: Vec<&str> = txt.lines().collect();
                let h_lo = (t.start as usize).saturating_sub(1);
                let h_hi = (t.end as usize).min(head_lines.len());
                let head_slice_text: String = if h_lo < h_hi {
                    head_lines[h_lo..h_hi].join("\n")
                } else {
                    String::new()
                };
                let head_hash = format!("{RK64_ALGORITHM}:{}", rk64_to_hex(cheap_fingerprint_with_extent(
                    head_slice_text.as_bytes(),
                    &AnchorExtent::WholeFile,
                )));
                head_hash != r.stored_hash
            }
        }
    } else {
        match &head_text {
            None => true,
            Some((txt, t)) => slice_differs(
                txt,
                t,
                anchored_lines,
                anchored_start,
                anchored_end,
                ignore_ws,
            ),
        }
    };
    if head_drifts {
        sources.push(DriftSource::Head);
    }

    Ok(sources)
}

/// Compare two layers' slices at their respective tracked ranges.
/// Returns `true` when the slices differ.
fn slice_pair_differs(
    a_text: &str,
    a_t: &Tracked,
    b_text: &str,
    b_t: &Tracked,
    ignore_ws: bool,
) -> bool {
    let a_lines: Vec<&str> = a_text.lines().collect();
    let b_lines: Vec<&str> = b_text.lines().collect();
    let a_lo = (a_t.start as usize).saturating_sub(1);
    let a_hi = (a_t.end as usize).min(a_lines.len());
    let b_lo = (b_t.start as usize).saturating_sub(1);
    let b_hi = (b_t.end as usize).min(b_lines.len());
    let a_slice = if a_lo <= a_hi {
        &a_lines[a_lo..a_hi]
    } else {
        &[][..]
    };
    let b_slice = if b_lo <= b_hi {
        &b_lines[b_lo..b_hi]
    } else {
        &[][..]
    };
    !lines_equal(a_slice, b_slice, ignore_ws)
}
