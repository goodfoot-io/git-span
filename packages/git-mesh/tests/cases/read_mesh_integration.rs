//! Library tests for mesh read paths (file-backed model, §6.5, §6.6).
//!
//! Meshes are tracked `.mesh/<name>` files; `read_mesh`/`read_mesh_at`/
//! `show_mesh`/`list_mesh_names` read the layered (worktree/index/HEAD)
//! view. The removed ref-backed commit-metadata APIs (`mesh_commit_info`,
//! `mesh_log`, `append_add`, `commit_mesh`, `set_why`) no longer exist;
//! the suites that exercised them are deleted with this rewrite.

use crate::support;

use anyhow::Result;
use git_mesh::{list_mesh_names, read_mesh, read_mesh_at, show_mesh};
use support::{TestRepo, create_and_commit_mesh};

fn seed_two_meshes(repo: &TestRepo) -> Result<()> {
    let gix = repo.gix_repo()?;
    create_and_commit_mesh(&gix, "alpha", &[("file1.txt", 1, 5)], "alpha init")?;
    create_and_commit_mesh(&gix, "beta", &[("file2.txt", 2, 6)], "beta init")?;
    Ok(())
}

#[test]
fn list_mesh_names_is_sorted() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_two_meshes(&repo)?;
    let names = list_mesh_names(&repo.gix_repo()?)?;
    assert_eq!(names, vec!["alpha".to_string(), "beta".to_string()]);
    Ok(())
}

#[test]
fn list_mesh_names_empty_repo() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(list_mesh_names(&repo.gix_repo()?)?.is_empty());
    Ok(())
}

#[test]
fn read_mesh_returns_effective_state() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_two_meshes(&repo)?;
    let m = read_mesh(&repo.gix_repo()?, "alpha")?;
    assert_eq!(m.name, "alpha");
    assert_eq!(m.anchors.len(), 1);
    assert!(m.message.contains("alpha init"));
    Ok(())
}

#[test]
fn read_mesh_missing_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let err = read_mesh(&repo.gix_repo()?, "ghost").unwrap_err();
    assert!(matches!(err, git_mesh::Error::MeshNotFound(_)));
    Ok(())
}

#[test]
fn show_mesh_is_read_mesh_alias() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_two_meshes(&repo)?;
    let gix = repo.gix_repo()?;
    assert_eq!(show_mesh(&gix, "alpha")?, read_mesh(&gix, "alpha")?);
    Ok(())
}

#[test]
fn read_mesh_at_walks_history() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    create_and_commit_mesh(&gix, "hist", &[("file1.txt", 1, 5)], "v1")?;
    let first = repo.head_sha()?;
    create_and_commit_mesh(
        &gix,
        "hist",
        &[("file1.txt", 1, 5), ("file2.txt", 3, 7)],
        "v2",
    )?;
    let old = read_mesh_at(&gix, "hist", Some(&first))?;
    assert_eq!(old.anchors.len(), 1);
    let tip = read_mesh_at(&gix, "hist", None)?;
    assert_eq!(tip.anchors.len(), 2);
    Ok(())
}

#[test]
fn read_mesh_at_missing_commitish_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    create_and_commit_mesh(&gix, "h", &[("file1.txt", 1, 5)], "v1")?;
    let head = repo.head_sha()?;
    // Mesh did not exist at the initial commit (HEAD~1).
    let err = read_mesh_at(&gix, "h", Some(&format!("{head}~1"))).unwrap_err();
    assert!(matches!(err, git_mesh::Error::MeshNotFound(_)));
    Ok(())
}

#[test]
fn read_mesh_at_none_is_effective() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    create_and_commit_mesh(&gix, "h", &[("file1.txt", 1, 5)], "v1")?;
    assert_eq!(read_mesh_at(&gix, "h", None)?, read_mesh(&gix, "h")?);
    Ok(())
}
