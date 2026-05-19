//! Acknowledgment matching + pending-finding builder.
//!
//! File-backed model: there is no staging area. `add`/`remove`/`why`
//! edit worktree mesh files directly, so the worktree layer of the
//! reader already reflects every change — there is nothing to
//! "acknowledge" and no pending op stream. These functions are retained
//! as inert no-ops so the engine and renderers keep a stable shape.

use crate::types::{AnchorResolved, PendingFinding};

/// No-op in the file-backed model (there is no staging acknowledgment).
pub(crate) fn apply_acknowledgment(
    _repo: &gix::Repository,
    _mesh_name: &str,
    _r: &mut AnchorResolved,
) {
}

/// Always empty in the file-backed model (there is no staging area).
pub fn build_pending_findings(_repo: &gix::Repository, _mesh_name: &str) -> Vec<PendingFinding> {
    Vec::new()
}
