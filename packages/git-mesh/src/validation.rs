//! Name validation (§3.5, §10.2 reserved list).
//!
//! The validation logic lives in the gix-free `git-mesh-core` kernel; this
//! module is the thin git-mesh boundary that preserves the original public
//! paths and the crate-local `Result` signatures. Each wrapper delegates to
//! the kernel and lifts its error into this crate's `Error` via `From`.

use crate::Result;

/// Subcommands and reserved tokens that cannot be used as mesh names.
pub use git_mesh_core::RESERVED_MESH_NAMES;

/// Mesh-name shape rule text (kebab-case segments separated by `/`).
pub use git_mesh_core::MESH_NAME_RULE;

/// Validate a mesh name against §3.5, §10.2, and the §12.12 T7 naming rule.
pub fn validate_mesh_name(name: &str) -> Result<()> {
    Ok(git_mesh_core::validate_mesh_name(name)?)
}

/// Validate a anchor id (UUID, ref-legal).
pub fn validate_anchor_id(id: &str) -> Result<()> {
    Ok(git_mesh_core::validate_anchor_id(id)?)
}

pub(crate) fn validate_mesh_name_shape(value: &str) -> Result<()> {
    Ok(git_mesh_core::validate_mesh_name_shape(value)?)
}
