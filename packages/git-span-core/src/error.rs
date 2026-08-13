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
    ///
    /// The kernel only ever detects one of the two conditions — marker text —
    /// but it names which one, because the caller cannot recover the
    /// distinction afterwards and every surface that tried to give advice
    /// without it had to give generic advice. See [`ConflictKind`].
    #[error("span file is in a Git conflict state: {0}")]
    SpanConflict(ConflictKind),
}

/// **Which** condition put a span file into a conflict state.
///
/// The two are detected in different places and cleared by different actions,
/// and collapsing them is why "resolve the merge" was the best any surface
/// could say. `git span resolve` settles the *text*; only staging clears an
/// unmerged *index* entry, so a surface that knows it is looking at
/// [`Self::UnmergedIndex`] can say the second half out loud.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// Git left stage 1/2/3 entries for the span path in the index. The merge
    /// is unresolved at the index level, so settling the worktree text is only
    /// half the exit — the file still has to be staged.
    UnmergedIndex,
    /// The file's text carries `<<<<<<<` / `=======` / `>>>>>>>` while the
    /// index holds a single merged entry: residue committed or left behind
    /// after the index was already settled.
    MarkerText,
}

impl std::fmt::Display for ConflictKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnmergedIndex => f.write_str("unmerged index entry"),
            Self::MarkerText => f.write_str("conflict markers in the file text"),
        }
    }
}

/// `Result` specialized to the kernel's [`Error`].
pub type Result<T> = std::result::Result<T, Error>;
