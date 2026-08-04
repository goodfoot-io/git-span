//! The kernel's error type.
//!
//! `git-span-core` owns a small, matchable error enum covering exactly the
//! failure modes of its pure parse/validate surface. git-span maps each
//! variant 1:1 into its own larger `Error` (via `From`), so the messages
//! and matchable shape downstream consumers see are unchanged. The
//! `#[error(...)]` strings are deliberately identical to git-span's
//! corresponding variants so `Display` output is byte-for-byte stable.

/// Errors produced by the pure validate/parse functions in this crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Span name is on the reserved list (collides with a subcommand).
    ///
    /// The message names the escape hatch as well as the rule: the reserved
    /// list grows between releases, so a span may already carry a name that
    /// only became reserved later. Such a span is readable and deletable but
    /// not editable, and nothing else in the CLI would tell the user how to
    /// get out.
    #[error(
        "reserved span name: {0} — `{0}` is a git-span subcommand or reserved token, so it \
         cannot be used as a span name. A span already named `{0}` predates the reservation: \
         it is still readable, and `git span delete {0}` still removes it. To keep its \
         contents, move `.span/{0}` to a free name first."
    )]
    ReservedName(String),

    /// Span name was a git-span subcommand in an earlier release. It is
    /// reserved rather than aliased: the old spelling never runs, but it
    /// answers with the new one instead of being mistaken for a span.
    #[error(
        "retired span name: {name} — `git span {name}` was retired; use `git span \
         {replacement}` instead. The name stays reserved, so it cannot be used as a span \
         name either."
    )]
    RetiredName { name: String, replacement: String },

    /// Span name or anchor id violates the ref-legal naming rules.
    #[error("invalid name: {0}")]
    InvalidName(String),

    /// On-disk span file (or a path destined for one) is malformed.
    #[error("invalid span file: {0}")]
    InvalidSpanFile(String),

    /// The span file carries Git textual conflict markers (an unresolved
    /// merge), so it cannot be parsed as valid span data. Fail closed.
    #[error("span `{0}` is in a Git conflict state (unresolved merge)")]
    SpanConflict(String),
}

/// `Result` specialized to the kernel's [`Error`].
pub type Result<T> = std::result::Result<T, Error>;
