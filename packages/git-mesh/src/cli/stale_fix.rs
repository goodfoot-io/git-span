//! `git mesh stale --fix` — rewrite `Moved` and `Changed` anchors in
//! place by editing the mesh worktree files. No commit is produced; the
//! operator inspects the rewrite with `git diff` and stages it manually.
//!
//! The per-layer hashing rule (Worktree > Index > HEAD) drives both
//! which layer's content to read and which hashing convention to use.
//! `current.blob` is unreliable on the `Changed`/`Moved` branches (see
//! `notes/current-blob-unreliable-for-fix.md`), so we read content per
//! surfacing layer rather than via `current.blob`.

use crate::cli::commit::{hash_anchor_content, read_worktree_mesh,
    write_worktree_mesh};
use crate::git::IndexEntrySnapshot;
use crate::mesh_file::{AnchorRecord, MeshFile};
use crate::types::{AnchorExtent, AnchorStatus, DriftSource, MeshResolved};
use anyhow::Result;
use git_mesh_core::{cheap_fingerprint_with_extent, rk64_to_hex, RK64_ALGORITHM};
use std::collections::{BTreeMap, HashMap, HashSet};

/// Carries the result of a single `apply_fix` invocation.
pub(crate) struct FixResult {
    /// Anchor ids actually rewritten or merged this invocation.
    /// Used by `run_stale` for the exit-code subtraction and the
    /// "auto-updated" tag.
    pub(crate) rewritten_anchor_ids: HashSet<String>,
    /// Names of mesh files written to disk (`write_worktree_mesh` called).
    /// Exact: a name appears here iff `any_rewritten || coalesced` was true
    /// for that mesh.  Used by `run_stale` to scope the post-fix re-resolve.
    pub(crate) rewritten_mesh_names: HashSet<String>,
}

/// Re-anchor every `Moved`/`Changed` anchor in `meshes` by rewriting the
/// matching mesh worktree files. Returns a [`FixResult`] carrying the set of
/// `anchor_id`s actually rewritten and the set of mesh names whose files were
/// written to disk.
///
/// Terminal statuses (`Deleted`, `ContentUnavailable`, `MergeConflict`,
/// `Submodule`, `Orphaned`) are left untouched. `Fresh` anchors are not
/// candidates either.
pub(crate) fn apply_fix(
    repo: &gix::Repository,
    meshes: &[MeshResolved],
    mesh_root: &str,
) -> Result<FixResult> {
    let mut rewritten: HashSet<String> = HashSet::new();
    let mut rewritten_mesh_names: HashSet<String> = HashSet::new();

    // Resolve HEAD once for HEAD-layer rewrites. Some test scenarios may
    // have no HEAD yet (unborn branch); in that case we simply skip
    // HEAD-layer rewrites and leave the affected anchors as-is.
    let head_oid: Option<String> = repo
        .rev_parse_single("HEAD")
        .ok()
        .map(|id| id.detach().to_string());

    // Materialize the index snapshot once — shared by every
    // hash_anchor_content call and the Index-layer hash path below.
    let index_snapshot: Option<Vec<IndexEntrySnapshot>> =
        crate::git::index_entries(repo).ok();

    for m in meshes {
        // Read the on-disk mesh file. If it cannot be parsed (e.g. textual
        // conflict markers), skip the mesh entirely — operator must resolve.
        let mut mesh_file = match read_worktree_mesh(repo, mesh_root, &m.name) {
            Ok(mf) => mf,
            Err(_) => continue,
        };

        let mut any_rewritten = false;

        // Repair interior anchors in place: drop every anchor record whose
        // path falls inside the mesh root. `parse` is pure, so a poisoned
        // mesh loads fine and `--fix` can excise the offending anchor rather
        // than silently no-opping past it. The remaining loud surfacing in
        // `run_stale` covers any mesh `--fix` does not write (e.g. the anchor
        // lived only in a non-worktree layer).
        let before = mesh_file.anchors.len();
        mesh_file
            .anchors
            .retain(|r| crate::mesh_root::classify_interior_anchor(mesh_root, &r.path).is_none());
        if mesh_file.anchors.len() != before {
            any_rewritten = true;
        }

        for resolved in &m.anchors {
            // Re-anchor `Moved` unconditionally (bytes are identical, only
            // relocated). Re-anchor `Changed` only when the change preserved
            // the anchored content (whitespace/formatting-equivalent); a
            // meaning-changing edit is left drifting so the coupling
            // resurfaces. Everything else (Fresh, terminal) is skipped.
            let reanchor = match resolved.status {
                AnchorStatus::Moved => true,
                AnchorStatus::Changed => resolved.content_equivalent,
                _ => false,
            };
            if !reanchor {
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
            let idx = index_snapshot.as_deref().unwrap_or(&[]);
            let hash_hex: String = match layer {
                DriftSource::Worktree => {
                    match hash_anchor_content(repo, &cur_path_str, &cur_extent, None, idx) {
                        Ok((_alg, h)) => h,
                        Err(_) => continue,
                    }
                }
                DriftSource::Head => {
                    let oid = match head_oid.as_deref() {
                        Some(o) => o,
                        None => continue,
                    };
                    match hash_anchor_content(repo, &cur_path_str, &cur_extent, Some(oid), idx) {
                        Ok((_alg, h)) => h,
                        Err(_) => continue,
                    }
                }
                DriftSource::Index => {
                    // Read the index entry's blob bytes, then hash per extent.
                    let entry = match index_snapshot
                        .as_deref()
                        .unwrap_or(&[])
                        .iter()
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
                    rk64_to_hex(cheap_fingerprint_with_extent(&bytes, &cur_extent))
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
            record.algorithm = RK64_ALGORITHM.to_string();
            record.content_hash = hash_hex;
            rewritten.insert(resolved.anchor_id.clone());
            any_rewritten = true;
        }

        // Record keys (path, start, end) of anchors eligible to participate
        // in a line-range merge. A record is mergeable ONLY when it is
        // "worktree-fresh after the rewrite pass" — its recorded content
        // matches the worktree at its extent — so the worktree union hash
        // `coalesce_line_ranges` recomputes is provably correct. Anything
        // else (terminal drift, non-worktree-layer drift, a Moved/Changed
        // that failed to rewrite) is a barrier. Built after the rewrite loop
        // because the Moved/Changed branch depends on the `rewritten` set.
        let mut mergeable_keys: HashSet<(String, u32, u32)> = HashSet::new();
        for resolved in &m.anchors {
            match resolved.status {
                AnchorStatus::Fresh => {
                    // Fresh anchors are not rewritten; their record still
                    // carries the anchored address and is worktree-fresh.
                    let (s, e) = match resolved.anchored.extent {
                        AnchorExtent::LineRange { start, end } => (start, end),
                        AnchorExtent::WholeFile => (0, 0),
                    };
                    mergeable_keys.insert((
                        resolved.anchored.path.to_string_lossy().to_string(),
                        s,
                        e,
                    ));
                }
                AnchorStatus::Moved | AnchorStatus::Changed => {
                    // Eligible only when it was actually rewritten this pass
                    // and its deepest drift layer is the worktree (so the
                    // rewritten record hashes the worktree content). The loop
                    // rewrote the record to `current`'s path/extent.
                    if !rewritten.contains(&resolved.anchor_id) {
                        continue;
                    }
                    let Some(current) = &resolved.current else {
                        continue;
                    };
                    let deepest = resolved
                        .layer_sources
                        .iter()
                        .copied()
                        .max_by_key(|s| match s {
                            DriftSource::Worktree => 3,
                            DriftSource::Index => 2,
                            DriftSource::Head => 1,
                        });
                    if deepest != Some(DriftSource::Worktree) {
                        continue;
                    }
                    let (s, e) = match current.extent {
                        AnchorExtent::LineRange { start, end } => (start, end),
                        AnchorExtent::WholeFile => (0, 0),
                    };
                    mergeable_keys
                        .insert((current.path.to_string_lossy().to_string(), s, e));
                }
                // Terminal statuses are never eligible.
                _ => {}
            }
        }

        // Normalize line-range anchors: collapse every contiguous or
        // overlapping pair on the same path into a single anchor. This runs
        // over the records as they stand after the per-anchor rewrite —
        // both ranges this run relocated and ranges that were already
        // adjacent in the authored mesh — so the written file is fully
        // normalized regardless of whether anything was re-anchored.
        let coalesced = coalesce_line_ranges(
            repo,
            &m.name,
            &mut mesh_file,
            &mergeable_keys,
            &mut rewritten,
            index_snapshot.as_deref().unwrap_or(&[]),
        );

        if any_rewritten || coalesced {
            write_worktree_mesh(repo, mesh_root, &m.name, &mut mesh_file)?;
            rewritten_mesh_names.insert(m.name.clone());
        }
    }

    Ok(FixResult {
        rewritten_anchor_ids: rewritten,
        rewritten_mesh_names,
    })
}

/// Coalesce contiguous and overlapping line-range anchors on the same path
/// within a single mesh's records, in place.
///
/// Two line-range anchors on one `path` merge when their `[start, end]`
/// intervals overlap or are contiguous (`a.end + 1 >= b.start` after
/// sorting by `start`); the merged anchor spans `min(start)..max(end)` and
/// carries one freshly recomputed rk64 fingerprint over that combined extent.
/// A pair merges only when both contributing anchors are eligible — i.e.
/// each record's key is in `mergeable_keys`, the set of anchors that are
/// worktree-fresh after the rewrite pass (`Fresh` anchors, or `Moved`/
/// `Changed` anchors rewritten this pass whose deepest drift layer is the
/// worktree). A record NOT in `mergeable_keys` is a barrier: it breaks any
/// run and is passed through unchanged. This restriction is what makes
/// hashing the merged union from the worktree always correct — every merged
/// run is worktree-fresh, so its recomputed worktree union hash matches the
/// layer the per-anchor pass resolved, and the merged anchor re-resolves
/// `Fresh`. Terminal anchors (`Deleted`, `MergeConflict`, `Submodule`,
/// `ContentUnavailable`) and non-worktree-layer drift (committed/staged
/// edits with a clean worktree at the extent) are thus never folded in, so
/// the merge never papers over drift the operator still needs to see. The
/// combined region must also hash without conflict; a union the worktree
/// cannot hash is left as distinct anchors.
///
/// Whole-file anchors (`0/0`) are inert: they never merge with line-range
/// anchors on the same path and are never split or absorbed.
///
/// The `anchor_id` of every merged anchor is inserted into `merged_ids`
/// (the set the caller subtracts from the post-fix exit code) so the
/// collapsed range does not surface as residual drift. Returns `true` when
/// at least one merge changed the record set.
///
/// Cost: grouping is O(n) per mesh, sorting each path's ranges is
/// O(n log n) (dominant), and the sweep is O(n) — O(N log N) across N
/// anchors. The only added I/O is one hash recompute per extension via the
/// hashing path `--fix` already uses; whole-file anchors add nothing.
fn coalesce_line_ranges(
    repo: &gix::Repository,
    mesh_name: &str,
    mesh_file: &mut MeshFile,
    mergeable_keys: &HashSet<(String, u32, u32)>,
    merged_ids: &mut HashSet<String>,
    index_snapshot: &[IndexEntrySnapshot],
) -> bool {
    // Group line-range record indices by path; whole-file anchors (0/0) are
    // inert and never enter a group. BTreeMap keeps path iteration order
    // deterministic.
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, r) in mesh_file.anchors.iter().enumerate() {
        if r.start_line == 0 && r.end_line == 0 {
            continue;
        }
        groups.entry(r.path.clone()).or_default().push(i);
    }

    // A merged run emits its anchor at the lowest original index among its
    // members; the remaining members are dropped. Single-member runs leave
    // their record untouched.
    let mut replacement: HashMap<usize, AnchorRecord> = HashMap::new();
    let mut dropped: HashSet<usize> = HashSet::new();

    for (path, mut idxs) in groups {
        idxs.sort_by_key(|&i| {
            let r = &mesh_file.anchors[i];
            (r.start_line, r.end_line)
        });

        // Current run: member indices, span, and the union hash recorded on
        // the last successful extension (`None` while the run is a single
        // member, which keeps its original hash).
        let mut run: Option<(Vec<usize>, u32, u32, Option<String>)> = None;

        let flush = |run: Option<(Vec<usize>, u32, u32, Option<String>)>,
                         replacement: &mut HashMap<usize, AnchorRecord>,
                         dropped: &mut HashSet<usize>,
                         merged_ids: &mut HashSet<String>| {
            let Some((members, start, end, hash)) = run else {
                return;
            };
            if members.len() < 2 {
                return;
            }
            let emit_at = *members.iter().min().expect("run is non-empty");
            let content_hash = hash.expect("multi-member run records a union hash");
            replacement.insert(
                emit_at,
                AnchorRecord {
                    path: path.clone(),
                    start_line: start,
                    end_line: end,
                    algorithm: RK64_ALGORITHM.to_string(),
                    content_hash,
                },
            );
            for &i in &members {
                if i != emit_at {
                    dropped.insert(i);
                }
            }
            merged_ids.insert(format!("{mesh_name}:{path}:L{start}-L{end}"));
        };

        for &i in &idxs {
            let r = &mesh_file.anchors[i];
            let is_mergeable =
                mergeable_keys.contains(&(r.path.clone(), r.start_line, r.end_line));

            if !is_mergeable {
                // Barrier: a record that is not worktree-fresh (terminal or
                // non-worktree-layer drift) breaks any run and never merges.
                flush(run.take(), &mut replacement, &mut dropped, merged_ids);
                continue;
            }

            match run.take() {
                None => {
                    run = Some((vec![i], r.start_line, r.end_line, None));
                }
                Some((mut members, start, end, hash)) => {
                    if r.start_line <= end.saturating_add(1) {
                        // Contiguous or overlapping: only merge if the
                        // combined extent hashes cleanly against the worktree.
                        let new_end = end.max(r.end_line);
                        let extent = AnchorExtent::LineRange {
                            start,
                            end: new_end,
                        };
                        match hash_anchor_content(repo, &path, &extent, None, index_snapshot) {
                            Ok((_alg, h)) => {
                                members.push(i);
                                run = Some((members, start, new_end, Some(h)));
                            }
                            Err(_) => {
                                // Union cannot be hashed: keep both separate.
                                flush(
                                    Some((members, start, end, hash)),
                                    &mut replacement,
                                    &mut dropped,
                                    merged_ids,
                                );
                                run = Some((vec![i], r.start_line, r.end_line, None));
                            }
                        }
                    } else {
                        flush(
                            Some((members, start, end, hash)),
                            &mut replacement,
                            &mut dropped,
                            merged_ids,
                        );
                        run = Some((vec![i], r.start_line, r.end_line, None));
                    }
                }
            }
        }

        flush(run.take(), &mut replacement, &mut dropped, merged_ids);
    }

    if replacement.is_empty() {
        return false;
    }

    let mut new_anchors = Vec::with_capacity(mesh_file.anchors.len());
    for (i, r) in mesh_file.anchors.iter().enumerate() {
        if let Some(merged) = replacement.get(&i) {
            new_anchors.push(merged.clone());
        } else if !dropped.contains(&i) {
            new_anchors.push(r.clone());
        }
    }
    mesh_file.anchors = new_anchors;
    true
}
