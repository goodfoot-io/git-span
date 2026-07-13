//! Integration tests for span root resolution.
//!
//! All tests are `#[ignore]`d during the bootstrap phase.
//! Remove `#[ignore]` when the implementation is ready.

#![cfg(test)]

use git_span::span_root::resolve_span_root;

use crate::support;

#[test]
fn default_is_dot_span() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, None, None).unwrap();
    assert_eq!(result, ".span");
}

#[test]
fn env_var_override() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, None, Some("spans")).unwrap();
    assert_eq!(result, "spans");
}

#[test]
fn cli_flag_override() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some("custom-dir"), None).unwrap();
    assert_eq!(result, "custom-dir");
}

#[test]
fn cli_overrides_env() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    // CLI takes precedence over env
    let result = resolve_span_root(&gix, Some("cli-dir"), Some("env-dir")).unwrap();
    assert_eq!(result, "cli-dir");
}

#[test]
fn config_override() {
    let repo = support::TestRepo::new().unwrap();
    repo.run_git(["config", "git-span.dir", "config-dir"])
        .unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, None, None).unwrap();
    assert_eq!(result, "config-dir");
}

#[test]
fn env_overrides_config() {
    let repo = support::TestRepo::new().unwrap();
    repo.run_git(["config", "git-span.dir", "config-dir"])
        .unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, None, Some("env-dir")).unwrap();
    assert_eq!(result, "env-dir");
}

#[test]
fn cli_overrides_config() {
    let repo = support::TestRepo::new().unwrap();
    repo.run_git(["config", "git-span.dir", "config-dir"])
        .unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some("cli-dir"), None).unwrap();
    assert_eq!(result, "cli-dir");
}

#[test]
fn reject_absolute_path() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some("/absolute/path"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("absolute"), "got: {err}");
}

#[test]
fn reject_parent_ref() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some("../escape"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".."), "got: {err}");
}

#[test]
fn reject_nested_parent_ref() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some("foo/../../bar"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".."), "got: {err}");
}

#[test]
fn reject_inside_dotgit() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some(".git/span"), None);
    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains(".git"), "got: {err}");
}

#[test]
fn reject_nested_dotgit() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some("foo/.git/span"), None);
    assert!(result.is_err());
}

#[test]
fn reject_empty() {
    let repo = support::TestRepo::new().unwrap();
    let gix = repo.gix_repo().unwrap();
    let result = resolve_span_root(&gix, Some(""), None);
    assert!(result.is_err());
}
