//! Nested durable JSON notes command contracts.

use clap::{Args, Subcommand, ValueEnum};

/// Human prose or the versioned notes envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum NotesFormat {
    Human,
    Json,
}

/// Durable documents attached to commits, shared across linked worktrees.
#[derive(Debug, Clone, Args)]
pub struct NotesArgs {
    #[command(subcommand)]
    pub command: NotesCommands,
}

/// Operations on repository-wide note identifiers.
#[derive(Debug, Clone, Subcommand)]
pub enum NotesCommands {
    /// Attach one JSON value to a commit, returning its sequential ID. Retry identical documents to receive the existing ID.
    Add(NotesAddArgs),
    /// List notes by ascending ID, optionally selecting reachable commits or an explicit Git range.
    List(NotesListArgs),
    /// Show one durable document and its full commit association.
    Show(NotesIdArgs),
    /// Remove only the named record, returning the document removed.
    Remove(NotesIdArgs),
}

/// Add accepts one positional JSON value or nonterminal stdin, bounded to 16 MiB.
#[derive(Debug, Clone, Args)]
pub struct NotesAddArgs {
    /// Commit expression; annotated tags are peeled and ambiguous names rejected.
    pub git_ref: String,
    /// Arbitrary JSON value. Omit to read nonterminal stdin; conflicting sources fail.
    pub json: Option<String>,
    /// Output format; JSON emits the schema-version 1 notes envelope.
    #[arg(long, value_enum, default_value = "human")]
    pub format: NotesFormat,
}

/// Git selection for a coherent read snapshot.
#[derive(Debug, Clone, Args)]
pub struct NotesListArgs {
    /// Reachable tip or explicit two-/three-dot range. Omit to list all records.
    pub git_ref: Option<String>,
    /// Select only the resolved commit; requires a single revision rather than a range.
    #[arg(long, requires = "git_ref")]
    pub exact: bool,
    /// Output format; an empty JSON list contains an empty notes array.
    #[arg(long, value_enum, default_value = "human")]
    pub format: NotesFormat,
}

/// Lookup/removal target; IDs must be positive JavaScript-safe integers.
#[derive(Debug, Clone, Args)]
pub struct NotesIdArgs {
    pub note_id: String,
    /// Output format; JSON returns the complete record in a versioned envelope.
    #[arg(long, value_enum, default_value = "human")]
    pub format: NotesFormat,
}

impl NotesCommands {
    /// Effective format for every nested leaf, including update-check suppression.
    pub fn format(&self) -> NotesFormat {
        match self {
            Self::Add(args) => args.format,
            Self::List(args) => args.format,
            Self::Show(args) | Self::Remove(args) => args.format,
        }
    }
}

/// Dispatch without span-root resolution or resolver recovery locking.
pub fn run(_repo: &gix::Repository, _args: NotesArgs) -> anyhow::Result<i32> {
    todo!("notes CLI dispatch")
}
