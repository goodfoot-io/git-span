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

/// Format a ref transition message:
/// `"Recorded mesh commit on \`ref\`: \`old\` → \`new\`."`
pub fn format_ref_transition(ref_name: &str, old: &str, new: &str) -> String {
    format!("Recorded mesh commit on `{ref_name}`: `{old}` → `{new}`.")
}

/// Format a fast-forward message:
/// `"Fast-forwarded \`ref\` from \`old\` to \`new\`."`
pub fn format_fast_forward(ref_name: &str, old: &str, new: &str) -> String {
    format!("Fast-forwarded `{ref_name}` from `{old}` to `{new}`.")
}

/// Format a ref-deletion message:
/// `"Deleted \`ref\` (\`sha\`). The mesh's commit history remains in the reflog for 90 days."`
pub fn format_ref_deletion(ref_name: &str, sha: &str) -> String {
    format!(
        "Deleted `{ref_name}` (`{sha}`). The mesh's commit history remains in the reflog for 90 days."
    )
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
    fn ref_transition_format() {
        let result = format_ref_transition("refs/meshes/v1/checkout", "a1b2c3d", "e4f5g6h");
        assert_eq!(
            result,
            "Recorded mesh commit on `refs/meshes/v1/checkout`: `a1b2c3d` → `e4f5g6h`."
        );
    }

    #[test]
    fn fast_forward_format() {
        let result = format_fast_forward("refs/meshes/v1/checkout", "a1b2c3d", "e4f5g6h");
        assert_eq!(
            result,
            "Fast-forwarded `refs/meshes/v1/checkout` from `a1b2c3d` to `e4f5g6h`."
        );
    }

    #[test]
    fn ref_deletion_format() {
        let result = format_ref_deletion("refs/meshes/v1/checkout", "a1b2c3d");
        assert_eq!(
            result,
            "Deleted `refs/meshes/v1/checkout` (`a1b2c3d`). The mesh's commit history remains in the reflog for 90 days."
        );
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
