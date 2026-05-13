//! HEAD-source drift-locus attribution. Walks `anchor..HEAD` forward
//! along the anchored path and returns the first commit that mutates
//! the anchored byte range (`ChangedAt`), the commit that removes or
//! renames the path (`OrphanedAt`), or marks the anchor as unreachable
//! from HEAD.
//!
//! Only meaningful when the engine attributes drift to the HEAD layer
//! (`AnchorResolved.source == Some(DriftSource::Head)`); for shallower
//! sources the caller already has a layer-local label and this walk is
//! skipped.

use crate::Result;
use crate::git;
use crate::types::{AnchorExtent, AnchorResolved, DriftLocus, DriftSource};

/// Forward-walk `anchor..HEAD` along the anchored path and return the
/// `DriftLocus` that explains the drift. Returns `None` when
/// `resolved.source != Some(Head)` or the walk finds no overlapping
/// commit; the caller falls back on the per-layer label.
pub fn drift_locus(
    repo: &gix::Repository,
    resolved: &AnchorResolved,
) -> Result<Option<DriftLocus>> {
    if resolved.source != Some(DriftSource::Head) {
        return Ok(None);
    }

    let head_hex = git::head_oid(repo)?;
    let head_id = match repo.rev_parse_single(head_hex.as_str()) {
        Ok(id) => id.detach(),
        Err(_) => return Ok(None),
    };
    let anchor_id = match repo.rev_parse_single(resolved.anchor_sha.as_str()) {
        Ok(id) => id.detach(),
        Err(_) => return Ok(Some(DriftLocus::Unreachable)),
    };

    // Determine reachability and the anchor..HEAD walk in forward
    // (oldest-first) order. `rev_walk` is newest-first by default; collect
    // and reverse.
    let walk = match repo.rev_walk([head_id]).with_hidden([anchor_id]).all() {
        Ok(w) => w,
        Err(_) => return Ok(Some(DriftLocus::Unreachable)),
    };
    let mut commits: Vec<gix::ObjectId> = Vec::new();
    for info in walk {
        match info {
            Ok(i) => commits.push(i.id),
            Err(_) => return Ok(Some(DriftLocus::Unreachable)),
        }
    }
    if commits.is_empty() {
        // Anchor is at HEAD (or beyond): no commit on the path. The
        // caller should treat this as "no Head locus".
        return Ok(None);
    }
    commits.reverse();

    let (anchored_start, anchored_end) = match resolved.anchored.extent {
        AnchorExtent::LineRange { start, end } => (start, end),
        AnchorExtent::WholeFile => return Ok(None),
    };
    let anchored_text = git::read_git_text(
        repo,
        resolved
            .anchored
            .blob
            .map(|o| o.to_string())
            .unwrap_or_default()
            .as_str(),
    )
    .unwrap_or_default();
    let anchored_lines: Vec<&str> = anchored_text.lines().collect();
    let a_lo = (anchored_start as usize).saturating_sub(1);
    let a_hi = (anchored_end as usize).min(anchored_lines.len());
    let anchored_slice: Vec<&str> = if a_lo <= a_hi {
        anchored_lines[a_lo..a_hi].to_vec()
    } else {
        Vec::new()
    };

    // Track the path across renames as we step forward.
    let current_path = resolved.anchored.path.to_string_lossy().into_owned();

    for commit_id in commits {
        let commit = match repo.find_commit(commit_id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let new_tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let parents: Vec<_> = commit.parent_ids().map(|p| p.detach()).collect();
        let old_tree = match parents.first() {
            Some(pid) => match repo.find_commit(*pid) {
                Ok(parent) => parent.tree().unwrap_or_else(|_| repo.empty_tree()),
                Err(_) => repo.empty_tree(),
            },
            None => repo.empty_tree(),
        };

        let mut opts = gix::diff::Options::default();
        opts.track_rewrites(Some(Default::default()));
        let changes = match repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(opts)) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let path_bytes = current_path.as_bytes();
        for change in changes.iter() {
            use gix::object::tree::diff::ChangeDetached;
            match change {
                ChangeDetached::Deletion { location, .. } => {
                    if location.as_slice() == path_bytes {
                        return Ok(Some(DriftLocus::OrphanedAt(commit_id)));
                    }
                }
                ChangeDetached::Rewrite {
                    source_location,
                    location,
                    ..
                } => {
                    if source_location.as_slice() == path_bytes {
                        // Rename of the anchored path: per §5, treat as
                        // orphan locus.
                        let _ = location;
                        return Ok(Some(DriftLocus::OrphanedAt(commit_id)));
                    }
                }
                ChangeDetached::Modification {
                    location,
                    previous_id,
                    id,
                    ..
                } => {
                    if location.as_slice() != path_bytes {
                        continue;
                    }
                    if range_overlaps(
                        repo,
                        previous_id,
                        id,
                        &anchored_slice,
                        anchored_start,
                        anchored_end,
                    ) {
                        return Ok(Some(DriftLocus::ChangedAt(commit_id)));
                    }
                }
                ChangeDetached::Addition { location, id, .. } => {
                    // Addition can match when the path was previously
                    // removed and reintroduced. Compare the new blob's
                    // range against the anchored slice.
                    if location.as_slice() != path_bytes {
                        continue;
                    }
                    if range_overlaps(
                        repo,
                        &gix::ObjectId::null(gix::hash::Kind::Sha1),
                        id,
                        &anchored_slice,
                        anchored_start,
                        anchored_end,
                    ) {
                        return Ok(Some(DriftLocus::ChangedAt(commit_id)));
                    }
                }
            }
        }
    }
    Ok(None)
}

/// Return `true` if the anchored byte range differs between two blobs.
/// The null OID is treated as empty content (used for synthetic
/// addition-from-nothing comparisons).
fn range_overlaps(
    repo: &gix::Repository,
    previous_id: &gix::ObjectId,
    id: &gix::ObjectId,
    anchored_slice: &[&str],
    anchored_start: u32,
    anchored_end: u32,
) -> bool {
    let prev_text = if previous_id.is_null() {
        String::new()
    } else {
        git::read_git_text(repo, &previous_id.to_string()).unwrap_or_default()
    };
    let new_text = if id.is_null() {
        String::new()
    } else {
        git::read_git_text(repo, &id.to_string()).unwrap_or_default()
    };
    let prev_lines: Vec<&str> = prev_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();
    let lo = (anchored_start as usize).saturating_sub(1);
    let hi = anchored_end as usize;
    let prev_slice: &[&str] = if lo <= prev_lines.len() {
        &prev_lines[lo..hi.min(prev_lines.len())]
    } else {
        &[]
    };
    let new_slice: &[&str] = if lo <= new_lines.len() {
        &new_lines[lo..hi.min(new_lines.len())]
    } else {
        &[]
    };
    // If the new blob's slice equals the anchored slice, this commit did
    // not mutate the anchored content (e.g. it edited a different range
    // of the file). If the previous slice equals the new slice, the
    // commit changed only lines outside the anchored range.
    let anchored = anchored_slice;
    let new_eq_anchored = new_slice == anchored;
    let prev_eq_new = prev_slice == new_slice;
    !(new_eq_anchored || prev_eq_new)
}
