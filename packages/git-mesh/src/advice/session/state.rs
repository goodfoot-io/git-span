//! Serde structs for the per-session JSONL streams and per-`<id>` snapshots.
//!
//! Each `mark`/`flush` pair is identified by an opaque `id` chosen by the
//! caller — the hook scripts pass `tool_use_id` as `id`, but the CLI does not
//! know what the value means. Schema fields are deliberately generic.

use serde::{Deserialize, Serialize};

/// One entry in `reads.jsonl`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadRecord {
    /// Repo-relative path.
    pub path: String,
    /// Inclusive 1-based start line, if a line-range anchor was supplied.
    pub start_line: Option<u32>,
    /// Inclusive 1-based end line, if a line-range anchor was supplied.
    pub end_line: Option<u32>,
    /// RFC-3339 timestamp of the read event.
    pub ts: String,
    /// Opaque caller-chosen id (the hook layer passes the originating
    /// `tool_use_id`). Optional — direct CLI invocations may omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// Kind of working-tree change attributed to a single tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TouchKind {
    Modified,
    Added,
    Deleted,
    ModeChange,
}

fn default_touch_kind() -> TouchKind {
    TouchKind::Modified
}

/// One entry in `touches.jsonl`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TouchInterval {
    /// Repo-relative path.
    pub path: String,
    /// Diff classification produced by `flush`.
    #[serde(default = "default_touch_kind")]
    pub kind: TouchKind,
    /// Opaque caller-chosen id that bracketed the change (the hook layer
    /// passes the originating `tool_use_id`).
    #[serde(default)]
    pub id: String,
    /// RFC-3339 timestamp.
    pub ts: String,
    /// Inclusive 1-based start line of the edited hunk, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<u32>,
    /// Inclusive 1-based end line of the edited hunk, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<u32>,
}


/// Provenance information for a working-tree change, carrying the raw
/// detection data that was previously discarded.
///
/// In-memory only — NOT persisted to JSONL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TouchProvenance {
    /// Change detected via `git diff-files` (tracked/indexed file).
    Tracked {
        /// Raw status character from `diff-files` (`M`, `A`, `D`, `T`).
        status: char,
        /// Source mode string (e.g. `100644`).
        src_mode: String,
        /// Destination mode string (e.g. `100755`).
        dst_mode: String,
    },
    /// Change detected by comparing untracked-file metadata against snapshot.
    Untracked {
        /// Per-field changes that were detected.
        changes: Vec<UntrackedFieldChange>,
    },
    /// Touch recorded via explicit payload (Edit/Write/MultiEdit), bypassing
    /// the snapshot diff path entirely.
    Payload {
        /// Anchor spec from the caller (e.g. `file.rs#L10-L20` or `file.rs`).
        anchor: String,
    },
}

/// One field that differed between a saved untracked snapshot entry and the
/// current working-tree metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UntrackedFieldChange {
    pub field: String,
    pub before: String,
    pub after: String,
}

/// One entry in `<session>/snapshots/<id>.untracked` — captured at `mark`,
/// consumed at `flush` to detect untracked-side changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UntrackedSnapshotEntry {
    pub path: String,
    pub size: u64,
    pub mode: u32,
    pub mtime_ns: i128,
    pub ctime_ns: i128,
    pub ino: u64,
}
