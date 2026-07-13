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
    /// Rendered inside a fenced ```bash block.
    Bash(String),
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
