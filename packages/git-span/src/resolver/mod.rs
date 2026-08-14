//! Resolver: compute drift for anchors and spans (§5).
//!
//! Layered HEAD/Index/Worktree resolution atop the HEAD-resolved
//! location. The file-backed model has no staging area: `add`/`remove`/`why`
//! edit worktree span files directly.
//!
//! Module map:
//!
//! - `walker` — anchor..HEAD history walk, hunk math.
//! - `layers` — index/worktree diff parsing, normalized reads,
//!   LFS + custom filter-process orchestration.
//! - `engine` — top-level `resolve_anchor` / `resolve_span` /
//!   `drift_spans`, the concurrency SHA-trailer guard.
//! - [`attribution`] — `drift_locus` HEAD-source forward walk.

#![allow(dead_code)]

pub mod attribution;
pub(crate) mod bloom;
pub(crate) mod core;
pub(crate) mod dirty;
pub(crate) mod engine;
pub(crate) mod exact;
pub(crate) mod incremental;
pub(crate) mod layers;
pub(crate) mod linemap;
pub(crate) mod session;
pub(crate) mod store;
pub(crate) mod timeline;
pub(crate) mod walker;

pub(crate) use engine::{
    SourceLayers, anchor_status_is_drift, build_source_layers, resolve_loaded_spans,
    resolve_named_spans, resolve_named_spans_retaining_source_layers,
    resolve_named_spans_with_source_layers, sort_spans_by_anchor_path, span_has_actionable_drift,
    span_is_reportable_in_drift_discovery, drift_spans_retaining_source_layers,
};
pub use engine::{
    resolve_anchor, resolve_span, resolve_span_at, drift_spans, drift_spans_with_trace,
};
pub(crate) use store::WholeResult;
