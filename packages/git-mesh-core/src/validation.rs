//! Pure name/path validation — the ref-legal mesh-name rules, the anchor-id
//! rule, and the repo-relative path-safety guard. None of these touch a
//! repository; they are string predicates shared by git-mesh and downstream
//! consumers.

use crate::error::{Error, Result};

/// Subcommands and reserved tokens that cannot be used as mesh names.
pub const RESERVED_MESH_NAMES: &[&str] = &[
    "add",
    "remove",
    "commit",
    "why",
    "restore",
    "revert",
    "delete",
    "move",
    "stale",
    "tree",
    "fetch",
    "push",
    "doctor",
    "log",
    "config",
    "list",
    "help",
    "pre-commit",
    "advice",
    "rewrite",
    "hooks",
    "merge-driver",
    "history",
];

/// Mesh-name shape: one or more kebab-case segments separated by `/`. The
/// recommended hierarchical form is `<category>/<subcategory>/<identifier-slug>`,
/// but a bare slug or any depth `>= 1` is accepted.
/// Concretely: `^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*$`.
pub const MESH_NAME_RULE: &str = "kebab-case segments separated by `/` (e.g. `<slug>`, `<category>/<slug>`, \
     or `<category>/<subcategory>/<identifier-slug>`); lowercase a-z, 0-9, \
     and `-`; each segment must start with a letter or digit";

/// Validate a mesh name against the reserved list and the kebab-case naming rule.
pub fn validate_mesh_name(name: &str) -> Result<()> {
    if RESERVED_MESH_NAMES.contains(&name) {
        return Err(Error::ReservedName(name.to_string()));
    }
    validate_mesh_name_shape(name)
}

/// Validate an anchor id (ref-legal).
pub fn validate_anchor_id(id: &str) -> Result<()> {
    validate_ref_component(id)
}

/// Validate the kebab-case-segments shape of a mesh name.
pub fn validate_mesh_name_shape(value: &str) -> Result<()> {
    fn bad(msg: impl Into<String>) -> Error {
        Error::InvalidName(msg.into())
    }
    if value.is_empty() {
        return Err(bad("mesh name must not be empty"));
    }
    // Split hierarchical `<a>/<b>/<c>/...` into one or more segments.
    let segments: Vec<&str> = value.split('/').collect();
    for segment in &segments {
        if segment.is_empty() {
            return Err(bad(format!(
                "`{value}` has an empty segment ({MESH_NAME_RULE})"
            )));
        }
        let first = segment.chars().next().unwrap();
        if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
            return Err(bad(format!(
                "`{value}` segment `{segment}` must start with a-z or 0-9 ({MESH_NAME_RULE})"
            )));
        }
        for ch in segment.chars() {
            let ok = ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-';
            if !ok {
                return Err(bad(format!(
                    "`{value}` segment `{segment}` contains invalid character `{ch}` ({MESH_NAME_RULE})"
                )));
            }
        }
    }
    // Belt-and-braces ref-legality checks (the kebab-case rule already
    // forbids most of these, but keep the explicit refusals for clarity).
    if value.contains("..") {
        return Err(bad(format!("`{value}` must not contain `..`")));
    }
    if value.ends_with(".lock") {
        return Err(bad(format!("`{value}` must not end with `.lock`")));
    }
    Ok(())
}

fn validate_ref_component(value: &str) -> Result<()> {
    fn bad(msg: impl Into<String>) -> Error {
        Error::InvalidName(msg.into())
    }
    if value.is_empty() {
        return Err(bad("name must not be empty"));
    }
    if value.starts_with('-') {
        return Err(bad(format!("`{value}` must not start with `-`")));
    }
    if value.starts_with('.') {
        return Err(bad(format!("`{value}` must not start with `.`")));
    }
    if value.ends_with('.') {
        return Err(bad(format!("`{value}` must not end with `.`")));
    }
    if value.ends_with(".lock") {
        return Err(bad(format!("`{value}` must not end with `.lock`")));
    }
    if value == "@" {
        return Err(bad("`@` is not allowed"));
    }
    if value.contains("..") {
        return Err(bad(format!("`{value}` must not contain `..`")));
    }
    if value.contains("@{") {
        return Err(bad(format!("`{value}` must not contain `@{{`")));
    }
    for ch in value.chars() {
        if ch == '/' {
            return Err(bad(format!("`{value}` must not contain `/`")));
        }
        if ch.is_whitespace() {
            return Err(bad(format!("`{value}` must not contain whitespace")));
        }
        if ch.is_control() {
            return Err(bad(format!(
                "`{value}` must not contain control characters"
            )));
        }
        if matches!(ch, '~' | '^' | ':' | '?' | '*' | '[' | '\\') {
            return Err(bad(format!("`{value}` must not contain `{ch}`")));
        }
    }
    Ok(())
}

/// Validate that `path` is a safe repo-relative path.
///
/// `kind` names the subject for error messages (e.g. `"mesh root"`,
/// `"anchor path"`). This is the single path-safety validator shared by
/// mesh-root resolution and `git mesh add` anchor-address validation.
///
/// Rejects:
/// - Empty paths
/// - Absolute paths (starting with `/`)
/// - Paths containing a `..` component
/// - Paths inside `.git` (equal to `.git`, starting with `.git/`,
///   containing `/.git/`, or ending with `/.git`)
pub fn validate_repo_relative_path(kind: &str, path: &str) -> Result<()> {
    if path.is_empty() {
        return Err(Error::InvalidMeshFile(format!("{kind} must not be empty")));
    }

    // Reject absolute paths (Unix-style).
    if path.starts_with('/') {
        return Err(Error::InvalidMeshFile(format!(
            "{kind} must be repo-relative, got absolute path: `{path}`"
        )));
    }

    // Reject paths containing `..`.
    // We split on '/' and check each component to avoid false positives
    // like `foo..bar`.
    for component in path.split('/') {
        if component == ".." {
            return Err(Error::InvalidMeshFile(format!(
                "{kind} must not contain `..`: `{path}`"
            )));
        }
    }

    // Reject paths inside `.git`.
    let normalized = path.trim_end_matches('/');
    if normalized == ".git"
        || normalized.starts_with(".git/")
        || normalized.contains("/.git/")
        || normalized.ends_with("/.git")
    {
        return Err(Error::InvalidMeshFile(format!(
            "{kind} must not be inside `.git`: `{path}`"
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_name_is_rejected() {
        assert!(matches!(
            validate_mesh_name("commit"),
            Err(Error::ReservedName(_))
        ));
        assert!(matches!(
            validate_mesh_name("history"),
            Err(Error::ReservedName(_))
        ));
    }

    #[test]
    fn kebab_shape_accepts_hierarchy_rejects_bad_chars() {
        assert!(validate_mesh_name("billing/checkout-flow").is_ok());
        assert!(matches!(
            validate_mesh_name("Billing"),
            Err(Error::InvalidName(_))
        ));
    }

    #[test]
    fn anchor_id_rejects_slash_and_dotdot() {
        assert!(validate_anchor_id("a-valid-id").is_ok());
        assert!(validate_anchor_id("has/slash").is_err());
        assert!(validate_anchor_id("..").is_err());
    }

    #[test]
    fn repo_relative_path_rejects_absolute_dotdot_and_dotgit() {
        assert!(validate_repo_relative_path("mesh root", ".mesh").is_ok());
        assert!(validate_repo_relative_path("mesh root", "/abs").is_err());
        assert!(validate_repo_relative_path("mesh root", "../x").is_err());
        assert!(validate_repo_relative_path("mesh root", ".git/x").is_err());
        assert!(validate_repo_relative_path("mesh root", "").is_err());
    }
}
