//! Resolver: compute staleness for anchors and meshes (§5).
//!
//! Layered HEAD/Index/Worktree resolution atop the HEAD-resolved
//! location; the staged-mesh layer surfaces `PendingFinding`s and
//! matches `acknowledged_by` by `anchor_id` (re-normalized on the sidecar
//! freshness stamp).
//!
//! Module map:
//!
//! - `walker` — anchor..HEAD history walk, hunk math.
//! - `layers` — index/worktree diff parsing, normalized reads,
//!   LFS + custom filter-process orchestration.
//! - `engine` — top-level `resolve_anchor` / `resolve_mesh` /
//!   `stale_meshes`, acknowledgment matching, the concurrency
//!   SHA-trailer guard.
//! - [`attribution`] — `drift_locus` HEAD-source forward walk.

#![allow(dead_code)]

pub mod attribution;
pub(crate) mod bloom;
pub(crate) mod cache;
pub(crate) mod cache_v2;
pub(crate) mod engine;
pub(crate) mod layers;
pub(crate) mod linemap;
pub(crate) mod session;
pub(crate) mod timeline;
pub(crate) mod walker;

pub use engine::pending::build_pending_findings;
pub use engine::{
    resolve_anchor, resolve_mesh, resolve_mesh_at, stale_meshes, stale_meshes_with_trace,
};
pub(crate) use cache_v2::WholeResult;
pub(crate) use engine::{
    SourceLayers, mesh_is_reportable_in_stale_discovery, resolve_named_meshes,
    resolve_named_meshes_retaining_source_layers, resolve_named_meshes_with_source_layers,
    sort_meshes_by_anchor_path, stale_meshes_retaining_source_layers,
};
