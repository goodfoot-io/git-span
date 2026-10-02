//! Nested durable JSON notes command contracts.

use crate::notes::{self, NotesDocument, Operation, Store};
use clap::{Args, Subcommand, ValueEnum};
use std::io::{IsTerminal as _, Write as _};

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
    /// Attach one arbitrary JSON value to a frozen full commit SHA.
    ///
    /// Use a positional value or nonterminal stdin, up to 16 MiB with bounded nesting.
    /// Empty, invalid, conflicting, or missing terminal input fails before mutation.
    /// Identical still-present documents on the same SHA return the existing ID;
    /// object key order and decoded strings agree, arrays retain order, and parsed
    /// arbitrary-precision numeric representation is significant (1 differs from 1.0).
    /// IDs are positive JavaScript-safe integers, atomic across linked worktrees,
    /// persistent across restart, and never reused after removal.
    /// Notes remain in shared durable storage until explicitly removed; incompatible
    /// or corrupt storage is refused without repair, and locks time out after 30 seconds.
    Add(NotesAddArgs),
    /// List notes by ascending ID, optionally selecting reachable commits or a Git range.
    ///
    /// Without a revision, includes associations to unreachable commits. A single
    /// revision selects reachable history; two-dot and three-dot ranges use native
    /// Git sets, including omitted-endpoint HEAD defaults. --exact selects only one
    /// resolved commit and cannot be combined with a range. Selection freezes full
    /// SHAs before traversal. Lists are coherent snapshots; records may subsequently
    /// be removed. JSON always returns an envelope, including an empty notes array.
    List(NotesListArgs),
    /// Show one durable document and its full commit association.
    ///
    /// Missing or invalid IDs fail. JSON returns one record in the schema-version 1
    /// envelope with numeric id, full commit_sha, and parsed document.
    Show(NotesIdArgs),
    /// Remove only the named record, returning the document removed.
    ///
    /// The deletion commits before reporting success. Missing or invalid IDs fail;
    /// later records on the same commit are unaffected. JSON returns the deleted
    /// record in the schema-version 1 envelope. Storage failures emit no success.
    Remove(NotesIdArgs),
}

/// Add accepts one positional JSON value or nonterminal stdin, bounded to 16 MiB.
#[derive(Debug, Clone, Args)]
pub struct NotesAddArgs {
    /// Commit expression; annotated tags are peeled and ambiguous names rejected.
    pub git_ref: String,
    /// Arbitrary JSON value. Omit to read nonterminal stdin; conflicting sources fail.
    #[arg(allow_negative_numbers = true)]
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
    /// Repository-wide positive integer through 9007199254740991.
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
pub fn run(repo: &gix::Repository, args: NotesArgs) -> anyhow::Result<i32> {
    let format = args.command.format();
    let store = Store::for_repo(repo);
    let (operation, notes) = match args.command {
        NotesCommands::Add(args) => {
            let stdin = std::io::stdin();
            let terminal = stdin.is_terminal();
            let document = notes::parse_input(args.json.as_deref(), &mut stdin.lock(), terminal)?;
            let sha = notes::resolve_commit(repo, &args.git_ref)?;
            (Operation::Add, vec![store.add(&sha, &document)?])
        }
        NotesCommands::List(args) => {
            let selection = notes::select_commits(repo, args.git_ref.as_deref(), args.exact)?;
            (Operation::List, store.list(&selection)?)
        }
        NotesCommands::Show(args) => (
            Operation::Show,
            vec![store.show(notes::parse_id(&args.note_id)?)?],
        ),
        NotesCommands::Remove(args) => (
            Operation::Remove,
            vec![store.remove(notes::parse_id(&args.note_id)?)?],
        ),
    };
    let document = NotesDocument {
        schema_version: 1,
        operation,
        notes,
    };
    let text = match format {
        NotesFormat::Json => serde_json::to_string(&document)?,
        NotesFormat::Human => human_document(&document)?,
    };
    writeln!(std::io::stdout().lock(), "{text}")?;
    Ok(0)
}

fn human_document(document: &NotesDocument) -> anyhow::Result<String> {
    if document.notes.is_empty() {
        return Ok("No notes.".into());
    }
    let mut rows = Vec::new();
    for note in &document.notes {
        let prefix = match document.operation {
            Operation::Add => "Added note ",
            Operation::Remove => "Removed note ",
            Operation::List | Operation::Show => "Note ",
        };
        let mut row = format!("{prefix}{} {}", note.id.0, note.commit_sha);
        if document.operation == Operation::Show {
            row.push('\n');
            row.push_str(&serde_json::to_string_pretty(&note.document)?);
        }
        rows.push(row);
    }
    Ok(rows.join("\n"))
}
