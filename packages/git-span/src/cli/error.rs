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
    render_report(&err.to_string(), &err.what_happened, &err.next_steps)
}

/// The shared prose shape behind [`render`] and [`render_internal_error`]:
/// headline, blank line, `what_happened`, then the optional
/// `## What to do next` section.
fn render_report(headline: &str, what_happened: &str, next_steps: &[NextStep]) -> String {
    let mut out = headline.to_owned();
    out.push('\n');
    out.push('\n');
    out.push_str(what_happened);

    if !next_steps.is_empty() {
        out.push('\n');
        out.push('\n');
        out.push_str("## What to do next");
        out.push('\n');
        out.push('\n');

        for (i, step) in next_steps.iter().enumerate() {
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
            if i < next_steps.len() - 1 {
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

/// Exit status of a run that panicked: the same `1` every other operational
/// failure uses, so an agent hook or CI step that branches on the documented
/// exit-code table fails closed instead of meeting Rust's undocumented `101`.
/// The stderr report is what distinguishes it from a drift verdict.
pub const INTERNAL_ERROR_EXIT_CODE: i32 = 1;

/// Where to report a panic.
const ISSUE_TRACKER_URL: &str = "https://github.com/goodfoot-io/git-span/issues";

/// What a panic hook knows about one panic, decoupled from
/// [`std::panic::PanicHookInfo`] so the rendering is testable without
/// panicking.
#[derive(Debug)]
pub struct PanicReport<'a> {
    /// `file:line:column` of the panic, when the runtime supplied one.
    pub location: Option<String>,
    /// The panic payload as text.
    pub message: &'a str,
    /// The process argv, `argv[0]` included.
    pub argv: &'a [String],
    /// A captured backtrace, present only when `RUST_BACKTRACE` (or
    /// `RUST_LIB_BACKTRACE`) asked for one.
    pub backtrace: Option<String>,
}

/// Render a panic in the [`render_error`] prose shape, headed
/// `git span: internal error: …` so it can never be mistaken for a curated
/// operational error or a drift verdict.
pub fn render_internal_error(report: &PanicReport<'_>) -> String {
    let headline = match &report.location {
        Some(location) => format!("git span: internal error: panicked at {location}."),
        None => "git span: internal error: panicked.".to_owned(),
    };
    let command = std::iter::once("git span".to_owned())
        .chain(
            report
                .argv
                .iter()
                .skip(1)
                .map(|argument| shell_words::quote(argument).into_owned()),
        )
        .collect::<Vec<_>>()
        .join(" ");
    let what_happened = format!(
        "git-span hit a bug while running `{command}`:\n\n{}",
        report.message
    );
    let mut next_steps = vec![
        NextStep::Prose(format!(
            "The command stopped before finishing, so treat anything it printed \
             as incomplete. Its exit status {INTERNAL_ERROR_EXIT_CODE} reports this \
             internal error, not a drift or check verdict."
        )),
        NextStep::Prose(format!(
            "This is a bug in git-span, not a problem with your repository or \
             command. Please report it at {ISSUE_TRACKER_URL} with this message \
             and a backtrace{}",
            if report.backtrace.is_some() {
                " (printed below)."
            } else {
                " from re-running the command:"
            }
        )),
    ];
    if report.backtrace.is_none() {
        next_steps.push(NextStep::Bash(format!("RUST_BACKTRACE=1 {command}")));
    }
    let mut out = render_report(&headline, &what_happened, &next_steps);
    if let Some(backtrace) = &report.backtrace {
        out.push_str("\n\nstack backtrace:\n");
        out.push_str(backtrace.trim_end());
    }
    out
}

/// The text of a panic payload: the `&str` or `String` that `panic!` and
/// friends carry, or a placeholder for a non-text payload.
fn panic_payload_text(payload: &(dyn std::any::Any + Send)) -> &str {
    if let Some(text) = payload.downcast_ref::<&'static str>() {
        text
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text
    } else {
        "(non-text panic payload)"
    }
}

/// Replace Rust's default panic report with [`render_internal_error`] on
/// stderr. Install it first thing in `main`.
///
/// The hook only reports; it does not exit. Exiting from the hook would
/// skip unwinding, and the destructors that unwinding runs are what release
/// lockfiles and remove temporaries a panicking command was holding. `main`
/// instead catches the unwind and exits with [`INTERNAL_ERROR_EXIT_CODE`].
/// A panic on a rayon worker reaches that catch too: rayon re-raises it on
/// the calling thread with `resume_unwind`, which does not re-run the hook,
/// so the report is printed once. The one exception is a `panic = "abort"`
/// build, where no unwind follows: there the hook exits itself so the
/// status is still the documented one rather than `SIGABRT`.
///
/// Every step tolerates failure — a closed stderr is ignored rather than
/// unwrapped — because a panic inside a panic hook aborts the process.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let argv = std::env::args_os()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let backtrace = std::backtrace::Backtrace::capture();
        let report = PanicReport {
            location: info.location().map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            }),
            message: panic_payload_text(info.payload()),
            argv: &argv,
            backtrace: (backtrace.status() == std::backtrace::BacktraceStatus::Captured)
                .then(|| backtrace.to_string()),
        };
        let rendered = render_internal_error(&report);
        {
            use std::io::Write;
            let _ = writeln!(std::io::stderr().lock(), "{rendered}");
        }
        if cfg!(panic = "abort") {
            std::process::exit(INTERNAL_ERROR_EXIT_CODE);
        }
    }));
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

    #[test]
    fn internal_error_report_without_backtrace_offers_the_rerun() {
        let argv = [
            "/usr/local/bin/git-span".to_owned(),
            "drift".to_owned(),
            "--fix".to_owned(),
            "a b".to_owned(),
        ];
        let rendered = render_internal_error(&PanicReport {
            location: Some("src/resolver/walk.rs:12:5".to_owned()),
            message: "attempt to subtract with overflow",
            argv: &argv,
            backtrace: None,
        });
        let expected = "\
git span: internal error: panicked at src/resolver/walk.rs:12:5.

git-span hit a bug while running `git span drift --fix 'a b'`:

attempt to subtract with overflow

## What to do next

The command stopped before finishing, so treat anything it printed as incomplete. Its exit status 1 reports this internal error, not a drift or check verdict.

This is a bug in git-span, not a problem with your repository or command. Please report it at https://github.com/goodfoot-io/git-span/issues with this message and a backtrace from re-running the command:

```bash
RUST_BACKTRACE=1 git span drift --fix 'a b'
```";
        assert_eq!(rendered, expected);
    }

    #[test]
    fn internal_error_report_with_backtrace_appends_it() {
        let argv = ["git-span".to_owned(), "list".to_owned()];
        let rendered = render_internal_error(&PanicReport {
            location: None,
            message: "boom",
            argv: &argv,
            backtrace: Some("   0: frame\n".to_owned()),
        });
        assert!(rendered.starts_with("git span: internal error: panicked.\n\n"));
        assert!(rendered.contains("with this message and a backtrace (printed below)."));
        assert!(!rendered.contains("RUST_BACKTRACE=1"));
        assert!(rendered.ends_with("\n\nstack backtrace:\n   0: frame"));
    }

    #[test]
    fn panic_payload_text_reads_str_and_string_payloads() {
        let literal: Box<dyn std::any::Any + Send> = Box::new("literal");
        let formatted: Box<dyn std::any::Any + Send> = Box::new(String::from("formatted"));
        let opaque: Box<dyn std::any::Any + Send> = Box::new(7_u8);
        assert_eq!(panic_payload_text(&*literal), "literal");
        assert_eq!(panic_payload_text(&*formatted), "formatted");
        assert_eq!(panic_payload_text(&*opaque), "(non-text panic payload)");
    }

    /// `main` maps panics to [`INTERNAL_ERROR_EXIT_CODE`] with one
    /// `catch_unwind` on the main thread. That covers parallel work only
    /// because rayon re-raises a worker's panic on the thread that called
    /// into the pool; pin that so a pool change cannot silently reopen the
    /// `101` exit. (The worker's panic report goes to stderr uncaptured.)
    #[test]
    fn rayon_worker_panic_unwinds_to_the_calling_thread() {
        use rayon::prelude::*;
        let caught = std::panic::catch_unwind(|| {
            (0..64_u32).into_par_iter().for_each(|index| {
                if index == 63 {
                    panic!("injected rayon worker panic");
                }
            });
        });
        let payload = caught.expect_err("a worker panic must reach the caller");
        assert_eq!(panic_payload_text(&*payload), "injected rayon worker panic");
    }

    /// Set only in the child process `installed_panic_hook_renders_the_report`
    /// spawns; never read outside this test module.
    const PANIC_HOOK_CHILD_ENV: &str = "GIT_SPAN_TEST_PANIC_HOOK_CHILD";

    /// Exercise the real hook end to end by re-running this test binary on
    /// just this test with the child flag set: the child installs the hook
    /// and panics, and the parent reads the report off its stderr. A child
    /// process keeps the process-global hook out of every other test.
    #[test]
    fn installed_panic_hook_renders_the_report() {
        if std::env::var_os(PANIC_HOOK_CHILD_ENV).is_some() {
            install_panic_hook();
            panic!("injected panic for the hook test");
        }
        let output = std::process::Command::new(
            std::env::current_exe().expect("locate the running test binary"),
        )
        .args([
            "--exact",
            "cli::error::tests::installed_panic_hook_renders_the_report",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(PANIC_HOOK_CHILD_ENV, "1")
        .env_remove("RUST_BACKTRACE")
        .env_remove("RUST_LIB_BACKTRACE")
        .output()
        .expect("run the panicking child");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !output.status.success(),
            "child must fail; stderr:\n{stderr}"
        );
        assert!(
            stderr.contains("git span: internal error: panicked at src/cli/error.rs:"),
            "structured headline missing; stderr:\n{stderr}"
        );
        assert!(
            stderr.contains("\n\ninjected panic for the hook test\n\n## What to do next\n"),
            "panic message missing; stderr:\n{stderr}"
        );
        assert!(
            !stderr.contains("' panicked at "),
            "Rust's default `thread '…' panicked at` report must be replaced; \
             stderr:\n{stderr}"
        );
    }
}
