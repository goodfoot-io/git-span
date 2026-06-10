//! Layer readers: index/worktree diff parsing, hunk application,
//! `ContentRef` normalization dispatch, merge-conflict detection, gix
//! worktree-filter reader, LFS subprocess, and custom filter-process
//! orchestration.

pub(crate) mod diff;
pub(crate) mod filter_process;
pub(crate) mod lfs;
pub(crate) mod worktree;

pub(crate) use diff::{
    LayerDiffs, read_conflicted_paths, read_index_layer, read_index_trailer, read_layer_status,
    read_worktree_layer, read_worktree_layer_for_paths,
};
pub(crate) use filter_process::{CustomFilters, is_custom_filter_configured};
pub(crate) use lfs::{LfsState, resolve_lfs_anchor};
pub(crate) use worktree::read_worktree_normalized;
