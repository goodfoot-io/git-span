//! Integration tests for mesh root resolution.
//!
//! All tests are `#[ignore]`d during the bootstrap phase.
//! Remove `#[ignore]` when the implementation is ready.

#![cfg(test)]

use git_mesh::mesh_root::resolve_mesh_root;

use crate::support;

#[test]
fn default_is_dot_mesh() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, None, None).unwrap();
    assert_eq!(result, ".mesh");
}

#[test]
fn env_var_override() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, None, Some("meshes")).unwrap();
    assert_eq!(result, "meshes");
}

#[test]
fn cli_flag_override() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some("custom-dir"), None).unwrap();
    assert_eq!(result, "custom-dir");
}

#[test]
fn cli_overrides_env() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    // CLI takes precedence over env
    let result = resolve_mesh_root(&gix, Some("cli-dir"), Some("env-dir")).unwrap();
    assert_eq!(result, "cli-dir");
}

#[test]
fn config_override() {
    let repo = support::TestRepo::new().unwrap();
    repo.run_git(["config", "git-mesh.dir", "config-dir"])
        .unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, None, None).unwrap();
    assert_eq!(result, "config-dir");
}

#[test]
fn env_overrides_config() {
    let repo = support::TestRepo::new().unwrap();
    repo.run_git(["config", "git-mesh.dir", "config-dir"])
        .unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, None, Some("env-dir")).unwrap();
    assert_eq!(result, "env-dir");
}

#[test]
fn cli_overrides_config() {
    let repo = support::TestRepo::new().unwrap();
    repo.run_git(["config", "git-mesh.dir", "config-dir"])
        .unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some("cli-dir"), None).unwrap();
    assert_eq!(result, "cli-dir");
}

#[test]
fn reject_absolute_path() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some("/absolute/path"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("absolute"), "got: {err}");
}

#[test]
fn reject_parent_ref() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some("../escape"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".."), "got: {err}");
}

#[test]
fn reject_nested_parent_ref() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some("foo/../../bar"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".."), "got: {err}");
}

#[test]
fn reject_inside_dotgit() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some(".git/mesh"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".git"), "got: {err}");
}

#[test]
fn reject_nested_dotgit() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some("foo/.git/mesh"), None);
    assert!(result.is_err());
}

#[test]
fn reject_empty() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_mesh_root(&gix, Some(""), None);
    assert!(result.is_err());
}
