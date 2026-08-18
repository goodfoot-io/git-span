//! Worktree-blob fallback for unstaged moves (card main-264).
//!
//! When an anchor's path is gone from the worktree but still resolves at
//! HEAD (and neither history nor the index explains a rename), the fallback
//! hashes the anchor's last-known blob and searches the worktree's
//! untracked files for an identical blob:
//!
//! - a unique match is a `Moved (uncommitted)` finding that `--fix`
//!   resolves by retiring the old address and installing the new one;
//! - several identical-content candidates fail closed into a ranked
//!   proposal (`Ambiguous`) instead of an auto-fix;
//! - no match leaves every existing branch exactly as it runs today —
//!   the fallback is strictly additive and fail-closed by construction.
//!
//! The trigger gates (file-backed, HEAD-present, worktree-layer, and the
//! skip-worktree sparse gate) live at the call sites in the classification
//! arms ([`engine::anchor`], [`engine::whole_file`]); this module owns
//! enumeration, hashing, and the decision.

use std::path::PathBuf;

use gix::ObjectId;

use crate::Result;
use crate::resolver::session::ConcurrentSession;

/// Outcome of the worktree-blob fallback search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum WorktreeMove {
    /// No untracked file has content identical to the anchor's last-known
    /// blob. Every existing branch runs exactly as today.
    None,
    /// Exactly one untracked file matches; `path` is the move destination.
    Unique { path: PathBuf },
    /// Several untracked files match; the anchor stays drifted and the
    /// candidates are surfaced as a ranked proposal (fail-closed, never a
    /// guess).
    Ambiguous { candidates: Vec<PathBuf> },
}

/// Search the worktree's untracked files for an exact-content match to the
/// anchor's last-known blob (`last_blob_oid`).
///
/// The untracked path→blob-OID map is computed once per scan on first
/// trigger and held in [`ConcurrentSession::worktree_move_cache`], shared
/// across every missing anchor in the run.
///
/// `path` is the anchored path the search is explaining. It is part of the
/// contract surface so a call site that later needs to exclude it (or
/// surface it in diagnostics) can do so without a signature change; the
/// search itself is purely content-addressed, and a tracked path never
/// appears in the untracked candidate set anyway.
pub(crate) fn find_worktree_move(
    repo: &gix::Repository,
    concurrent: &ConcurrentSession,
    path: &str,
    last_blob_oid: ObjectId,
) -> Result<WorktreeMove> {
    let _ = path;
    // Enumeration (or workdir resolution) failure collapses to `None` —
    // fail closed: no candidate knowledge, cached so the scan does not
    // retry the subprocess per anchor.
    let candidates = match concurrent.worktree_move_cache.get_or_init(|| {
        build_untracked_blob_map(repo).unwrap_or_default()
    }) {
        Some(map) => map,
        None => return Ok(WorktreeMove::None),
    };
    Ok(decide_worktree_move(candidates, last_blob_oid))
}

/// Hash every untracked worktree file to its blob OID, once per scan.
///
/// Returns `Ok(None)` when the underlying `git ls-files` enumeration fails
/// (fail-closed: the fallback knows nothing and every existing branch runs
/// as today). Per-entry failures — unreadable files, broken symlinks,
/// directories including nested-repo entries — skip the entry and never
/// abort the scan.
fn build_untracked_blob_map(
    repo: &gix::Repository,
) -> Result<Option<std::collections::HashMap<std::path::PathBuf, ObjectId>>> {
    let files = match crate::git::untracked_worktree_files(repo) {
        Ok(files) => files,
        Err(_) => return Ok(None),
    };
    let workdir = crate::git::work_dir(repo)?;
    let mut map = std::collections::HashMap::with_capacity(files.len());
    for rel in files {
        let abs = workdir.join(&rel);
        // `git ls-files -z` output is bytes; the lossy conversion in
        // `untracked_worktree_files` guarantees the resulting string is
        // valid, so the lossy view here is exact.
        let rel_str = rel.to_string_lossy();
        if let Ok(Some(oid)) = hash_untracked_entry(repo, &abs, &rel_str) {
            map.insert(rel, oid);
        }
    }
    Ok(Some(map))
}

/// Blob-OID of one untracked worktree file, `None` when the entry must be
/// skipped (directory, unreadable, broken symlink).
///
/// Hashing mirrors how git stores the file: raw bytes first, symlinks as
/// their target string, and paths carrying a non-core `filter=<name>`
/// attribute through the clean-filter pipeline ([`read_worktree_cleaned`])
/// so a clean-filtered file's untracked copy hashes to the same blob git
/// would compute for it.
fn hash_untracked_entry(
    repo: &gix::Repository,
    abs: &std::path::Path,
    rel: &str,
) -> Result<Option<ObjectId>> {
    let md = match std::fs::symlink_metadata(abs) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    // Directories — including the trailing-slash directory entries that
    // nested git repositories surface as — are never candidates.
    if md.file_type().is_dir() {
        return Ok(None);
    }
    let bytes = if md.file_type().is_symlink() {
        // A symlink's blob is its target string, not the target's content.
        let target = match std::fs::read_link(abs) {
            Ok(t) => t,
            Err(_) => return Ok(None),
        };
        target.to_string_lossy().into_owned().into_bytes()
    } else if super::layers::diff::filter_driver_for(repo, rel).is_some() {
        match super::layers::diff::read_worktree_cleaned(repo, abs, rel) {
            Ok(Some(b)) => b,
            _ => return Ok(None),
        }
    } else {
        match std::fs::read(abs) {
            Ok(b) => b,
            Err(_) => return Ok(None),
        }
    };
    Ok(Some(crate::git::hash_blob(&bytes)?))
}

/// Pure decision over the untracked candidate map: how many untracked
/// worktree files hold a blob identical to `last_blob_oid`, and which.
///
/// This is the contract the unit checks pin; `find_worktree_move` (the
/// IO-bearing search) consults it once the candidate map is built. The
/// result is fully determined by the map, so sorting happens here — equal
/// candidates render in deterministic path order, never in hash-map order.
pub(crate) fn decide_worktree_move(
    candidates: &std::collections::HashMap<std::path::PathBuf, ObjectId>,
    last_blob_oid: ObjectId,
) -> WorktreeMove {
    let mut matches: Vec<std::path::PathBuf> = candidates
        .iter()
        .filter(|(_, oid)| **oid == last_blob_oid)
        .map(|(path, _)| path.clone())
        .collect();
    matches.sort();
    match matches.len() {
        0 => WorktreeMove::None,
        1 => WorktreeMove::Unique {
            path: matches.pop().expect("len == 1"),
        },
        _ => WorktreeMove::Ambiguous { candidates: matches },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 40-hex OIDs distinct from each other, standing in for distinct blobs.
    const OID_A: &str = "1111111111111111111111111111111111111111";
    const OID_B: &str = "2222222222222222222222222222222222222222";
    const OID_C: &str = "3333333333333333333333333333333333333333";

    fn oid(hex: &str) -> ObjectId {
        ObjectId::from_hex(hex.as_bytes()).expect("valid 40-hex oid")
    }

    fn candidates(entries: &[(&str, &str)]) -> HashMap<PathBuf, ObjectId> {
        entries
            .iter()
            .map(|(path, hex)| (PathBuf::from(path), oid(hex)))
            .collect()
    }

    /// No untracked file matches the anchor's blob → `None` (today's
    /// behavior, unchanged).
    #[test]
        fn no_matching_candidate_is_none() {
        let set = candidates(&[("a.txt", OID_A), ("b.txt", OID_B)]);
        assert_eq!(decide_worktree_move(&set, oid(OID_C)), WorktreeMove::None);
        assert_eq!(
            decide_worktree_move(&HashMap::new(), oid(OID_C)),
            WorktreeMove::None
        );
    }

    /// Exactly one untracked file matches → `Unique`, that path.
    #[test]
        fn single_matching_candidate_is_unique() {
        let set = candidates(&[("a.txt", OID_A), ("b.txt", OID_B)]);
        assert_eq!(
            decide_worktree_move(&set, oid(OID_B)),
            WorktreeMove::Unique {
                path: PathBuf::from("b.txt")
            }
        );
    }

    /// Several identical-content candidates → `Ambiguous` with the paths in
    /// deterministic path order, regardless of hash-map iteration order.
    #[test]
        fn multiple_matching_candidates_are_ambiguous_in_path_order() {
        let set = candidates(&[
            ("b.txt", OID_A),
            ("a.txt", OID_A),
            ("c.txt", OID_B),
        ]);
        assert_eq!(
            decide_worktree_move(&set, oid(OID_A)),
            WorktreeMove::Ambiguous {
                candidates: vec![PathBuf::from("a.txt"), PathBuf::from("b.txt")]
            }
        );
    }
}
