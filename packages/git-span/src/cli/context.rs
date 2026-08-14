//! Exact, batched dependency-context query.

use crate::cli::ContextArgs;
use anyhow::Result;
use serde::{Deserialize, Serialize};

pub const CONTEXT_SCHEMA_VERSION: u32 = 1;
pub const MAX_CONTEXT_ADDRESSES: usize = 4096;
pub const MAX_CONTEXT_DETAIL_BYTES: usize = 4096;
pub const MAX_CONTEXT_JSON_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContextExtent {
    Whole,
    Lines { start: u32, end: u32 },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub struct ContextScope {
    pub path: String,
    pub extent: ContextExtent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextLocation {
    pub path: String,
    pub extent: ContextExtent,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextOverlapBasis {
    Anchored,
    Current,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextAnchorIdentity {
    pub ordinal: usize,
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextOverlap {
    pub scope: usize,
    pub anchor: ContextAnchorIdentity,
    pub basis: ContextOverlapBasis,
    pub location: ContextLocation,
    pub intersection: ContextExtent,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextSource {
    Worktree,
    Index,
    Head,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextUnavailableReason {
    LfsNotFetched,
    LfsNotInstalled,
    PromisorMissing,
    SparseExcluded,
    FilterFailed { filter: String, truncated: bool },
    IoError { message: String, truncated: bool },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContextStatus {
    Fresh,
    ResolvedPendingCommit,
    Moved,
    Changed,
    Deleted,
    MergeConflict,
    Submodule,
    ContentUnavailable { reason: ContextUnavailableReason },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextAnchor {
    pub ordinal: usize,
    pub id: String,
    pub anchored: ContextLocation,
    pub current: Option<ContextLocation>,
    pub status: ContextStatus,
    pub source: Option<ContextSource>,
    pub sources: Vec<ContextSource>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextSpan {
    pub name: String,
    pub why: Option<String>,
    pub overlaps: Vec<ContextOverlap>,
    pub anchors: Vec<ContextAnchor>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextMutation {
    pub requested: bool,
    pub rewritten: bool,
    pub spans_touched: usize,
    pub anchors_updated: usize,
    pub anchors_removed: usize,
    pub identities_collapsed: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContextDocument {
    pub schema_version: u32,
    pub scopes: Vec<ContextScope>,
    pub mutation: ContextMutation,
    pub spans: Vec<ContextSpan>,
}

pub fn run_context(_repo: &gix::Repository, _args: ContextArgs, _span_root: &str) -> Result<i32> {
    anyhow::bail!("context command contract is not implemented")
}
