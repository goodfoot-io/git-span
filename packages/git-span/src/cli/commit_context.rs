//! Complete current relationship context selected by immutable commit changes.

use super::{CommitContextArgs, context::ContextSpan};
use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const COMMIT_CONTEXT_SCHEMA_VERSION: u32 = 1;
pub const MAX_COMMIT_CONTEXT_COMMITS: usize = 4096;
pub const MAX_COMMIT_CONTEXT_COMPARISONS: usize = 8192;
pub const MAX_COMMIT_CONTEXT_HISTORY_COMMITS: usize = 4096;
pub const MAX_COMMIT_CONTEXT_HUNKS: usize = 65536;
pub const MAX_COMMIT_CONTEXT_BLOB_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_COMMIT_CONTEXT_JSON_BYTES: usize = 16 * 1024 * 1024;

/// A complete report: immutable selection identities plus full current spans.
///
/// `overlaps` on each span is empty: membership derives from commit changes,
/// not address scopes. Any incomplete selection or mapping is an error before
/// this envelope is rendered, and inspection never refreshes span definitions.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(deny_unknown_fields)]
pub struct CommitContextDocument {
    pub schema_version: u32,
    pub commits: Vec<String>,
    pub spans: Vec<ContextSpan>,
}

/// Query full current context using complete, immutable commit object IDs.
///
/// Selection unions every selected commit's changes against all its parents
/// (or the empty tree for roots). Coordinate projection uses deterministic
/// tree correspondence, including complete replacement regions; removed
/// extents stay absent. Current state is revalidated after historical work.
pub fn query_commit_context(
    _repo: &gix::Repository,
    _commits: &[String],
    _span_root: &str,
) -> Result<CommitContextDocument> {
    anyhow::bail!("commit-context is not implemented")
}

/// Render one bounded, all-or-nothing JSON commit-context envelope.
pub fn run_commit_context(
    _repo: &gix::Repository,
    _args: CommitContextArgs,
    _span_root: &str,
) -> Result<i32> {
    anyhow::bail!("commit-context is not implemented")
}
