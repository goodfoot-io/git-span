//! git-span v2 library crate.
//!
//! Public API lives at the crate root via the curated re-exports below.
//! Modules are organized by concern:
//!
//! * [`types`]       — data shapes (spec §4).
//! * [`git`]         — git plumbing helpers.
//! * [`span`]        — span read/commit/structural (§6).
//! * [`span_file`]   — file-backed span document parse/serialize.
//! * [`resolver`]    — layered staleness resolver (§5).
//! * [`validation`]  — name validation (§3.5, §10.2).
//! * [`cli`]         — clap surface; consumed by the binary.

#[cfg(feature = "bench-corpus")]
pub mod bench_corpus;

pub mod cli;
pub mod git;
pub mod span;
pub mod span_file;
pub mod span_file_reader;
pub mod span_root;
pub mod perf;
pub mod resolver;
pub mod types;
pub mod validation;

pub use git::read_git_text;
pub use git::{index_entries_call_count, reset_index_entries_call_count};
pub use span::{
    delete_span, list_span_names, read_span, read_span_at, rename_span, show_span, show_span_at,
};
pub use resolver::{resolve_anchor, resolve_span, stale_spans};
pub use types::*;
// The gix-free kernel's matcher contract. `AnchorExtent` already reaches the
// crate root via `types::*`; `Location` is the remaining pure-kernel item
// consumers share.
pub use git_span_core::Location;
pub use validation::{RESERVED_SPAN_NAMES, validate_anchor_id, validate_span_name};
