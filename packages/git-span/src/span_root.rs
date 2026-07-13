//! Span root resolution with config/env/CLI/default precedence.
//!
//! Precedence (highest first):
//! 1. `--span-dir <path>` CLI flag
//! 2. `GIT_SPAN_DIR` environment variable
//! 3. `git config git-span.dir`
//! 4. Default: `.span`

use crate::{Error, Result};

/// Resolve the span root directory path for `repo`.
///
/// Precedence:
/// 1. `cli_dir` — `--span-dir <path>` CLI flag
/// 2. `env_dir` — `GIT_SPAN_DIR` environment variable
/// 3. `git config git-span.dir`
/// 4. Default: `".span"`
///
/// The returned value is a repo-relative directory path.
///
/// # Errors
///
/// Returns `Error::InvalidSpanFile` if the resolved value is an absolute
/// path, contains `..`, or points inside `.git`.
pub fn resolve_span_root(
    repo: &gix::Repository,
    cli_dir: Option<&str>,
    env_dir: Option<&str>,
) -> Result<String> {
    // Check git config git-span.dir (store to extend lifetime).
    let config_dir = crate::git::config_string(repo, "git-span.dir");

    let candidate = cli_dir
        .or(env_dir)
        .or(config_dir.as_deref())
        .unwrap_or(".span")
        .to_string();

    validate_span_root(&candidate)?;
    Ok(candidate)
}

/// Validate that `dir` is a legal repo-relative path for use as a span root.
///
/// Rejects:
/// - Absolute paths (starting with `/`)
/// - Paths containing `..`
/// - Paths inside `.git` (starting with `.git`, containing `/.git/`,
///   or ending with `/.git`)
fn validate_span_root(dir: &str) -> Result<()> {
    validate_repo_relative_path("span root", dir)
}

/// Validate that `path` is a safe repo-relative path.
///
/// `kind` names the subject for error messages (e.g. `"span root"`,
/// `"anchor path"`). This is the single path-safety validator shared by
/// span-root resolution and `git span add` anchor-address validation —
/// there is no parallel implementation.
///
/// Rejects:
/// - Empty paths
/// - Absolute paths (starting with `/`)
/// - Paths containing a `..` component
/// - Paths inside `.git` (equal to `.git`, starting with `.git/`,
///   containing `/.git/`, or ending with `/.git`)
pub fn validate_repo_relative_path(kind: &str, path: &str) -> Result<()> {
    // The path-safety predicate is pure and lives in the gix-free kernel;
    // delegate and lift its error into this crate's `Error` via `From`.
    Ok(git_span_core::validate_repo_relative_path(kind, path)?)
}

/// Returns `true` when repo-relative `path` is equal to, or nested beneath,
/// `span_root`.
///
/// Both sides are compared after trimming a trailing `/` and a leading `./`.
/// Containment is `path == root` OR `path` starts with `"{root}/"` — the
/// `/`-boundary guard prevents sibling-prefix false positives like
/// `docs/spans` being matched by a root of `docs/span`.
pub fn is_inside_span_root(span_root: &str, path: &str) -> bool {
    // Normalize: trim trailing '/' and leading './' from both sides.
    let root = span_root.trim_end_matches('/');
    let root = root.strip_prefix("./").unwrap_or(root);

    let path = path.trim_end_matches('/');
    let path = path.strip_prefix("./").unwrap_or(path);

    // Equal to root, or nested beneath root (guarded by '/'-boundary).
    path == root || path.starts_with(&format!("{root}/"))
}

/// Reject an anchor path that falls inside the span directory.
///
/// Returns `Error::InvalidSpanFile` naming both the offending path and the
/// span root when `is_inside_span_root(span_root, path)` is true.
pub fn reject_anchor_inside_span_root(span_root: &str, path: &str) -> Result<()> {
    if is_inside_span_root(span_root, path) {
        return Err(Error::InvalidSpanFile(format!(
            "anchor path `{path}` is inside the span root `{span_root}`"
        )));
    }
    Ok(())
}

/// Classify a stored anchor `path` against `span_root` for read-time
/// surfacing.
///
/// Returns:
/// - `None` — the path is not inside the span root (nothing to surface).
/// - `Some(detail)` — the path is inside the span root; `detail` is a
///   human-readable clause naming why. A path that *structurally* matches the
///   `"{root}/"` prefix yet contains a `..` component (e.g. `.span/../foo`)
///   escapes the root on disk, so it is classified distinctly rather than
///   misreported as a plain interior anchor.
pub fn classify_interior_anchor(span_root: &str, path: &str) -> Option<String> {
    if !is_inside_span_root(span_root, path) {
        return None;
    }
    let has_parent_ref = path.split('/').any(|c| c == "..");
    if has_parent_ref {
        Some(format!(
            "path `{path}` is written under the span root `{span_root}` but contains a `..` \
             traversal — it is a malformed, non-portable anchor that must be removed"
        ))
    } else {
        Some(format!(
            "path `{path}` points inside the span root `{span_root}`; a span anchors code, \
             never another span document"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_returns_none_for_outside_path() {
        assert!(classify_interior_anchor(".span", "src/lib.rs").is_none());
    }

    #[test]
    fn classify_flags_plain_interior_anchor() {
        let d = classify_interior_anchor(".span", ".span/foo").unwrap();
        assert!(d.contains(".span/foo"));
        assert!(!d.contains(".."));
    }

    #[test]
    fn classify_flags_parent_traversal_distinctly() {
        let d = classify_interior_anchor(".span", ".span/../foo").unwrap();
        assert!(d.contains(".."), "traversal must be named distinctly: {d}");
    }

    // -----------------------------------------------------------------------
    // is_inside_span_root / reject_anchor_inside_span_root — predicate units
    // -----------------------------------------------------------------------

    #[test]
    fn predicate_equal_to_root_is_rejected() {
        assert!(is_inside_span_root(".span", ".span"));
    }

    #[test]
    fn predicate_nested_path_is_rejected() {
        assert!(is_inside_span_root(".span", ".span/subdir/file.rs"));
    }

    #[test]
    fn predicate_sibling_prefix_is_accepted() {
        // "docs/spans" must NOT be considered inside root "docs/span".
        assert!(!is_inside_span_root("docs/span", "docs/spans/x"));
    }

    #[test]
    fn predicate_trailing_slash_normalized() {
        // Trailing slash on root is trimmed before comparison.
        assert!(is_inside_span_root(".span/", ".span/bar"));
    }

    #[test]
    fn predicate_leading_dot_slash_normalized() {
        // Leading "./" on path is trimmed before comparison.
        assert!(is_inside_span_root(".span", "./.span/bar"));
    }

    #[test]
    fn reject_returns_err_for_inside_path() {
        assert!(reject_anchor_inside_span_root(".span", ".span/bar").is_err());
        let err = reject_anchor_inside_span_root(".span", ".span/bar").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains(".span/bar"), "message must name path; got: {msg}");
        assert!(msg.contains(".span"), "message must name span root; got: {msg}");
    }

    #[test]
    fn reject_returns_ok_for_outside_path() {
        assert!(reject_anchor_inside_span_root(".span", "src/lib.rs").is_ok());
    }

    #[test]
    fn validate_accepts_dot_span() {
        assert!(validate_span_root(".span").is_ok());
    }

    #[test]
    fn validate_accepts_nested() {
        assert!(validate_span_root("some/dir/span").is_ok());
    }

    #[test]
    fn validate_rejects_absolute() {
        let err = validate_span_root("/tmp/span").unwrap_err();
        assert!(err.to_string().contains("absolute"));
    }

    #[test]
    fn validate_rejects_parent_ref() {
        let err = validate_span_root("../span").unwrap_err();
        assert!(err.to_string().contains(".."));
    }

    #[test]
    fn validate_rejects_nested_parent_ref() {
        let err = validate_span_root("foo/../../bar").unwrap_err();
        assert!(err.to_string().contains(".."));
    }

    #[test]
    fn validate_rejects_dotgit_prefix() {
        let err = validate_span_root(".git/span").unwrap_err();
        assert!(err.to_string().contains(".git"));
    }

    #[test]
    fn validate_rejects_nested_dotgit() {
        let err = validate_span_root("foo/.git/span").unwrap_err();
        assert!(err.to_string().contains(".git"));
    }

    #[test]
    fn validate_rejects_dotgit_suffix() {
        let err = validate_span_root("some/.git").unwrap_err();
        assert!(err.to_string().contains(".git"));
    }

    #[test]
    fn validate_rejects_empty() {
        let err = validate_span_root("").unwrap_err();
        assert!(err.to_string().contains("empty"));
    }
}
