//! Structural mesh operations — file-backed (§6.8).
//!
//! `delete` and `rename` operate by removing or moving the mesh file in
//! the worktree mesh root. There is no catalog, no staging, and no ref
//! transaction — the change is an ordinary worktree edit committed with
//! `git`.

use crate::mesh_file_reader::MeshFileReader;
use crate::validation::validate_mesh_name;
use crate::{Error, Result};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::ensure_mesh_dir;

    /// `ensure_mesh_dir` must create `.mesh/.gitattributes` with exact
    /// canonical content and must be idempotent.
    #[test]
    fn ensure_mesh_dir_writes_canonical_gitattributes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workdir = dir.path();
        let mesh_root = ".mesh";

        // First call: directory and file must be created.
        ensure_mesh_dir(workdir, mesh_root).expect("first call");

        let ga_path = workdir.join(mesh_root).join(".gitattributes");
        assert!(ga_path.exists(), ".mesh/.gitattributes must exist after first call");

        let content = std::fs::read_to_string(&ga_path).expect("read .gitattributes");
        assert_eq!(
            content, "* text eol=lf\n",
            ".mesh/.gitattributes content must be exactly `* text eol=lf\\n`"
        );

        // Second call: idempotent — no error, content unchanged.
        ensure_mesh_dir(workdir, mesh_root).expect("second call (idempotency)");

        let content2 = std::fs::read_to_string(&ga_path).expect("read .gitattributes again");
        assert_eq!(
            content2, "* text eol=lf\n",
            "content must be unchanged after idempotent second call"
        );
    }
}

const DEFAULT_MESH_ROOT: &str = ".mesh";

/// Ensure the mesh root directory exists and contains a `.gitattributes`
/// that pins LF for all mesh files. Idempotent: writes `.gitattributes`
/// only when missing or when content differs from the canonical form.
pub(crate) fn ensure_mesh_dir(workdir: &Path, mesh_root: &str) -> Result<()> {
    let mesh_dir = workdir.join(mesh_root);
    std::fs::create_dir_all(&mesh_dir)?;
    let ga_path = mesh_dir.join(".gitattributes");
    let canonical = "* text eol=lf\n";
    let current = std::fs::read_to_string(&ga_path).unwrap_or_default();
    if current != canonical {
        std::fs::write(&ga_path, canonical)?;
    }
    Ok(())
}

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
        let workdir = repo
            .workdir()
            .ok_or_else(|| Error::Git("bare repository is not supported".into()))?;
        ensure_mesh_dir(workdir, mesh_root)?;
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
