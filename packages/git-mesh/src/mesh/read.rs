//! Read-only mesh operations via MeshFileReader — §6.5, §6.6, §10.4.
//!
//! These functions read mesh definitions from layered mesh files (HEAD /
//! index / worktree) rather than from the ref-backed catalog.

use crate::mesh::archive::{deserialize_mesh, name_to_entry};
use crate::mesh::catalog::CATALOG_REF;
use crate::mesh_file_reader::MeshFileReader;
use crate::types::{mesh_from_file, Mesh};
use crate::{Error, Result};
use std::path::Path;
use std::str::FromStr;

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

/// Read a mesh as it existed at a specific catalog commit OID.
///
/// When `commit_ish` is `None`, reads the latest state from the worktree
/// `.mesh/` file. When `commit_ish` is `Some`, reads from the catalog tree
/// at that commit (which must be a catalog commit OID returned by
/// `commit_mesh`).
pub fn read_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    match commit_ish {
        None => read_mesh(repo, name),
        Some(commit_ish) => {
            // `commit_ish` is a catalog commit OID produced by the
            // legacy `commit_mesh` pipeline (kept intact until Phase 5).
            // Read the mesh from the catalog tree at that commit.
            let oid = gix::ObjectId::from_str(commit_ish)
                .map_err(|e| Error::Git(format!("parse OID `{commit_ish}`: {e}")))?;
            let commit = repo
                .find_commit(oid)
                .map_err(|e| Error::Git(format!("find commit `{commit_ish}`: {e}")))?;
            let tree = commit
                .tree()
                .map_err(|e| Error::Git(format!("get commit tree `{commit_ish}`: {e}")))?;
            let tree_oid_str = tree.id().detach().to_string();
            let catalog = crate::mesh::catalog::Catalog::load_at(repo, &tree_oid_str)?;
            catalog
                .lookup(name)?
                .ok_or_else(|| Error::MeshNotFound(name.to_string()))
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

// ---------------------------------------------------------------------------
// The following were for mesh-commit history and are removed in the
// file-backed model.  MeshCommitInfo, mesh_commit_info, mesh_commit_info_at,
// mesh_log are kept as stubs returning MeshNotFound so callers that still
// reference them compile but fail closed at runtime.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeshCommitInfo {
    pub commit_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub summary: String,
    pub message: String,
    pub why: String,
}

pub fn mesh_commit_info(repo: &gix::Repository, name: &str) -> Result<MeshCommitInfo> {
    let mut log = mesh_log(repo, name, Some(1))?;
    log.pop().ok_or_else(|| Error::MeshNotFound(name.to_string()))
}

pub fn mesh_commit_info_at(
    repo: &gix::Repository,
    name: &str,
    commit_ish: Option<&str>,
) -> Result<MeshCommitInfo> {
    match commit_ish {
        None => mesh_commit_info(repo, name),
        Some(c) => {
            let oid = gix::ObjectId::from_str(c)
                .map_err(|e| Error::Git(format!("parse commit OID `{c}`: {e}")))?;
            let entry_name = name_to_entry(name);
            let result = crate::git::tree_entry_at(repo, c, Path::new(&entry_name))?
                .ok_or_else(|| Error::MeshNotFound(name.to_string()))?;
            let (_mode, blob_oid) = result;

            let commit = repo
                .find_commit(oid)
                .map_err(|e| Error::Git(format!("find commit `{c}`: {e}")))?;
            let decoded = commit
                .decode()
                .map_err(|e| Error::Git(format!("decode commit `{c}`: {e}")))?;
            let author_sig = decoded
                .author()
                .map_err(|e| Error::Git(format!("author: {e}")))?;
            let author_time = author_sig
                .time()
                .map_err(|e| Error::Git(format!("author time: {e}")))?;
            let raw_msg = decoded.message.to_string();
            let summary = raw_msg.lines().next().unwrap_or("").to_string();

            let mesh_why = match crate::git::read_blob_bytes(repo, &blob_oid.to_string()) {
                Ok(bytes) => match deserialize_mesh(&bytes) {
                    Ok(m) => m.message,
                    Err(_) => String::new(),
                },
                Err(_) => String::new(),
            };

            Ok(MeshCommitInfo {
                commit_oid: c.to_string(),
                author_name: author_sig.name.to_string(),
                author_email: author_sig.email.to_string(),
                author_date: format_catalog_author_date(author_time),
                summary,
                message: raw_msg,
                why: mesh_why,
            })
        }
    }
}

pub fn mesh_log(
    repo: &gix::Repository,
    name: &str,
    limit: Option<usize>,
) -> Result<Vec<MeshCommitInfo>> {
    let result = repo
        .try_find_reference(CATALOG_REF)
        .map_err(|e| Error::Git(format!("find catalog ref `{CATALOG_REF}`: {e}")))?;

    let mut r = match result {
        Some(r) => r,
        None => return Ok(Vec::new()),
    };

    let mut oid = r.peel_to_id().map_err(|e| Error::Git(format!("peel catalog ref: {e}")))?.detach();

    let entry_name = name_to_entry(name);
    let mut entries: Vec<MeshCommitInfo> = Vec::new();

    loop {
        let commit = repo
            .find_commit(oid)
            .map_err(|e| Error::Git(format!("find catalog commit: {e}")))?;
        let decoded = commit
            .decode()
            .map_err(|e| Error::Git(format!("decode catalog commit: {e}")))?;

        // Check if mesh entry exists in this commit's tree
        let tree = commit
            .tree()
            .map_err(|e| Error::Git(format!("catalog commit tree: {e}")))?;
        let mesh_exists = tree
            .lookup_entry_by_path(Path::new(&entry_name))
            .map_err(|e| Error::Git(format!("lookup entry `{entry_name}`: {e}")))?;

        if let Some(entry) = mesh_exists {
            let author_sig = decoded
                .author()
                .map_err(|e| Error::Git(format!("author: {e}")))?;
            let author_time = author_sig
                .time()
                .map_err(|e| Error::Git(format!("author time: {e}")))?;
            let raw_msg = decoded.message.to_string();
            let summary = raw_msg.lines().next().unwrap_or("").to_string();

            // Read mesh's why text from the blob in the tree
            let blob_oid = entry.object_id();
            let mesh_why = match crate::git::read_blob_bytes(repo, &blob_oid.to_string()) {
                Ok(bytes) => match deserialize_mesh(&bytes) {
                    Ok(m) => m.message,
                    Err(_) => String::new(),
                },
                Err(_) => String::new(),
            };

            entries.push(MeshCommitInfo {
                commit_oid: oid.to_string(),
                author_name: author_sig.name.to_string(),
                author_email: author_sig.email.to_string(),
                author_date: format_catalog_author_date(author_time),
                summary,
                message: raw_msg,
                why: mesh_why,
            });

            if let Some(l) = limit {
                if entries.len() >= l {
                    break;
                }
            }
        }

        // Move to parent
        match commit.parent_ids().next() {
            Some(parent) => oid = parent.detach(),
            None => break,
        }
    }

    Ok(entries)
}

/// Format a `gix::date::Time` for `MeshCommitInfo::author_date`.
fn format_catalog_author_date(t: gix::date::Time) -> String {
    use chrono::{DateTime, FixedOffset, Utc};
    // Build a FixedOffset from the timezone offset in minutes.
    let secs = t.seconds;
    let offset_secs = t.offset.min(18_000); // cap at ±5h for safety
    if let Some(dt) = DateTime::from_timestamp(secs, 0) {
        if let Some(fixed) = FixedOffset::east_opt(offset_secs * 60) {
            let local: DateTime<FixedOffset> = dt.with_timezone(&fixed);
            return local.to_rfc2822();
        }
        return dt.to_rfc2822();
    }
    Utc::now().to_rfc2822()
}
