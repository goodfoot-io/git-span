//! Structural mesh operations — file-backed (§6.8).
//!
//! `delete` and `rename` operate by removing or moving the mesh file in
//! the worktree mesh root. There is no catalog, no staging, and no ref
//! transaction — the change is an ordinary worktree edit committed with
//! `git`.

use crate::mesh_file_reader::MeshFileReader;
use crate::validation::validate_mesh_name;
use crate::{Error, Result};
use std::path::PathBuf;

const DEFAULT_MESH_ROOT: &str = ".mesh";

fn mesh_file_path(repo: &gix::Repository, mesh_root: &str, name: &str) -> Result<PathBuf> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::Git("bare repository is not supported".into()))?;
    Ok(workdir.join(mesh_root).join(name))
}

/// Delete a mesh by removing its worktree file under the mesh root.
pub fn delete_mesh(repo: &gix::Repository, name: &str) -> Result<()> {
    delete_mesh_in(repo, name, DEFAULT_MESH_ROOT)
}

pub fn delete_mesh_in(repo: &gix::Repository, name: &str, mesh_root: &str) -> Result<()> {
    validate_mesh_name(name)?;
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    if reader.read_effective(name)?.is_none() {
        return Err(Error::MeshNotFound(name.into()));
    }
    let path = mesh_file_path(repo, mesh_root, name)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| Error::Git(format!("remove mesh file `{}`: {e}", path.display())))?;
    }
    Ok(())
}

/// Rename a mesh by moving its worktree file under the mesh root.
pub fn rename_mesh(repo: &gix::Repository, old: &str, new: &str) -> Result<()> {
    rename_mesh_in(repo, old, new, DEFAULT_MESH_ROOT)
}

pub fn rename_mesh_in(repo: &gix::Repository, old: &str, new: &str, mesh_root: &str) -> Result<()> {
    validate_mesh_name(new)?;
    validate_mesh_name(old)?;

    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let Some(file) = reader.read_effective(old)? else {
        return Err(Error::MeshNotFound(old.into()));
    };
    if reader.read_effective(new)?.is_some() {
        return Err(Error::MeshAlreadyExists(new.into()));
    }

    let old_path = mesh_file_path(repo, mesh_root, old)?;
    let new_path = mesh_file_path(repo, mesh_root, new)?;

    // File→directory transition: when `new` has `old` as a strict path
    // prefix (`old` followed by `/`), the old regular file lies on the
    // new path's ancestor chain and obstructs `create_dir_all`.  Remove
    // it first; the effective content is already captured in `file`.
    let new_under_old = new
        .strip_prefix(old)
        .is_some_and(|rest| rest.starts_with('/'));
    if new_under_old && old_path.exists() {
        std::fs::remove_file(&old_path)
            .map_err(|e| Error::Git(format!("remove `{}`: {e}", old_path.display())))?;
    }

    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| Error::Git(format!("create `{}`: {e}", parent.display())))?;
    }
    // Write the new file from the effective content (covers the case
    // where the old version lived only in HEAD/index, not on disk).
    std::fs::write(&new_path, file.serialize())
        .map_err(|e| Error::Git(format!("write `{}`: {e}", new_path.display())))?;
    if !new_under_old && old_path.exists() {
        std::fs::remove_file(&old_path)
            .map_err(|e| Error::Git(format!("remove `{}`: {e}", old_path.display())))?;
    }
    Ok(())
}
