//! Mesh file format: parse/serialize the text-based mesh file storage.
//!
//! The format and its pure text↔struct transform live in the gix-free
//! `git-mesh-core` kernel (it is the on-disk contract `.mesh`/`.wiki`
//! consumers share). This module re-exports the kernel's items on their
//! original `crate::mesh_file::*` paths so git-mesh's callers are unchanged.
//! `MeshFile::parse` returns the kernel's `Result`; call sites lift it into
//! this crate's `Error` via the `?` operator / `From`.

pub use git_mesh_core::mesh_file::{AnchorRecord, MeshFile, parse_address};
