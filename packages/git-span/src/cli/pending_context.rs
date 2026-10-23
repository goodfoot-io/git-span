//! Read-only, comparison-aware membership with complete current span evidence.

use super::{PendingContextArgs, context::ContextDocument};
use anyhow::Result;

/// Collect a coherent complete document, or fail without partial output.
///
/// Selection uses the requested Git comparison; returned scopes/overlaps are
/// empty because comparison-layer membership is not context-address overlap.
pub fn pending_context(
    _repo: &gix::Repository,
    _args: &PendingContextArgs,
    _span_root: &str,
) -> Result<ContextDocument> {
    anyhow::bail!("pending-context: Not Implemented")
}

/// Print exactly one schema-v2 document after successful complete collection.
pub fn run_pending_context(
    _repo: &gix::Repository,
    _args: PendingContextArgs,
    _span_root: &str,
) -> Result<i32> {
    anyhow::bail!("pending-context: Not Implemented")
}
