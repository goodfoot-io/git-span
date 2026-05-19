//! Shared formatting helpers used across CLI handlers.
//!
//! Every function produces plain markdown text — no ANSI, no terminal-width
//! wrapping. Mesh names, paths, anchor addresses, refs, and SHAs are wrapped
//! in backticks for consistent rendering in markdown viewers and terminals.

/// Canonical anchor-address rendering: `<path>` for whole-file,
/// `<path>#L<s>-L<e>` for line-range anchors.
pub fn format_anchor_address(path: &str, start: Option<u32>, end: Option<u32>) -> String {
    match (start, end) {
        (Some(s), Some(e)) => format!("{path}#L{s}-L{e}"),
        _ => path.to_string(),
    }
}

/// Format a mesh name in backticks for prose output.
pub fn format_mesh_name(name: &str) -> String {
    format!("`{name}`")
}

/// Format a path in backticks for prose output.
pub fn format_path(path: &str) -> String {
    format!("`{path}`")
}

/// Render the "next command" as a fenced bash block with a single command.
pub fn format_follow_up_command(bash: &str) -> String {
    format!("```bash\n{bash}\n```")
}

/// " (idempotent)" tag.
pub const IDEMPOTENT_TAG: &str = " (idempotent)";

/// " (destructive)" tag.
pub const DESTRUCTIVE_TAG: &str = " (destructive)";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_address_whole_file() {
        assert_eq!(
            format_anchor_address("src/lib.rs", None, None),
            "src/lib.rs"
        );
    }

    #[test]
    fn anchor_address_with_line_range() {
        assert_eq!(
            format_anchor_address("src/lib.rs", Some(10), Some(30)),
            "src/lib.rs#L10-L30"
        );
    }

    #[test]
    fn anchor_address_single_line() {
        // start == end should produce a single-line range
        assert_eq!(
            format_anchor_address("src/lib.rs", Some(42), Some(42)),
            "src/lib.rs#L42-L42"
        );
    }

    #[test]
    fn anchor_address_only_start() {
        // start set but end None — treat as whole-file
        assert_eq!(
            format_anchor_address("src/lib.rs", Some(10), None),
            "src/lib.rs"
        );
    }

    #[test]
    fn anchor_address_only_end() {
        // end set but start None — treat as whole-file
        assert_eq!(
            format_anchor_address("src/lib.rs", None, Some(30)),
            "src/lib.rs"
        );
    }

    #[test]
    fn mesh_name_backticked() {
        assert_eq!(format_mesh_name("checkout"), "`checkout`");
    }

    #[test]
    fn path_backticked() {
        assert_eq!(format_path("src/main.rs"), "`src/main.rs`");
    }

    #[test]
    fn follow_up_command_fenced() {
        let result = format_follow_up_command("git mesh list");
        assert_eq!(result, "```bash\ngit mesh list\n```");
    }

    #[test]
    fn idempotent_tag() {
        assert_eq!(IDEMPOTENT_TAG, " (idempotent)");
    }

    #[test]
    fn destructive_tag() {
        assert_eq!(DESTRUCTIVE_TAG, " (destructive)");
    }
}
