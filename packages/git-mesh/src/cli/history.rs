//! `git mesh history <mesh>` — chronological timeline of a mesh file's git
//! history, rendered as XML (default) or JSON.
//!
//! # Output contract
//!
//! See `docs/history-example-output-xml.md` (canonical XML) and
//! `docs/history-example-output.md` (markdown variant) for concrete example
//! output that the integration tests assert against.

use crate::cli::HistoryArgs;
use anyhow::Result;
use serde_json::Value;

// ---------------------------------------------------------------------------
// Internal data model (drives both renderers — XML and JSON cannot diverge)
// ---------------------------------------------------------------------------

/// The full computed history of one mesh, ready to render in any format.
#[allow(dead_code)]
pub struct HistoryReport {
    /// Mesh name as passed to the command.
    pub mesh: String,
    /// `true` when the git-log walk completed without hitting the time budget.
    /// `false` indicates a truncated timeline — the command exits non-zero.
    pub walk_complete: bool,
    /// Commit sections, ordered oldest → newest. No-op commits (nothing
    /// observable changed) are already dropped before this point.
    pub commits: Vec<CommitSection>,
    /// Optional current-drift section (omitted when the working tree matches
    /// HEAD exactly).
    pub current: Option<CurrentSection>,
}

/// One commit in the history where the mesh changed observably.
#[allow(dead_code)]
pub struct CommitSection {
    /// Full 40-hex OID of the commit.
    pub hash: String,
    /// Author date in `YYYY-MM-DD` form (truncated from RFC2822).
    pub date: String,
    /// First line of the commit message.
    pub summary: String,
    /// New `--why` prose, present only when it changed at this commit.
    pub why: Option<String>,
    /// Anchors that were added, modified, or removed at this commit.
    pub anchors: Vec<TimelineAnchor>,
}

/// One anchor's change record within a commit section.
#[allow(dead_code)]
pub struct TimelineAnchor {
    /// Combined git-mesh address string (`path#L<start>-L<end>` or bare path
    /// for whole-file anchors), produced by `format_anchor_address`.
    pub address: String,
    /// How the anchor changed at this commit.
    pub event: Event,
    /// Body text, absent for `Removed` anchors.
    pub content: Option<AnchorBody>,
}

/// How an anchor changed relative to the previous rendered state.
#[allow(dead_code)]
pub enum Event {
    /// Anchor was not present before this commit (includes first-appearance).
    Added,
    /// Anchor was present before but its source content changed.
    Modified,
    /// Anchor was removed at this commit (no body rendered).
    Removed,
}

/// The optional current-drift section, describing how the working tree differs
/// from HEAD. Uses the same drift labels as `git mesh stale`.
#[allow(dead_code)]
pub struct CurrentSection {
    /// Uncommitted why change, present only when it differs from HEAD.
    pub why: Option<String>,
    /// Anchors whose working-tree content differs from HEAD.
    pub anchors: Vec<CurrentAnchor>,
}

/// One anchor's drift record in the current section.
#[allow(dead_code)]
pub struct CurrentAnchor {
    /// Combined git-mesh address string.
    pub address: String,
    /// Verbatim drift phrase from `format_drift_label` (e.g. `"changed in the
    /// working tree"`).
    pub status: String,
    /// Live content of the anchor, absent when the anchor itself was deleted.
    pub content: Option<AnchorBody>,
}

/// Content of an anchor at a specific point in time.
#[allow(dead_code)]
pub enum AnchorBody {
    /// Normal source text extracted from the blob.
    Text(String),
    /// Degradation note substituted when the real content is unavailable
    /// (e.g. `"(file absent at this commit)"`, `"(line range past end of
    /// file)"`, `"(binary or non-UTF-8 content)"`).
    Note(String),
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run `git mesh history <mesh>`.
///
/// Builds a [`HistoryReport`] by walking the mesh file's git history, then
/// renders it via `render_xml` or `render_json` according to `args.format`.
/// Returns exit code `0` on success, `1` on an incomplete walk or hard error.
///
/// Error/not-found mapping follows the same conventions as `run_show` in
/// `show.rs`.
pub fn run_history(
    _repo: &gix::Repository,
    _args: HistoryArgs,
    _mesh_root: &str,
) -> Result<i32> {
    todo!("Phase 3: implement history walk, diff, and render")
}

// ---------------------------------------------------------------------------
// Renderers (pure functions of HistoryReport)
// ---------------------------------------------------------------------------

/// Render a `HistoryReport` as an XML string.
///
/// Format rules (from the plan's "Output shapes" section):
/// - Un-indented tags, no wrapping container element.
/// - `<commit hash="…" date="…" summary="…">` per commit section.
/// - `<why>` only when the why prose changed, wrapped in CDATA.
/// - `<anchor path="…" event="…">CDATA body</anchor>` for added/modified;
///   self-closing `<anchor path="…" event="removed"/>` for removed.
/// - Optional `<current>` block with `<anchor path="…" status="…">` entries.
/// - Anchor body CDATA: literal `]]>` inside content is split as
///   `]]]]><![CDATA[>` to prevent premature CDATA termination.
/// - Attribute values (`hash`, `date`, `summary`, `path`, `event`, `status`)
///   are XML-attribute-escaped (`&` → `&amp;`, `<` → `&lt;`, `"` → `&quot;`).
#[allow(dead_code)]
pub fn render_xml(_report: &HistoryReport) -> String {
    todo!("Phase 3: implement XML renderer")
}

/// Render a `HistoryReport` as a `serde_json::Value`.
///
/// Top-level shape:
/// ```json
/// {
///   "schema_version": 1,
///   "mesh": "<name>",
///   "commits": [ … ],
///   "current": { … }   // omitted when no drift
/// }
/// ```
///
/// Each commit: `{ "hash", "date", "summary", "why"?, "anchors": [ … ] }`.
/// Each timeline anchor: `{ "path": "<combined-address>", "event": "added"|"modified"|"removed", "content"? }`.
/// Each current anchor: `{ "path": "<combined-address>", "status": "<drift-phrase>", "content"? }`.
/// `"why"` and `"content"` keys are omitted when absent (not null).
#[allow(dead_code)]
pub fn render_json(_report: &HistoryReport) -> Value {
    todo!("Phase 3: implement JSON renderer")
}
