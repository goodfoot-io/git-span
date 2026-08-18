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
pub(crate) fn find_worktree_move(
    repo: &gix::Repository,
    concurrent: &ConcurrentSession,
    path: &str,
    last_blob_oid: ObjectId,
) -> Result<WorktreeMove> {
    let _ = (repo, concurrent, path, last_blob_oid);
    Ok(WorktreeMove::None)
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
    #[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
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
    #[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
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
    #[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
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
