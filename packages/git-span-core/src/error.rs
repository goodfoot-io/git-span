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
    #[error("reserved span name: {0}")]
    ReservedName(String),

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
