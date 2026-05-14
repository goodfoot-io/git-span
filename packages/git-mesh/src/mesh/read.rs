//! Read-only mesh operations — §6.5, §6.6, §10.4.

use crate::git::{self, resolve_ref_oid_optional_repo};
use crate::mesh::catalog::{Catalog, CATALOG_REF};
use crate::types::Mesh;
use crate::{Error, Result};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeshCommitInfo {
    pub commit_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    /// The first line of the catalog commit message (the operation's audit
    /// trail — e.g. "mesh: follow N moved anchor").
    pub summary: String,
    /// The full catalog commit message.
    pub message: String,
    /// The mesh's own "why" message stored in the catalog entry at this
    /// revision (the user-supplied description, not the commit message).
    pub why: String,
}

pub fn list_mesh_names(repo: &gix::Repository) -> Result<Vec<String>> {
    let catalog = Catalog::load(repo)?;
    let mut names = catalog.names();
    names.sort();
    Ok(names)
}

pub fn read_mesh(repo: &gix::Repository, name: &str) -> Result<Mesh> {
    let catalog = Catalog::load(repo)?;
    catalog
        .lookup(name)?
        .ok_or_else(|| Error::MeshNotFound(name.to_string()))
}

/// Load the catalog as it appeared at a specific commit.
fn catalog_at_commit<'repo>(
    repo: &'repo gix::Repository,
    commit_oid: &str,
) -> Result<Catalog<'repo>> {
    let oid = commit_oid
        .parse::<gix::ObjectId>()
        .map_err(|e| Error::Git(format!("parse oid: {e}")))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| Error::Git(format!("find commit {commit_oid}: {e}")))?;
    let tree = commit
        .tree()
        .map_err(|e| Error::Git(format!("get commit tree {commit_oid}: {e}")))?;
    let tree_oid = tree.id().detach().to_string();
    Catalog::load_at(repo, &tree_oid)
}

pub fn read_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    match commit_ish {
        None => read_mesh(repo, name),
        Some(commit_ish) => {
            let commit_oid = repo
                .rev_parse_single(commit_ish)
                .map_err(|_| Error::Git(format!("cannot resolve commit-ish `{commit_ish}`")))?
                .detach()
                .to_string();
            let catalog = catalog_at_commit(repo, &commit_oid)?;
            catalog
                .lookup(name)?
                .ok_or_else(|| Error::MeshNotFound(name.to_string()))
        }
    }
}

pub fn show_mesh(repo: &gix::Repository, name: &str) -> Result<Mesh> {
    read_mesh(repo, name)
}

pub fn show_mesh_at(repo: &gix::Repository, name: &str, commit_ish: Option<&str>) -> Result<Mesh> {
    read_mesh_at(repo, name, commit_ish)
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
        Some(commit_ish) => {
            let commit_oid = repo
                .rev_parse_single(commit_ish)
                .map_err(|_| Error::Git(format!("cannot resolve commit-ish `{commit_ish}`")))?
                .detach()
                .to_string();
            // Verify the mesh exists in the catalog at this commit.
            let catalog = catalog_at_commit(repo, &commit_oid)?;
            let mesh = catalog
                .lookup(name)?
                .ok_or_else(|| Error::MeshNotFound(name.to_string()))?;
            let meta = git::commit_meta(repo, &commit_oid)?;
            Ok(MeshCommitInfo {
                commit_oid,
                author_name: meta.author_name,
                author_email: meta.author_email,
                author_date: meta.author_date_rfc2822,
                summary: meta.summary,
                message: meta.message,
                why: mesh.message,
            })
        }
    }
}

pub fn mesh_log(repo: &gix::Repository, name: &str, limit: Option<usize>) -> Result<Vec<MeshCommitInfo>> {
    let cat_ref_oid = resolve_ref_oid_optional_repo(repo, CATALOG_REF)?
        .ok_or_else(|| Error::Git("catalog ref not found".into()))?;
    let cat_oid: gix::ObjectId = cat_ref_oid
        .parse()
        .map_err(|e| Error::Git(format!("parse oid: {e}")))?;

    let mut entries = Vec::new();
    let max = limit.unwrap_or(usize::MAX);

    let walk = repo
        .rev_walk([cat_oid])
        .all()
        .map_err(|e| Error::Git(format!("rev walk catalog ref: {e}")))?;

    for result in walk {
        if entries.len() >= max {
            break;
        }
        let info = result.map_err(|e| Error::Git(format!("rev walk next: {e}")))?;
        let oid_str = info.id.to_string();
        if let Ok(catalog) = catalog_at_commit(repo, &oid_str)
            && let Some(mesh) = catalog.lookup(name)?
        {
                let meta = git::commit_meta(repo, &oid_str)?;
                entries.push(MeshCommitInfo {
                    commit_oid: oid_str,
                    author_name: meta.author_name,
                    author_email: meta.author_email,
                    author_date: meta.author_date_rfc2822,
                    summary: meta.summary,
                    message: meta.message,
                    why: mesh.message,
                });
            }
    }

    Ok(entries)
}
