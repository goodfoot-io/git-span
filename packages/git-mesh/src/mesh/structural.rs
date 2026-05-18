//! Structural mesh operations — §6.8.

use crate::git::{self, resolve_ref_oid_optional_repo};
use crate::mesh::catalog::{Catalog, CATALOG_REF};
use crate::staging;
use crate::validation::validate_mesh_name;
use crate::{Error, Result};

pub fn delete_mesh(repo: &gix::Repository, name: &str) -> Result<()> {
    // Verify mesh exists in catalog.
    let catalog = Catalog::load(repo)?;
    catalog.lookup(name)?
        .ok_or_else(|| Error::MeshNotFound(name.into()))?;

    // Check staging before deletion — refuse if any staged work exists.
    let staging = staging::read_staging(repo, name)?;
    let staging_count = staging.adds.len()
        + staging.removes.len()
        + staging.configs.len()
        + staging.why.as_ref().map_or(0, |_| 1);
    if staging_count > 0 {
        return Err(Error::StagingResidueOnDelete {
            name: name.into(),
            count: staging_count,
        });
    }

    let mesh = super::read::read_mesh(repo, name)?;

    // Retry loop: remove mesh from catalog with CAS.
    const MAX_RETRIES: u32 = 3;
    let mut attempt = 0u32;
    loop {
        let catalog_ref_oid = resolve_ref_oid_optional_repo(repo, CATALOG_REF)?;
        let mut catalog = Catalog::load(repo)?;
        catalog.remove(name)?;
        match crate::mesh::catalog::commit_catalog(
            repo,
            &catalog,
            &format!("mesh: delete {name}"),
            catalog_ref_oid.as_deref(),
        ) {
            Ok(_) => break,
            Err(_) if attempt < MAX_RETRIES => {
                attempt += 1;
                continue;
            }
            Err(e) => return Err(e),
        }
    }

    // Update path index refs (independent of catalog).
    let updates = super::path_index::ref_updates_for_mesh(repo, name, &mesh.anchors, &[])?;
    if !updates.is_empty() {
        crate::git::ensure_log_all_ref_updates_always(repo)?;
        crate::git::apply_ref_transaction_repo(repo, &updates)
    } else {
        Ok(())
    }
}

pub fn rename_mesh(repo: &gix::Repository, old: &str, new: &str) -> Result<()> {
    validate_mesh_name(new)?;

    // Verify source exists and destination doesn't.
    let catalog = Catalog::load(repo)?;
    catalog.lookup(old)?
        .ok_or_else(|| Error::MeshNotFound(old.into()))?;
    if catalog.lookup(new)?.is_some() {
        return Err(Error::MeshAlreadyExists(new.into()));
    }

    let mut mesh = super::read::read_mesh(repo, old)?;
    mesh.name = new.to_string();

    // Retry loop: remove old, insert new, and CAS commit.
    const MAX_RETRIES: u32 = 3;
    let mut attempt = 0u32;
    loop {
        let catalog_ref_oid = resolve_ref_oid_optional_repo(repo, CATALOG_REF)?;
        let mut catalog = Catalog::load(repo)?;
        catalog.remove(old)?;
        catalog.insert(new, &mesh)?;
        match crate::mesh::catalog::commit_catalog(
            repo,
            &catalog,
            &format!("mesh: rename {old} -> {new}"),
            catalog_ref_oid.as_deref(),
        ) {
            Ok(_) => break,
            Err(_) if attempt < MAX_RETRIES => {
                attempt += 1;
                continue;
            }
            Err(e) => return Err(e),
        }
    }

    // Update path index refs (independent of catalog).
    let updates = super::path_index::ref_updates_for_rename(repo, old, new, &mesh.anchors)?;
    if !updates.is_empty() {
        crate::git::ensure_log_all_ref_updates_always(repo)?;
        crate::git::apply_ref_transaction_repo(repo, &updates)
    } else {
        Ok(())
    }
}

pub fn restore_mesh(repo: &gix::Repository, name: &str) -> Result<()> {
    // Clear staging only; do not touch the catalog ref.
    crate::staging::clear_staging(repo, name)
}

pub fn revert_mesh(repo: &gix::Repository, name: &str, commit_ish: &str) -> Result<String> {
    let target = repo
        .rev_parse_single(commit_ish)
        .map_err(|_| Error::Git(format!("cannot resolve commit-ish `{commit_ish}`")))?
        .detach()
        .to_string();
    let message = git::commit_meta(repo, &target)?.message;

    // Load the mesh as it existed at the target catalog commit.
    let new_mesh = super::read::read_mesh_at(repo, name, Some(&target))
        .or_else(|_| super::read::read_mesh(repo, name))?;

    // Retry loop: insert reverted mesh version and CAS commit.
    const MAX_RETRIES: u32 = 3;
    let mut attempt = 0u32;
    loop {
        let catalog_ref_oid = resolve_ref_oid_optional_repo(repo, CATALOG_REF)?;
        let mut catalog = Catalog::load(repo)?;
        catalog.insert(name, &new_mesh)?;
        match crate::mesh::catalog::commit_catalog(
            repo,
            &catalog,
            &message,
            catalog_ref_oid.as_deref(),
        ) {
            Ok(new_oid) => return Ok(new_oid),
            Err(_) if attempt < MAX_RETRIES => {
                attempt += 1;
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}
