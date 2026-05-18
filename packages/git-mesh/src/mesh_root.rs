//! Mesh root resolution with config/env/CLI/default precedence.
//!
//! Precedence (highest first):
//! 1. `--mesh-dir <path>` CLI flag
//! 2. `GIT_MESH_DIR` environment variable
//! 3. `git config git-mesh.dir`
//! 4. Default: `.mesh`

use crate::{Error, Result};

/// Resolve the mesh root directory path for `repo`.
///
/// Precedence:
/// 1. `cli_dir` — `--mesh-dir <path>` CLI flag
/// 2. `env_dir` — `GIT_MESH_DIR` environment variable
/// 3. `git config git-mesh.dir`
/// 4. Default: `".mesh"`
///
/// The returned value is a repo-relative directory path.
///
/// # Errors
///
/// Returns `Error::InvalidMeshFile` if the resolved value is an absolute
/// path, contains `..`, or points inside `.git`.
pub fn resolve_mesh_root(
    repo: &gix::Repository,
    cli_dir: Option<&str>,
    env_dir: Option<&str>,
) -> Result<String> {
    // Check git config git-mesh.dir (store to extend lifetime).
    let config_dir = crate::git::config_string(repo, "git-mesh.dir");

    let candidate = cli_dir
        .or(env_dir)
        .or(config_dir.as_deref())
        .unwrap_or(".mesh")
        .to_string();

    validate_mesh_root(&candidate)?;
    Ok(candidate)
}

/// Validate that `dir` is a legal repo-relative path for use as a mesh root.
///
/// Rejects:
/// - Absolute paths (starting with `/`)
/// - Paths containing `..`
/// - Paths inside `.git` (starting with `.git`, containing `/.git/`,
///   or ending with `/.git`)
fn validate_mesh_root(dir: &str) -> Result<()> {
    if dir.is_empty() {
        return Err(Error::InvalidMeshFile(
            "mesh root must not be empty".into(),
        ));
    }

    // Reject absolute paths (Unix-style).
    if dir.starts_with('/') {
        return Err(Error::InvalidMeshFile(format!(
            "mesh root must be repo-relative, got absolute path: `{dir}`"
        )));
    }

    // Reject paths containing `..`.
    // We split on '/' and check each component to avoid false positives
    // like `foo..bar`.
    for component in dir.split('/') {
        if component == ".." {
            return Err(Error::InvalidMeshFile(format!(
                "mesh root must not contain `..`: `{dir}`"
            )));
        }
    }

    // Reject paths inside `.git`.
    let normalized = dir.trim_end_matches('/');
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err(Error::InvalidMeshFile(format!(
            "mesh root must not be inside `.git`: `{dir}`"
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_dot_mesh() {
        assert!(validate_mesh_root(".mesh").is_ok());
    }

    #[test]
    fn validate_accepts_nested() {
        assert!(validate_mesh_root("some/dir/mesh").is_ok());
    }

    #[test]
    fn validate_rejects_absolute() {
        let err = validate_mesh_root("/tmp/mesh").unwrap_err();
        assert!(err.to_string().contains("absolute"));
    }

    #[test]
    fn validate_rejects_parent_ref() {
        let err = validate_mesh_root("../mesh").unwrap_err();
        assert!(err.to_string().contains(".."));
    }

    #[test]
    fn validate_rejects_nested_parent_ref() {
        let err = validate_mesh_root("foo/../../bar").unwrap_err();
        assert!(err.to_string().contains(".."));
    }

    #[test]
    fn validate_rejects_dotgit_prefix() {
        let err = validate_mesh_root(".git/mesh").unwrap_err();
        assert!(err.to_string().contains(".git"));
    }

    #[test]
    fn validate_rejects_nested_dotgit() {
        let err = validate_mesh_root("foo/.git/mesh").unwrap_err();
        assert!(err.to_string().contains(".git"));
    }

    #[test]
    fn validate_rejects_dotgit_suffix() {
        let err = validate_mesh_root("some/.git").unwrap_err();
        assert!(err.to_string().contains(".git"));
    }

    #[test]
    fn validate_rejects_empty() {
        let err = validate_mesh_root("").unwrap_err();
        assert!(err.to_string().contains("empty"));
    }
}
