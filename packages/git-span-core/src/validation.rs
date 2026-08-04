//! Pure name/path validation — the ref-legal span-name rules, the anchor-id
//! rule, and the repo-relative path-safety guard. None of these touch a
//! repository; they are string predicates shared by git-span and downstream
//! consumers.

use crate::error::{Error, Result};

/// Subcommands and reserved tokens that cannot be used as span names.
pub const RESERVED_SPAN_NAMES: &[&str] = &[
    "add",
    "show",
    "remove",
    "commit",
    "why",
    "restore",
    "revert",
    "delete",
    "move",
    "drift",
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

/// Tokens that were git-span subcommands in an earlier release, paired with
/// the token that replaced them. This repository keeps no aliases, so a
/// retired name must not run — but it also must not be mistaken for an
/// ordinary span name, or the CLI answers a renamed subcommand with "no span
/// named `<x>`" and points the user at `git span list`, which enumerates
/// spans and can never mention the replacement. A retired name is therefore
/// reserved exactly like a live subcommand, and the CLI answers it with the
/// rename.
pub const RETIRED_SPAN_NAMES: &[(&str, &str)] = &[("stale", "drift")];

/// The replacement token for `name`, when `name` is a retired subcommand.
pub fn retired_replacement(name: &str) -> Option<&'static str> {
    RETIRED_SPAN_NAMES
        .iter()
        .find(|(retired, _)| *retired == name)
        .map(|(_, replacement)| *replacement)
}

/// True when `name` cannot be used as a span name: a live subcommand or
/// reserved token ([`RESERVED_SPAN_NAMES`]), or a retired subcommand
/// ([`RETIRED_SPAN_NAMES`]).
///
/// The check is on the whole name, so a hierarchical name whose first
/// segment happens to be reserved (`drift/foo`) is unaffected.
pub fn is_reserved_span_name(name: &str) -> bool {
    RESERVED_SPAN_NAMES.contains(&name) || retired_replacement(name).is_some()
}

/// Span-name shape: one or more kebab-case segments separated by `/`. The
/// recommended hierarchical form is `<category>/<subcategory>/<identifier-slug>`,
/// but a bare slug or any depth `>= 1` is accepted.
/// Concretely: `^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*$`.
pub const SPAN_NAME_RULE: &str = "kebab-case segments separated by `/` (e.g. `<slug>`, `<category>/<slug>`, \
     or `<category>/<subcategory>/<identifier-slug>`); lowercase a-z, 0-9, \
     and `-`; each segment must start with a letter or digit";

/// Validate a span name against the reserved list and the kebab-case naming rule.
///
/// This is the **create-time** rule: it answers "may this name be written?".
/// Operations that reduce the reserved surface — deleting a span, or renaming
/// one away from a reserved name — must validate only
/// [`validate_span_name_shape`], because the name they act on may predate its
/// reservation and refusing it would leave the span permanently frozen.
pub fn validate_span_name(name: &str) -> Result<()> {
    if let Some(replacement) = retired_replacement(name) {
        return Err(Error::RetiredName {
            name: name.to_string(),
            replacement: replacement.to_string(),
        });
    }
    if RESERVED_SPAN_NAMES.contains(&name) {
        return Err(Error::ReservedName(name.to_string()));
    }
    validate_span_name_shape(name)
}

/// Validate an anchor id (ref-legal).
pub fn validate_anchor_id(id: &str) -> Result<()> {
    validate_ref_component(id)
}

/// Validate the kebab-case-segments shape of a span name.
pub fn validate_span_name_shape(value: &str) -> Result<()> {
    fn bad(msg: impl Into<String>) -> Error {
        Error::InvalidName(msg.into())
    }
    if value.is_empty() {
        return Err(bad("span name must not be empty"));
    }
    // Split hierarchical `<a>/<b>/<c>/...` into one or more segments.
    let segments: Vec<&str> = value.split('/').collect();
    for segment in &segments {
        if segment.is_empty() {
            return Err(bad(format!(
                "`{value}` has an empty segment ({SPAN_NAME_RULE})"
            )));
        }
        let first = segment.chars().next().unwrap();
        if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
            return Err(bad(format!(
                "`{value}` segment `{segment}` must start with a-z or 0-9 ({SPAN_NAME_RULE})"
            )));
        }
        for ch in segment.chars() {
            let ok = ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-';
            if !ok {
                return Err(bad(format!(
                    "`{value}` segment `{segment}` contains invalid character `{ch}` ({SPAN_NAME_RULE})"
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
/// `kind` names the subject for error messages (e.g. `"span root"`,
/// `"anchor path"`). This is the single path-safety validator shared by
/// span-root resolution and `git span add` anchor-address validation.
///
/// Rejects:
/// - Empty paths
/// - Absolute paths (starting with `/`)
/// - Paths containing a `..` component
/// - Paths inside `.git` (equal to `.git`, starting with `.git/`,
///   containing `/.git/`, or ending with `/.git`)
pub fn validate_repo_relative_path(kind: &str, path: &str) -> Result<()> {
    if path.is_empty() {
        return Err(Error::InvalidSpanFile(format!("{kind} must not be empty")));
    }

    // Reject absolute paths (Unix-style).
    if path.starts_with('/') {
        return Err(Error::InvalidSpanFile(format!(
            "{kind} must be repo-relative, got absolute path: `{path}`"
        )));
    }

    // Reject paths containing `..`.
    // We split on '/' and check each component to avoid false positives
    // like `foo..bar`.
    for component in path.split('/') {
        if component == ".." {
            return Err(Error::InvalidSpanFile(format!(
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
        return Err(Error::InvalidSpanFile(format!(
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
            validate_span_name("commit"),
            Err(Error::ReservedName(_))
        ));
        assert!(matches!(
            validate_span_name("history"),
            Err(Error::ReservedName(_))
        ));
    }

    /// A retired subcommand is refused with its replacement named, not with
    /// the generic reserved-name error — the whole point of keeping it
    /// reserved is that the CLI can answer with the rename.
    #[test]
    fn retired_name_is_rejected_and_names_its_replacement() {
        let err = validate_span_name("stale").expect_err("`stale` was retired");
        assert!(
            matches!(&err, Error::RetiredName { name, replacement }
                if name == "stale" && replacement == "drift"),
            "expected RetiredName{{stale -> drift}}, got {err:?}"
        );
        assert!(
            err.to_string().contains("git span drift"),
            "the message must name the replacement, got: {err}"
        );
        assert_eq!(retired_replacement("stale"), Some("drift"));
        assert_eq!(retired_replacement("stail"), None);
    }

    /// Reserved and retired names are both unavailable, and the check is on
    /// the whole name — a hierarchical name whose first segment is reserved
    /// stays legal.
    #[test]
    fn is_reserved_covers_reserved_and_retired_but_not_hierarchies() {
        assert!(is_reserved_span_name("drift"));
        assert!(is_reserved_span_name("show"));
        assert!(is_reserved_span_name("stale"));
        assert!(!is_reserved_span_name("drift/nested"));
        assert!(!is_reserved_span_name("stale-anchors"));
    }

    /// The shape rule is the gate for operations that *reduce* the reserved
    /// surface (delete, rename away). It must accept a reserved name so an
    /// already-existing span carrying one is never frozen.
    #[test]
    fn shape_rule_accepts_reserved_and_retired_names() {
        assert!(validate_span_name_shape("drift").is_ok());
        assert!(validate_span_name_shape("stale").is_ok());
    }

    /// The reserved-name refusal must carry the escape, not just the rule:
    /// a span that predates the reservation has no other way out.
    #[test]
    fn reserved_name_message_names_the_escape() {
        let err = validate_span_name("drift").expect_err("`drift` is reserved");
        let msg = err.to_string();
        assert!(
            msg.contains("git span delete drift"),
            "the message must name the escape, got: {msg}"
        );
    }

    #[test]
    fn kebab_shape_accepts_hierarchy_rejects_bad_chars() {
        assert!(validate_span_name("billing/checkout-flow").is_ok());
        assert!(matches!(
            validate_span_name("Billing"),
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
        assert!(validate_repo_relative_path("span root", ".span").is_ok());
        assert!(validate_repo_relative_path("span root", "/abs").is_err());
        assert!(validate_repo_relative_path("span root", "../x").is_err());
        assert!(validate_repo_relative_path("span root", ".git/x").is_err());
        assert!(validate_repo_relative_path("span root", "").is_err());
    }
}
