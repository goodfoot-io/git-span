//! Mesh read/write operations. See §6.
//!
//! Split by concern:
//! - [`commit`] — staging resolution + mesh commit pipeline (§6.1, §6.2).
//! - [`read`]   — read-only views (§6.5, §6.6, §10.4).
//! - [`structural`] — delete, mv, restore, revert (§6.8).

pub mod read;
pub mod structural;

pub use read::{list_mesh_names, read_mesh, read_mesh_at, show_mesh, show_mesh_at};
pub use structural::{delete_mesh, rename_mesh};
