//! Read-only mesh operations via MeshFileReader — §6.5, §6.6, §10.4.
//!
//! These functions read mesh definitions from layered mesh files (HEAD /
//! index / worktree) rather than from the ref-backed catalog.

use crate::mesh_file::MeshFile;
use crate::mesh_file_reader::MeshFileReader;
use crate::types::{mesh_from_file, Mesh};
use crate::{Error, Result};
use std::path::Path;

pub fn list_mesh_names(repo: &gix::Repository) -> Result<Vec<String>> {
    list_mesh_names_in(repo, ".mesh")
}

pub fn list_mesh_names_in(repo: &gix::Repository, mesh_root: &str) -> Result<Vec<String>> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let mut names = reader.list_mesh_names()?;
    names.sort();
    Ok(names)
}

/// Read the current effective mesh from layered mesh files (worktree + index + HEAD).
pub fn read_mesh(repo: &gix::Repository, name: &str) -> Result<Mesh> {
    read_mesh_in(repo, name, ".mesh")
}

/// Read a mesh from a specific mesh root.
///
/// File-backed model: the mesh is read from the layered mesh-file view
/// (worktree overlays index overlays HEAD). There is no catalog fallback.
pub fn read_mesh_in(repo: &gix::Repository, name: &str, mesh_root: &str) -> Result<Mesh> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let file = reader
        .read_effective(name)?
        .ok_or_else(|| Error::MeshNotFound(name.to_string()))?;
    Ok(mesh_from_file(name, &file))
}

/// Load every visible mesh as `(name, Mesh)` pairs via the layered
/// mesh-file reader. Names absent from the effective view (tombstoned)
/// are skipped. This is the file-backed replacement for
/// `Catalog::load(repo)?.iter()`.
pub fn load_all_meshes(repo: &gix::Repository) -> Result<Vec<(String, Mesh)>> {
    load_all_meshes_in(repo, ".mesh")
}

/// Load every visible mesh under a specific mesh root.
pub fn load_all_meshes_in(
    repo: &gix::Repository,
    mesh_root: &str,
) -> Result<Vec<(String, Mesh)>> {
    let reader = MeshFileReader::new(repo, mesh_root.to_string());
    let mut names = reader.list_mesh_names()?;
    names.sort();
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        // A name can appear in `list_mesh_names` (e.g. present in HEAD)
        // yet be tombstoned in the effective view; skip those rather
        // than erroring so the batch resolves the live set.
        if let Some(file) = reader.read_effective(&name)? {
            out.push((name.clone(), mesh_from_file(&name, &file)));
        }
    }
    Ok(out)
}

/// File-backed replacement for the ref-backed path index: return the
/// names of all visible meshes that have at least one anchor matching
/// `path` (exact path equality) and the optional 1-based inclusive line
/// `range`. A whole-file anchor matches any range query on its path; a
/// line anchor matches when the ranges overlap. Names are sorted.
pub fn meshes_matching_path(
    repo: &gix::Repository,
    path: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<String>> {
    use crate::types::AnchorExtent;
    let mut names: Vec<String> = Vec::new();
    for (name, mesh) in load_all_meshes(repo)? {
        let hit = mesh.anchors.iter().any(|(_, a)| {
            if a.path != path {
                return false;
            }
            match (a.extent, range) {
                (_, None) => true,
                (AnchorExtent::WholeFile, Some(_)) => true,
                (
                    AnchorExtent::LineRange { start, end },
                    Some((qs, qe)),
                ) => start <= qe && end >= qs,
            }
        });
        if hit {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

/// File-backed alias kept for callers that used the ref-backed path index.
pub fn matching_mesh_names(
    repo: &gix::Repository,
    path: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<String>> {
    meshes_matching_path(repo, path, range)
}

pub fn is_glob_pattern(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[') || s.contains('{')
}

/// File-backed glob match over visible meshes' anchor paths.
pub fn matching_mesh_names_glob(
    repo: &gix::Repository,
    pattern: &str,
    range: Option<(u32, u32)>,
) -> Result<Vec<String>> {
    use crate::types::AnchorExtent;
    let glob = globset::GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|e| Error::Parse(format!("invalid glob `{pattern}`: {e}")))?
        .compile_matcher();
    let mut matched: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for (name, mesh) in load_all_meshes(repo)? {
        for (_id, a) in &mesh.anchors {
            if !glob.is_match(&a.path) {
                continue;
            }
            let in_range = match (a.extent, range) {
                (_, None) => true,
                (AnchorExtent::WholeFile, Some(_)) => true,
                (AnchorExtent::LineRange { start, end }, Some((rs, re))) => {
                    start <= re && end >= rs
                }
            };
            if in_range {
                matched.insert(name.clone());
                break;
            }
        }
    }
    Ok(matched.into_iter().collect())
}

/// Read a mesh as it existed at a specific commit.
///
/// When `commit_ish` is `None`, reads the latest effective state
/// (worktree overlays index overlays HEAD). When `commit_ish` is
/// `Some`, reads the mesh file from the git tree at that commit.
pub fn read_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    read_mesh_at_in(repo, name, commit_ish, ".mesh")
}

pub fn read_mesh_at_in(
    repo: &gix::Repository,
    name: &str,
    commit_ish: Option<&str>,
    mesh_root: &str,
) -> Result<Mesh> {
    match commit_ish {
        None => read_mesh_in(repo, name, mesh_root),
        Some(commit_ish) => {
            let mesh_path = format!("{mesh_root}/{name}");
            let (_mode, oid) = crate::git::tree_entry_at(repo, commit_ish, Path::new(&mesh_path))?
                .ok_or_else(|| Error::MeshNotFound(name.to_string()))?;
            let text = crate::git::read_git_text(repo, &oid.to_string())?;
            let file = MeshFile::parse(&text)?;
            Ok(mesh_from_file(name, &file))
        }
    }
}

/// Show alias for read_mesh.
pub fn show_mesh(repo: &gix::Repository, name: &str) -> Result<Mesh> {
    read_mesh(repo, name)
}

/// Show alias for read_mesh_at.
pub fn show_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    read_mesh_at(repo, name, commit_ish)
}
