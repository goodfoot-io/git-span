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
use crate::mesh_file::{AnchorRecord, MeshFile};
use crate::types::{AnchorExtent, AnchorStatus, DriftSource, MeshResolved};
use anyhow::Result;
use std::collections::{BTreeMap, HashMap, HashSet};

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

        // Record keys (path, start, end) of anchors that resolved to a
        // terminal status this pass. Terminal anchors are never rewritten,
        // so their record still carries the original anchored address. A
        // line range merge must never fold a terminal anchor in, so the
        // coalescing sweep treats these keys as barriers.
        let terminal_keys: HashSet<(String, u32, u32)> = m
            .anchors
            .iter()
            .filter(|r| {
                matches!(
                    r.status,
                    AnchorStatus::Deleted
                        | AnchorStatus::MergeConflict
                        | AnchorStatus::Submodule
                        | AnchorStatus::ContentUnavailable(_)
                )
            })
            .map(|r| {
                let (s, e) = match r.anchored.extent {
                    AnchorExtent::LineRange { start, end } => (start, end),
                    AnchorExtent::WholeFile => (0, 0),
                };
                (r.anchored.path.to_string_lossy().to_string(), s, e)
            })
            .collect();

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
            &terminal_keys,
            &mut rewritten,
        );

        if any_rewritten || coalesced {
            write_worktree_mesh(repo, mesh_root, &m.name, &mesh_file)?;
        }
    }

    Ok(rewritten)
}

/// Coalesce contiguous and overlapping line-range anchors on the same path
/// within a single mesh's records, in place.
///
/// Two line-range anchors on one `path` merge when their `[start, end]`
/// intervals overlap or are contiguous (`a.end + 1 >= b.start` after
/// sorting by `start`); the merged anchor spans `min(start)..max(end)` and
/// carries one freshly recomputed `sha256` hash over that combined extent.
/// A pair merges only when both contributing anchors resolved cleanly
/// (neither is in `terminal_keys`) and the combined region hashes without
/// conflict — a range touching a terminal anchor, or a union the worktree
/// cannot hash, is left as distinct anchors so the merge never papers over
/// drift the operator still needs to see.
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
    terminal_keys: &HashSet<(String, u32, u32)>,
    merged_ids: &mut HashSet<String>,
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
                    algorithm: "sha256".to_string(),
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
            let is_terminal =
                terminal_keys.contains(&(r.path.clone(), r.start_line, r.end_line));

            if is_terminal {
                // Barrier: a terminal anchor breaks any run and never merges.
                flush(run.take(), &mut replacement, &mut dropped, merged_ids);
                continue;
            }

            match run.take() {
                None => {
                    run = Some((vec![i], r.start_line, r.end_line, None));
                }
                Some((mut members, start, end, hash)) => {
                    if r.start_line <= end + 1 {
                        // Contiguous or overlapping: only merge if the
                        // combined extent hashes cleanly against the worktree.
                        let new_end = end.max(r.end_line);
                        let extent = AnchorExtent::LineRange {
                            start,
                            end: new_end,
                        };
                        match hash_anchor_content(repo, &path, &extent, None) {
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
