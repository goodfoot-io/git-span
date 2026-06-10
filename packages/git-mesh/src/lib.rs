//! git-mesh v2 library crate.
//!
//! Public API lives at the crate root via the curated re-exports below.
//! Modules are organized by concern:
//!
//! * [`types`]       — data shapes (spec §4).
//! * [`git`]         — git plumbing helpers.
//! * [`mesh`]        — mesh read/commit/structural (§6).
//! * [`mesh_file`]   — file-backed mesh document parse/serialize.
//! * [`resolver`]    — layered staleness resolver (§5).
//! * [`validation`]  — name validation (§3.5, §10.2).
//! * [`cli`]         — clap surface; consumed by the binary.

pub mod cli;
pub mod git;
pub mod mesh;
pub mod mesh_file;
pub mod mesh_file_reader;
pub mod mesh_root;
pub mod perf;
pub mod resolver;
pub mod types;
pub mod validation;

pub use git::read_git_text;
pub use git::{index_entries_call_count, reset_index_entries_call_count};
pub use mesh::{
    delete_mesh, list_mesh_names, read_mesh, read_mesh_at, rename_mesh, show_mesh, show_mesh_at,
};
pub use resolver::{resolve_anchor, resolve_mesh, stale_meshes};
pub use types::*;
// The gix-free kernel's matcher contract. `AnchorExtent` and `sha256_hex`
// already reach the crate root via `types::*`; these are the remaining
// pure-kernel items consumers share.
pub use git_mesh_core::{Location, hash_bytes_with_extent, scan_for_content_hash};
pub use validation::{RESERVED_MESH_NAMES, validate_anchor_id, validate_mesh_name};
