//! git-mesh v2 library crate.
//!
//! Public API lives at the crate root via the curated re-exports below.
//! Modules are organized by concern:
//!
//! * [`types`]       — data shapes (spec §4).
//! * [`git`]         — git plumbing helpers.
//! * [`anchor`]       — Anchor blob create/read/parse/serialize (§4.1, §6.1).
//! * [`mesh`]        — mesh read/commit/structural (§6).
//! * [`staging`]     — `.git/mesh/staging/` area (§6.3, §6.4).
//! * [`file_index`]  — `.git/mesh/file-index` lookup table (§3.4).
//! * [`resolver`]    — layered staleness resolver (§5).
//! * [`sync`]        — fetch/push + lazy refspec (§7).
//! * [`validation`]  — name validation (§3.5, §10.2).
//! * [`cli`]         — clap surface; consumed by the binary.

pub mod advice;
pub mod anchor;
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

pub use anchor::{anchor_ref_path, create_anchor, parse_anchor, read_anchor, serialize_anchor};
pub use git::read_git_text;
pub use mesh::{
    delete_mesh, list_mesh_names, read_mesh, read_mesh_at, rename_mesh, show_mesh, show_mesh_at,
};
pub use resolver::{resolve_anchor, resolve_mesh, stale_meshes};
pub use types::*;
pub use validation::{RESERVED_MESH_NAMES, validate_anchor_id, validate_mesh_name};
