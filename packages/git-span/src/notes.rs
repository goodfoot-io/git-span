//! Durable JSON documents attached to frozen commit identities, independent of resolver caches.

mod json;

use anyhow::{Context, bail, ensure};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Maximum accepted UTF-8 input size for either source.
pub const MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
/// Largest repository-wide ID representable exactly by JavaScript clients.
pub const MAX_NOTE_ID: u64 = 9_007_199_254_740_991;

/// A positive, safe-integer repository-wide note identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(transparent)]
pub struct NoteId(#[schemars(range(min = 1, max = 9007199254740991_u64))] pub u64);

/// A stored association and its parsed arbitrary JSON document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct Note {
    pub id: NoteId,
    pub commit_sha: String,
    #[schemars(schema_with = "crate::schemas::any_schema")]
    pub document: serde_json::Value,
}

/// The nested command which produced an envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Add,
    List,
    Show,
    Remove,
}

/// Versioned machine output; list can successfully contain no notes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct NotesDocument {
    #[schemars(range(min = 1, max = 1))]
    pub schema_version: u32,
    pub operation: Operation,
    pub notes: Vec<Note>,
}

/// Validated document and complete identity bytes; parsed numeric representation is significant.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedDocument {
    pub document: serde_json::Value,
    pub canonical_document: String,
}

/// Validate one positional or nonterminal stdin source before any store is opened.
pub fn parse_input(
    positional: Option<&str>,
    stdin: &mut dyn std::io::Read,
    stdin_is_terminal: bool,
) -> anyhow::Result<ParsedDocument> {
    if let Some(text) = positional {
        ensure!(
            text.len() <= MAX_DOCUMENT_BYTES,
            "notes JSON input exceeds the 16 MiB limit"
        );
    } else {
        ensure!(
            !stdin_is_terminal,
            "provide a JSON argument or pipe one JSON value through nonterminal stdin"
        );
    }
    let mut bytes = Vec::new();
    if !stdin_is_terminal {
        stdin
            .take(MAX_DOCUMENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .context("read notes JSON from stdin")?;
        ensure!(
            bytes.len() <= MAX_DOCUMENT_BYTES,
            "notes stdin exceeds the 16 MiB limit"
        );
    }
    ensure!(
        positional.is_none() || bytes.is_empty(),
        "provide JSON either as an argument or through stdin, not both"
    );
    let text = match positional {
        Some(text) => text,
        None => std::str::from_utf8(&bytes).context("notes stdin must contain UTF-8 JSON")?,
    };
    ensure!(
        !text.trim().is_empty(),
        "notes JSON input is empty; provide one valid JSON value"
    );
    let document: serde_json::Value = json::decode(text)
        .context("invalid notes JSON; provide one complete JSON value within the nesting limit")?;
    let canonical_document = canonicalize(&document)?;
    Ok(ParsedDocument {
        document,
        canonical_document,
    })
}

/// Sort object keys recursively without changing array order or numeric representation.
pub fn canonicalize(document: &serde_json::Value) -> anyhow::Result<String> {
    fn sorted(value: &serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(object) => {
                let mut keys: Vec<_> = object.keys().collect();
                keys.sort_unstable();
                serde_json::Value::Object(
                    keys.into_iter()
                        .map(|key| (key.clone(), sorted(&object[key])))
                        .collect(),
                )
            }
            serde_json::Value::Array(array) => {
                serde_json::Value::Array(array.iter().map(sorted).collect())
            }
            scalar => scalar.clone(),
        }
    }
    serde_json::to_string(&sorted(document)).context("encode notes JSON identity")
}

/// Validate a CLI or stored ID against the positive safe-integer contract.
pub fn parse_id(text: &str) -> anyhow::Result<NoteId> {
    ensure!(
        !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()),
        "invalid note ID `{text}`; expected an integer from 1 through {MAX_NOTE_ID}"
    );
    let id = text.parse::<u64>().with_context(|| {
        format!("invalid note ID `{text}`; expected an integer from 1 through {MAX_NOTE_ID}")
    })?;
    ensure!(
        (1..=MAX_NOTE_ID).contains(&id),
        "invalid note ID `{text}`; expected an integer from 1 through {MAX_NOTE_ID}"
    );
    Ok(NoteId(id))
}

/// Native-Git selection frozen before storage reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    All,
    Commits(Vec<String>),
}

/// Peel and validate a single commit expression, rejecting ambiguous names.
pub fn resolve_commit(repo: &gix::Repository, revision: &str) -> anyhow::Result<String> {
    ensure!(
        !revision.is_empty() && !revision.starts_with('-'),
        "invalid commit expression `{revision}`; provide a commit revision, not an option"
    );
    let expression = format!("{revision}^{{commit}}");
    let sha = native_git(
        repo,
        &["rev-parse", "--verify", "--end-of-options", &expression],
    )
    .with_context(|| {
        format!("resolve notes commit `{revision}`; use an unambiguous commit revision")
    })?;
    let sha = sha.trim();
    validate_sha(sha)?;
    Ok(sha.to_string())
}

/// Freeze single-tip, exact, or two-/three-dot range selection through native Git.
pub fn select_commits(
    repo: &gix::Repository,
    revision: Option<&str>,
    exact: bool,
) -> anyhow::Result<Selection> {
    let Some(revision) = revision else {
        ensure!(!exact, "notes list --exact requires one commit revision");
        return Ok(Selection::All);
    };
    let range = revision
        .split_once("...")
        .map(|(left, right)| (left, right, "..."))
        .or_else(|| {
            revision
                .split_once("..")
                .map(|(left, right)| (left, right, ".."))
        });
    let frozen = if let Some((left, right, separator)) = range {
        ensure!(!exact, "notes list --exact does not accept revision ranges");
        let left = resolve_commit(repo, if left.is_empty() { "HEAD" } else { left })?;
        let right = resolve_commit(repo, if right.is_empty() { "HEAD" } else { right })?;
        format!("{left}{separator}{right}")
    } else {
        let sha = resolve_commit(repo, revision)?;
        if exact {
            return Ok(Selection::Commits(vec![sha]));
        }
        sha
    };
    let output = native_git(repo, &["rev-list", &frozen, "--"])
        .with_context(|| format!("select notes commits for `{revision}`"))?;
    let commits: Vec<String> = output.lines().map(str::to_string).collect();
    for sha in &commits {
        validate_sha(sha)?;
    }
    Ok(Selection::Commits(commits))
}

/// Native Git is authoritative for ambiguity, peeling, replacement, shallow, and range semantics.
fn native_git(repo: &gix::Repository, args: &[&str]) -> anyhow::Result<String> {
    let directory = std::fs::canonicalize(repo.git_dir())
        .context("locate discovered Git directory for notes")?;
    let output = std::process::Command::new("git")
        .arg("--git-dir")
        .arg(directory)
        .args(["-c", "core.warnAmbiguousRefs=true"])
        .args(args)
        .env("LC_ALL", "C")
        .output()
        .context("run native Git for notes selection")?;
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    ensure!(
        output.status.success() && !diagnostic.contains(" is ambiguous"),
        "native Git refused notes selection: {}",
        diagnostic.trim()
    );
    String::from_utf8(output.stdout).context("native Git returned non-UTF-8 commit identities")
}

/// Repository-wide durable storage; reads never create an absent database.
#[derive(Debug, Clone)]
pub struct Store {
    pub path: PathBuf,
}

impl Store {
    /// Locate the notes database in the shared Git common directory.
    pub fn for_repo(repo: &gix::Repository) -> Self {
        Self::at(&crate::git::common_dir(repo).join("span/notes.db"))
    }
    /// Bind a store to a known database path, allowing real-storage contract tests.
    pub fn at(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
        }
    }

    /// Allocate atomically or return the still-present identical association.
    pub fn add(&self, commit_sha: &str, document: &ParsedDocument) -> anyhow::Result<Note> {
        validate_sha(commit_sha)?;
        ensure!(
            canonicalize(&document.document)? == document.canonical_document,
            "notes document does not match its canonical identity"
        );
        self.add_inner(commit_sha, document)
            .with_context(|| format!("add note in durable storage `{}`", self.path.display()))
    }

    fn add_inner(&self, commit_sha: &str, document: &ParsedDocument) -> anyhow::Result<Note> {
        let mut connection = self.open_writer()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        validate_schema(&transaction, true)?;
        let existing: Option<(u64, String, String, String)> = transaction.query_row(
            "SELECT id, commit_sha, document, canonical_document FROM notes WHERE commit_sha = ?1 AND canonical_document = ?2",
            (commit_sha, &document.canonical_document), raw_note).optional()?;
        if let Some(existing) = existing {
            let note = decode_note(existing)?;
            transaction.commit()?;
            return Ok(note);
        }
        let sequence = sequence_value(&transaction)?;
        ensure!(
            sequence < MAX_NOTE_ID,
            "notes IDs exhausted at {MAX_NOTE_ID}; no record was inserted"
        );
        transaction.execute(
            "INSERT INTO notes (commit_sha, document, canonical_document) VALUES (?1, ?2, ?3)",
            (
                commit_sha,
                serde_json::to_string(&document.document)?,
                &document.canonical_document,
            ),
        )?;
        let id = transaction.last_insert_rowid();
        ensure!(
            id > 0 && id as u64 <= MAX_NOTE_ID,
            "allocated note ID is outside the positive safe-integer range"
        );
        let note = Note {
            id: NoteId(id as u64),
            commit_sha: commit_sha.into(),
            document: document.document.clone(),
        };
        transaction.commit()?;
        Ok(note)
    }

    /// Read a coherent ascending-ID snapshot for a frozen selection.
    pub fn list(&self, selection: &Selection) -> anyhow::Result<Vec<Note>> {
        self.list_inner(selection)
            .with_context(|| format!("list notes in durable storage `{}`", self.path.display()))
    }

    fn list_inner(&self, selection: &Selection) -> anyhow::Result<Vec<Note>> {
        let Some(mut connection) = self.open_reader()? else {
            return Ok(Vec::new());
        };
        let transaction = connection.transaction()?;
        validate_schema(&transaction, false)?;
        let notes = {
            let mut statement = transaction.prepare(
                "SELECT id, commit_sha, document, canonical_document FROM notes ORDER BY id",
            )?;
            let mut notes = Vec::new();
            for row in statement.query_map([], raw_note)? {
                let note = decode_note(row?)?;
                if match selection {
                    Selection::All => true,
                    Selection::Commits(commits) => commits.contains(&note.commit_sha),
                } {
                    notes.push(note);
                }
            }
            notes
        };
        transaction.commit()?;
        Ok(notes)
    }

    /// Read exactly one record; missing identifiers are errors.
    pub fn show(&self, id: NoteId) -> anyhow::Result<Note> {
        self.show_inner(id).with_context(|| {
            format!(
                "show note {} in durable storage `{}`",
                id.0,
                self.path.display()
            )
        })
    }

    fn show_inner(&self, id: NoteId) -> anyhow::Result<Note> {
        parse_id(&id.0.to_string())?;
        let Some(mut connection) = self.open_reader()? else {
            bail!("note {} does not exist", id.0);
        };
        let transaction = connection.transaction()?;
        validate_schema(&transaction, false)?;
        let note = lookup(&transaction, id)?;
        transaction.commit()?;
        Ok(note)
    }

    /// Delete only the requested ID and commit before returning its record.
    pub fn remove(&self, id: NoteId) -> anyhow::Result<Note> {
        self.remove_inner(id).with_context(|| {
            format!(
                "remove note {} in durable storage `{}`",
                id.0,
                self.path.display()
            )
        })
    }

    fn remove_inner(&self, id: NoteId) -> anyhow::Result<Note> {
        parse_id(&id.0.to_string())?;
        ensure!(self.path.try_exists()?, "note {} does not exist", id.0);
        let mut connection = self.open_existing_writer()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        validate_schema(&transaction, false)?;
        let note = lookup(&transaction, id)?;
        ensure!(
            transaction.execute("DELETE FROM notes WHERE id = ?1", [id.0])? == 1,
            "note {} was not removed",
            id.0
        );
        transaction.commit()?;
        Ok(note)
    }

    fn open_reader(&self) -> anyhow::Result<Option<Connection>> {
        if !self.path.try_exists()? {
            return Ok(None);
        }
        let connection = Connection::open_with_flags(&self.path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.busy_timeout(Duration::from_secs(30))?;
        Ok(Some(connection))
    }

    fn open_writer(&self) -> anyhow::Result<Connection> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }
        self.writer(OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)
    }

    fn open_existing_writer(&self) -> anyhow::Result<Connection> {
        self.writer(OpenFlags::SQLITE_OPEN_READ_WRITE)
    }

    fn writer(&self, flags: OpenFlags) -> anyhow::Result<Connection> {
        let connection = Connection::open_with_flags(&self.path, flags)?;
        connection.busy_timeout(Duration::from_secs(30))?;
        // SQLite's rollback journal is durable; never switch or repair an existing store.
        connection.pragma_update(None, "synchronous", "FULL")?;
        let journal: String =
            connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
        ensure!(
            journal == "delete",
            "unsupported notes journal mode `{journal}`; preserve and inspect the database"
        );
        Ok(connection)
    }
}

const APPLICATION_ID: u32 = 0x47534e54;
const TABLE_SQL: &str = "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991), commit_sha TEXT NOT NULL, document TEXT NOT NULL, canonical_document TEXT NOT NULL, UNIQUE (commit_sha, canonical_document))";

/// Initialize only genuinely empty storage; existing incompatible state is never repaired.
fn validate_schema(connection: &Connection, initialize: bool) -> anyhow::Result<()> {
    let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let application: u32 =
        connection.pragma_query_value(None, "application_id", |row| row.get(0))?;
    let tables: Vec<(String, String)> = {
        let mut statement = connection
            .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' ORDER BY name")?;
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    if version == 0 && application == 0 && tables.is_empty() && initialize {
        let objects: u32 =
            connection.query_row("SELECT COUNT(*) FROM sqlite_schema", [], |row| row.get(0))?;
        ensure!(
            objects == 0,
            "notes database contains foreign schema objects; leaving it intact"
        );
        connection.execute_batch(TABLE_SQL)?;
        // Seed the empty allocation marker so deleting sqlite_sequence after consuming
        // every note cannot masquerade as a pristine store and reuse removed IDs.
        connection.execute(
            "INSERT INTO sqlite_sequence (name, seq) VALUES ('notes', 0)",
            [],
        )?;
        connection.pragma_update(None, "application_id", APPLICATION_ID)?;
        connection.pragma_update(None, "user_version", 1)?;
    } else {
        ensure!(
            version == 1 && application == APPLICATION_ID,
            "incompatible or foreign notes schema (version {version}); leaving it intact"
        );
        ensure!(
            tables.len() == 2
                && tables[0] == ("notes".into(), TABLE_SQL.into())
                && tables[1].0 == "sqlite_sequence",
            "malformed or foreign notes tables; leaving them intact"
        );
        let index: Option<String> = connection.query_row("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'notes' AND sql IS NULL", [], |row| row.get(0)).optional()?;
        ensure!(
            index.as_deref() == Some("sqlite_autoindex_notes_1"),
            "notes uniqueness constraint is missing"
        );
        let objects: Vec<(String, String)> = {
            let mut statement =
                connection.prepare("SELECT type, name FROM sqlite_schema ORDER BY name")?;
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?
        };
        ensure!(
            objects
                == [
                    ("table".into(), "notes".into()),
                    ("index".into(), "sqlite_autoindex_notes_1".into()),
                    ("table".into(), "sqlite_sequence".into()),
                ],
            "foreign notes schema objects (trigger, view, or index); leaving storage intact"
        );
    }
    let sequence = sequence_value(connection)?;
    let highest: u64 =
        connection.query_row("SELECT COALESCE(MAX(id), 0) FROM notes", [], |row| {
            row.get(0)
        })?;
    ensure!(
        highest <= sequence && sequence <= MAX_NOTE_ID,
        "malformed notes allocation sequence; leaving it intact"
    );
    Ok(())
}

fn sequence_value(connection: &Connection) -> anyhow::Result<u64> {
    let entries: Vec<(String, u64)> = {
        let mut statement = connection.prepare("SELECT name, seq FROM sqlite_sequence")?;
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    ensure!(
        entries.len() == 1 && entries.iter().all(|(name, _)| name == "notes"),
        "malformed notes allocation sequence; leaving it intact"
    );
    Ok(entries[0].1)
}

fn validate_sha(sha: &str) -> anyhow::Result<()> {
    ensure!(
        (sha.len() == 40 || sha.len() == 64)
            && sha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "invalid full commit SHA `{sha}`"
    );
    Ok(())
}

fn raw_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<(u64, String, String, String)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

fn decode_note(
    (id, commit_sha, document, canonical): (u64, String, String, String),
) -> anyhow::Result<Note> {
    let id = parse_id(&id.to_string())?;
    validate_sha(&commit_sha)?;
    // The source limit is checked before parsing input. Normalized exponent signs can
    // enlarge persisted JSON, so its parsed representation must not inherit that limit.
    let document: serde_json::Value =
        json::decode(&document).context("malformed stored notes document")?;
    ensure!(
        canonicalize(&document)? == canonical,
        "stored note {} has a mismatched canonical identity",
        id.0
    );
    Ok(Note {
        id,
        commit_sha,
        document,
    })
}

fn lookup(connection: &Connection, id: NoteId) -> anyhow::Result<Note> {
    let raw = connection
        .query_row(
            "SELECT id, commit_sha, document, canonical_document FROM notes WHERE id = ?1",
            [id.0],
            raw_note,
        )
        .optional()?;
    decode_note(raw.with_context(|| format!("note {} does not exist", id.0))?)
}
