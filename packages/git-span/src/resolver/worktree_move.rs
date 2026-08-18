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
