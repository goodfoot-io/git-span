//! Shared formatting helpers used across CLI handlers.
//!
//! Every function produces plain markdown text — no ANSI, no terminal-width
//! wrapping. Span names, paths, anchor addresses, refs, and SHAs are wrapped
//! in backticks for consistent rendering in markdown viewers and terminals.

/// Canonical anchor-address rendering: `<path>` for whole-file,
/// `<path>#L<s>-L<e>` for line-range anchors.
pub fn format_anchor_address(path: &str, start: Option<u32>, end: Option<u32>) -> String {
    match (start, end) {
        (Some(s), Some(e)) => format!("{path}#L{s}-L{e}"),
        _ => path.to_string(),
    }
}

/// One report line for a duplicate identity the merge kernel collapsed
/// within a single side's own anchors, before ours and theirs were ever
/// compared. Shared by both `merge_span_files` callers so the collapse is
/// named identically wherever it happens.
pub fn format_same_side_collapse(
    side: git_span_core::MergeSide,
    collapsed: &git_span_core::CollapsedIdentity,
) -> String {
    let side_name = match side {
        git_span_core::MergeSide::Ours => "ours",
        git_span_core::MergeSide::Theirs => "theirs",
    };
    let address = merge_report_address(
        &collapsed.path,
        collapsed.start_line,
        collapsed.end_line,
    );
    format!(
        "collapsed same-side duplicate ({side_name}): `{address}` — \
         {} records → 1",
        collapsed.records_before
    )
}

/// One report line for a duplicate-collapse sentinel the merge kernel
/// carried through unchanged rather than resolving by re-hashing.
///
/// The line does not send the operator through `drift --fix` first. A
/// sentinel arriving by merge is always in committed state, and `--fix`
/// tracks a position from worktree hunks — so for this population the
/// "run `--fix` to keep its position current, then `add` once the reported
/// address matches" instruction the round-6 text carried could never
/// complete: the first clause does nothing and the second clause's
/// condition can never become true.
///
/// What is left is the honest statement. A sentinel means nothing
/// established what this anchor's content is; with no content to match on,
/// nothing can establish where that content went either. The recorded
/// address is the last place the records agreed it was, not a location the
/// merge confirmed — so the two completion commands are offered against the
/// question only the operator can answer, and neither is presented as the
/// default.
pub fn format_sentinel_preserved(path: &str, start_line: u32, end_line: u32) -> String {
    let address = merge_report_address(path, start_line, end_line);
    format!(
        "preserved unverified collapse marker: `{address}` — a \
         duplicate-collapse sentinel survived merge; its content was never \
         verified and this merge confirmed nothing about where that content \
         now lives. Check the address yourself, then run `git span add \
         {address}` if the coupled content still lives there, or `git span \
         replace {address} <new-address>` if it has moved"
    )
}

/// Render a span-file record's stored coordinates as an anchor address.
/// A whole-file record stores `0`/`0`, which is the bare path.
fn merge_report_address(path: &str, start_line: u32, end_line: u32) -> String {
    if start_line == 0 && end_line == 0 {
        format_anchor_address(path, None, None)
    } else {
        format_anchor_address(path, Some(start_line), Some(end_line))
    }
}

/// Format a span name in backticks for prose output.
pub fn format_span_name(name: &str) -> String {
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

/// Quote `s` as a single-quoted POSIX shell argument, escaping embedded
/// single quotes as `'\''`.
///
/// Anchor paths may legally contain spaces and single quotes
/// (`normalize_anchor_path` only rewrites backslashes), so the printed
/// `git span remove <name> '<path>'` repair command must survive both. The
/// output is valid in any POSIX shell: each `'...'` segment is literal, and
/// `'\''` closes the quote, emits one literal `'`, and reopens it.
pub fn quote_shell(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
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
    fn span_name_backticked() {
        assert_eq!(format_span_name("checkout"), "`checkout`");
    }

    #[test]
    fn path_backticked() {
        assert_eq!(format_path("src/main.rs"), "`src/main.rs`");
    }

    #[test]
    fn follow_up_command_fenced() {
        let result = format_follow_up_command("git span list");
        assert_eq!(result, "```bash\ngit span list\n```");
    }

    #[test]
    fn idempotent_tag() {
        assert_eq!(IDEMPOTENT_TAG, " (idempotent)");
    }

    #[test]
    fn destructive_tag() {
        assert_eq!(DESTRUCTIVE_TAG, " (destructive)");
    }

    // ---------------------------------------------------------------------
    // quote_shell contract
    // ---------------------------------------------------------------------

    #[test]
    fn quote_shell_wraps_plain_path_in_single_quotes() {
        assert_eq!(quote_shell("src/lib.rs"), "'src/lib.rs'");
    }

    #[test]
    fn quote_shell_escapes_embedded_single_quote() {
        // `'it'\''s here.txt'` — the `'\''` sequence closes the quote,
        // emits one literal `'`, and reopens it.
        assert_eq!(quote_shell("it's here.txt"), "'it'\\''s here.txt'");
    }

    #[test]
    fn quote_shell_preserves_spaces() {
        assert_eq!(
            quote_shell("dir with space/file.rs"),
            "'dir with space/file.rs'"
        );
    }
}
