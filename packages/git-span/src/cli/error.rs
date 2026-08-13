//! Structured CLI error type with markdown prose rendering.
//!
//! [`CliError`] wraps an operational failure with remediation context.
//! Its [`Display`] impl produces a one-line form (for the anyhow error chain),
//! while [`render_error`] produces the full markdown prose shape for stderr.
//!
//! ## Output shape (rendered)
//!
//! ```text
//! git span <subcommand>: <summary>
//!
//! <what_happened>
//!
//! ## What to do next
//!
//! <prose paragraph, or fenced bash block>
//! ```

/// A structured CLI error carrying remediation context.
///
/// `Display` produces a one-line form for the anyhow error chain.
/// Call [`render_error`] to produce the full markdown prose shape.
#[derive(Debug)]
pub struct CliError {
    pub subcommand: &'static str,
    pub summary: String,
    pub what_happened: String,
    pub next_steps: Vec<NextStep>,
}

/// A step in the "What to do next" remediation section.
#[derive(Debug)]
pub enum NextStep {
    /// Rendered as a plain prose paragraph.
    Prose(String),
    /// Rendered inside a fenced ```bash block whose lines are
    /// **order-independent**. That is the property, not "alternatives": the
    /// per-span `git add` and `--dry-run` fences list commands that are all
    /// *required*, just not in any particular order, while a side-flag fence is
    /// a menu. Both are order-independent, which is what a reader may rely on.
    /// A report-only command such as `--dry-run` is a legitimate member,
    /// because nothing here claims a line advances the state the next line
    /// meets.
    Bash(String),
    /// A fenced ```bash block whose lines are a **sequence**, run in the order
    /// given, each against the state the previous one left. Rendered
    /// identically; typed apart because the guarantees differ.
    ///
    /// The distinction exists because a gate could not see it. The rename
    /// refusal fenced `drift --fix` followed by `resolve --dry-run` under "run
    /// it, then re-run `resolve` on the residue it leaves", and the residue
    /// never materialized — `drift --fix` settles that input completely, so the
    /// operator's last output was `no conflict markers; nothing to resolve`,
    /// the very sentence the same refusal teaches them to read as "you are in
    /// the other case". The gate passed anyway: it filters `--dry-run` out as a
    /// report rather than a repair, which is correct for alternatives and
    /// inverted for the tail of a sequence, and it re-seeds the fixture per
    /// command, which dissolves the ordering the defect lives in. With the two
    /// kinds different types, a check can hold a sequence to ending in a real
    /// repair while leaving alternatives exempt.
    Ordered(Vec<String>),
}

impl std::error::Error for CliError {}

impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "git span {}: {}", self.subcommand, self.summary)
    }
}

/// Render a [`CliError`] into the full markdown prose shape.
///
/// The output follows this structure:
///
/// ```text
/// git span <subcommand>: <summary>
///
/// <what_happened>
/// ```
///
/// When `next_steps` is non-empty, a `## What to do next` section is appended
/// with each step rendered as a paragraph or fenced bash block.
fn render(err: &CliError) -> String {
    let mut out = format!("git span {}: {}", err.subcommand, err.summary);
    out.push('\n');
    out.push('\n');
    out.push_str(&err.what_happened);

    if !err.next_steps.is_empty() {
        out.push('\n');
        out.push('\n');
        out.push_str("## What to do next");
        out.push('\n');
        out.push('\n');

        for (i, step) in err.next_steps.iter().enumerate() {
            match step {
                NextStep::Prose(text) => {
                    out.push_str(text);
                }
                NextStep::Bash(cmd) => {
                    out.push_str("```bash\n");
                    out.push_str(cmd);
                    out.push('\n');
                    out.push_str("```");
                }
                NextStep::Ordered(cmds) => {
                    out.push_str("```bash\n");
                    out.push_str(&cmds.join("\n"));
                    out.push('\n');
                    out.push_str("```");
                }
            }
            if i < err.next_steps.len() - 1 {
                out.push('\n');
                out.push('\n');
            }
        }
    }

    out
}

/// Render a [`CliError`] into the full markdown prose shape (public wrapper).
pub fn render_error(err: &CliError) -> String {
    render(err)
}

/// Wrap a library error into a [`CliError`].
///
/// The library error's `Display` text becomes the `what_happened` paragraph.
/// Callers supply the subcommand, a summary sentence, and remediation steps.
pub fn from_lib_error(
    subcommand: &'static str,
    summary: impl Into<String>,
    lib_error: impl std::fmt::Display,
    next_steps: Vec<NextStep>,
) -> CliError {
    CliError {
        subcommand,
        summary: summary.into(),
        what_happened: lib_error.to_string(),
        next_steps,
    }
}

/// Wrap a resolver failure into the curated shape for `drift`/`history`.
///
/// This is the catch-all for `Error::Git` — "some git read failed" — and it is
/// important that the prose says only that. It used to open by asserting that
/// the object store was damaged or incomplete and lead with `git fsck`, which
/// was a diagnosis the error carries no evidence for. `Error::Git` is raised by
/// dozens of call sites, and the ones users actually hit are mundane: an unborn
/// branch on a freshly initialized repository reaches this template and is told
/// its objects may be corrupt, after which `git fsck` exits 0 and reports a
/// perfectly healthy repository — leaving the user with a contradiction and a
/// standing invitation to re-fetch or restore from backup over a repo that was
/// never broken. Destructive-adjacent advice has to be earned by evidence.
///
/// So: state the failure, quote the underlying error (which does name the real
/// cause), and offer `fsck` as one hypothesis among several rather than the
/// conclusion. Conditions that *do* have a specific diagnosis — a content
/// filter that could not be started, most of all — must be routed to their own
/// classification or their own curated error and never reach here.
pub fn resolver_read_error(
    subcommand: &'static str,
    lib_error: impl std::fmt::Display,
) -> CliError {
    from_lib_error(
        subcommand,
        "span state could not be resolved.",
        lib_error,
        vec![
            NextStep::Prose(
                "A git read failed while resolving anchors, so no drift \
                 classification can be trusted. The error above names what \
                 failed — start there: a repository with no commits yet, an \
                 unreadable HEAD, or a missing external tool are all more \
                 common than a damaged repository."
                    .into(),
            ),
            NextStep::Prose(
                "If the error points at a missing or unreadable object, check \
                 the object store:"
                    .into(),
            ),
            NextStep::Bash("git fsck".into()),
            NextStep::Prose(
                "Only if fsck reports missing or corrupt objects is repair the \
                 answer — restore them by re-fetching from a remote or from a \
                 backup, then retry. A clean fsck means the cause is the one \
                 named above, not the object store."
                    .into(),
            ),
        ],
    )
}

/// Wrap a content-filter driver failure into its own curated shape.
///
/// The backstop for a filter failure that escapes as a hard error rather than
/// resolving to a per-anchor `ContentUnavailable(FilterFailed)`. Everything the
/// remediation needs is local: the driver's name, and the fact that
/// `.gitattributes` is what pulled it in. Nothing here mentions the object
/// store, `git fsck`, re-fetching, or backups, because none of those bear on a
/// program that is not installed.
pub fn filter_driver_error(
    subcommand: &'static str,
    filter: &str,
    lib_error: impl std::fmt::Display,
) -> CliError {
    from_lib_error(
        subcommand,
        format!("content filter `{filter}` could not be run."),
        lib_error,
        vec![
            NextStep::Prose(format!(
                "A path in this repository is routed through the `{filter}` \
                 content filter by `.gitattributes`, and git-span cannot read \
                 that path without it. The repository itself is fine — this is \
                 a missing or misconfigured filter driver. Check how it is \
                 configured:"
            )),
            NextStep::Bash(format!("git config --get-regexp '^filter\\.{filter}\\.'")),
            NextStep::Prose(format!(
                "Install the driver so the configured command is runnable. If \
                 the filter is no longer needed, drop the `filter={filter}` \
                 attribute from `.gitattributes`, or unset the driver:"
            )),
            NextStep::Bash(format!(
                "git config --unset filter.{filter}.clean\ngit config --unset filter.{filter}.smudge\ngit config --unset filter.{filter}.process"
            )),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_one_line_form() {
        let err = CliError {
            subcommand: "delete",
            summary: "no span named `checkout`.".into(),
            what_happened: "`.span/checkout` does not exist.".into(),
            next_steps: vec![],
        };
        assert_eq!(
            err.to_string(),
            "git span delete: no span named `checkout`."
        );
    }

    #[test]
    fn render_no_next_steps() {
        let err = CliError {
            subcommand: "delete",
            summary: "no span named `checkout`.".into(),
            what_happened: "`.span/checkout` does not exist.".into(),
            next_steps: vec![],
        };
        let expected =
            "git span delete: no span named `checkout`.\n\n`.span/checkout` does not exist.";
        assert_eq!(render(&err), expected);
    }

    #[test]
    fn render_with_prose_steps() {
        let err = CliError {
            subcommand: "add",
            summary: "invalid arguments.".into(),
            what_happened: "You must specify at least one anchor.".into(),
            next_steps: vec![
                NextStep::Prose("Provide one or more anchors to stage.".into()),
                NextStep::Prose(
                    "Use `<path>` for whole-file or `<path>#L<start>-L<end>` for a line range."
                        .into(),
                ),
            ],
        };
        let expected = "\
git span add: invalid arguments.

You must specify at least one anchor.

## What to do next

Provide one or more anchors to stage.

Use `<path>` for whole-file or `<path>#L<start>-L<end>` for a line range.";
        assert_eq!(render(&err), expected);
    }

    #[test]
    fn render_with_bash_steps() {
        let err = CliError {
            subcommand: "delete",
            summary: "no span named `checkout`.".into(),
            what_happened: "`.span/checkout` does not exist.".into(),
            next_steps: vec![NextStep::Bash("git span list".into())],
        };
        let expected = "\
git span delete: no span named `checkout`.

`.span/checkout` does not exist.

## What to do next

```bash
git span list
```";
        assert_eq!(render(&err), expected);
    }

    #[test]
    fn render_with_mixed_steps() {
        let err = CliError {
            subcommand: "add",
            summary: "anchor path does not exist.".into(),
            what_happened: "`web/checkout.tsx` is not tracked at the resolved revision.".into(),
            next_steps: vec![
                NextStep::Prose("Stage the path, or anchor an existing one:".into()),
                NextStep::Bash(
                    "git add web/checkout.tsx\ngit span add billing/checkout web/checkout.tsx"
                        .into(),
                ),
            ],
        };
        let expected = "\
git span add: anchor path does not exist.

`web/checkout.tsx` is not tracked at the resolved revision.

## What to do next

Stage the path, or anchor an existing one:

```bash
git add web/checkout.tsx
git span add billing/checkout web/checkout.tsx
```";
        assert_eq!(render(&err), expected);
    }

    #[test]
    fn render_verbatim_delete_example() {
        // Verbatim match against the CARD.md `git span delete` error example.
        let err = CliError {
            subcommand: "delete",
            summary: "no span named `checkout`.".into(),
            what_happened: "`.span/checkout` does not exist.".into(),
            next_steps: vec![NextStep::Bash("git span list".into())],
        };
        let expected = "\
git span delete: no span named `checkout`.

`.span/checkout` does not exist.

## What to do next

```bash
git span list
```";
        assert_eq!(render(&err), expected);
    }

    #[test]
    fn from_lib_error_wraps_correctly() {
        let summary = "no span named `checkout`.";
        let lib_err = std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "`.span/checkout` does not exist",
        );
        let err = from_lib_error(
            "delete",
            summary,
            &lib_err,
            vec![NextStep::Bash("git span list".into())],
        );

        assert_eq!(err.subcommand, "delete");
        assert_eq!(err.summary, "no span named `checkout`.");
        assert_eq!(err.what_happened, "`.span/checkout` does not exist");
        assert_eq!(err.next_steps.len(), 1);
    }

    #[test]
    fn render_error_public_wrapper() {
        let err = CliError {
            subcommand: "test",
            summary: "summary.".into(),
            what_happened: "details.".into(),
            next_steps: vec![],
        };
        assert_eq!(render_error(&err), render(&err));
    }
}
