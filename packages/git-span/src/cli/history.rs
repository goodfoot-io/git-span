//! `git span history <span>` — chronological timeline of a span, rendered as
//! git-log-style text (default) or JSON (`schema_version: 2`).
//!
//! # Output contract
//!
//! Both formats are newest-first. Every observable change is expressed once,
//! as a unified diff in git's dialect:
//!
//! * `span_diff` — the real git blob diff of the `.span/<name>` declaration
//!   between two states (this subsumes the old `why` field: why prose lives in
//!   the declaration).
//! * per-anchor diffs — pseudo-diffs between the anchor's *extracted
//!   snapshots*, with `path#Lstart-Lend` display paths, `index rk64:…` lines,
//!   and real-file hunk coordinates. Anchors pair across consecutive states by
//!   exact address first, then by content similarity (git's `-M` shape), so a
//!   re-anchor renders as a rename rather than remove + add.
//!
//! Declared anchor ranges are taken at face value at every commit — a stale
//! range extracting "wrong" content *is* the drift being visualized. Anchor
//! diffs are always computed between extracted snapshots, never by clipping a
//! file's real commit patch to a line range.

use crate::cli::format::format_anchor_address;
use crate::cli::unified_diff::{
    AnchorDiffKind, DEV_NULL, DiffHeader, DiffSide, NULL_ANCHOR_HASH, render_unified_diff,
    similarity,
};
use crate::cli::{CliError, HistoryArgs, HistoryFormat, NextStep};
use crate::span::read::read_span_at_in;
use crate::types::{Anchor, AnchorExtent, AnchorLocation, Span};
use anyhow::Result;
use serde_json::{Value, json};

/// Similarity floor for pairing a dropped anchor with an added one as a
/// rename. Git's own `-M` default.
const RENAME_SIMILARITY_FLOOR: u8 = 50;

// ---------------------------------------------------------------------------
// Internal data model (drives both renderers — text and JSON cannot diverge)
// ---------------------------------------------------------------------------

/// The full computed history of one span, ready to render in any format.
pub struct HistoryReport {
    /// Span name as passed to the command.
    pub span: String,
    /// `true` when the git-log walk completed without hitting the time budget.
    /// `false` indicates a truncated timeline — the command exits non-zero.
    pub walk_complete: bool,
    /// `true` when the rendered timeline is a scoped/partial view of history:
    /// `--limit` dropped older qualifying commits that exist before the window.
    /// The first shown commit still diffs against the true prior span state (so
    /// its diffs stay truthful), but a consumer must not read the window as the
    /// complete record.
    pub scoped: bool,
    /// Commit sections, ordered oldest → newest. No-op commits (nothing
    /// observable changed) are already dropped before this point. Both
    /// renderers reverse to newest-first.
    pub commits: Vec<CommitSection>,
    /// Optional current-drift section (omitted when nothing drifts and the
    /// working tree declaration matches HEAD).
    pub current: Option<CurrentSection>,
}

/// One commit in the history where the span changed observably.
pub struct CommitSection {
    /// Full 40-hex OID of the commit.
    pub hash: String,
    /// Author date as a full ISO-8601 timestamp with offset (JSON `date`).
    pub date: String,
    /// Author date as `YYYY-MM-DD` (the human format's `Date:` line).
    pub day: String,
    /// First line of the commit message.
    pub summary: String,
    /// Blob diff of the `.span/<name>` declaration between the previous
    /// rendered state's commit and this one. Present iff the declaration blob
    /// changed.
    pub span_diff: Option<String>,
    /// Anchor changes at this commit, in the new state's declaration order,
    /// with deletions appended in the old state's declaration order.
    pub anchors: Vec<TimelineAnchor>,
}

/// One anchor's change record within a commit section.
pub struct TimelineAnchor {
    /// Combined git-span address (`path#L<start>-L<end>` or a bare path for
    /// whole-file anchors) *after* the change; for a removal, the last address
    /// the anchor held.
    pub path: String,
    /// The rendered unified diff for this change. Always present: for a
    /// first-add it is the synthesized `new anchor` addition diff, which the
    /// human format prints and the JSON format replaces with `content`.
    pub diff: String,
    /// Full snapshot text, present only for a first-add. When present, the
    /// JSON emitter writes `content` *instead of* `diff`, so every JSON
    /// timeline anchor carries exactly one of the two keys.
    pub content: Option<String>,
}

/// The optional current-drift section: how the working tree differs from the
/// last recorded timeline state and from HEAD.
pub struct CurrentSection {
    /// Blob diff of the `.span/<name>` declaration between HEAD and the
    /// working tree (covering uncommitted why edits and uncommitted anchor
    /// add/remove alike). Present iff the worktree bytes differ from HEAD.
    pub span_diff: Option<String>,
    /// Anchors the resolver reports as non-`Fresh`, in resolver order.
    pub anchors: Vec<CurrentAnchor>,
}

/// One anchor's drift record in the current section. Both fields are usually
/// present: `diff` is absent only when the live content is byte-identical to
/// the last recorded snapshot at an unchanged address, `content` only when the
/// anchor no longer resolves to any live location.
pub struct CurrentAnchor {
    /// The anchor's live address (the relocated one when the resolver moved
    /// it), falling back to the declared address when nothing resolves.
    pub path: String,
    /// Diff from the anchor's last recorded timeline snapshot to its live
    /// content.
    pub diff: Option<String>,
    /// Full live content of the anchor.
    pub content: Option<String>,
}

/// Content of an anchor at a specific point in time.
#[derive(Clone, PartialEq, Eq)]
pub enum AnchorBody {
    /// Normal source text extracted from the blob.
    Text(String),
    /// Degradation note substituted when the real content is unavailable
    /// (e.g. `"(file absent at this commit)"`, `"(line range past end of
    /// file)"`, `"(binary or non-UTF-8 content)"`). A Text→Note transition is
    /// an ordinary content change and diffs as one.
    Note(String),
}

impl AnchorBody {
    fn text(&self) -> &str {
        match self {
            AnchorBody::Text(s) | AnchorBody::Note(s) => s,
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Run `git span history <span>`.
///
/// Builds a [`HistoryReport`] by walking the span's git history in two passes,
/// then renders it via [`render_human`] or [`render_json`] according to
/// `args.format`. Returns exit code `0` on success, `1` on an incomplete walk
/// or hard error.
///
/// Error/not-found mapping follows the same conventions as `run_show` in
/// `show.rs`.
pub fn run_history(repo: &gix::Repository, args: HistoryArgs, span_root: &str) -> Result<i32> {
    let span_path = format!("{span_root}/{}", args.span);

    // Pass 1 — walk the declaration alone, unlimited, to learn every path the
    // span ever anchored. Without this, a commit that edits an anchored file
    // without touching the declaration is invisible and its content change
    // silently folds into the next declaration-touching commit.
    let (decl_commits, pass1_complete) = {
        let _perf = crate::perf::span("history.walk.declaration");
        crate::git::git_log_name_only_for_paths(
            repo,
            usize::MAX,
            std::slice::from_ref(&span_path),
        )?
    };
    if !pass1_complete {
        eprintln!(
            "error: history walk incomplete — not all commits were inspected (hit time budget)"
        );
        return Ok(1);
    }

    let mut seed_paths: Vec<String> = vec![span_path.clone()];
    {
        let _perf = crate::perf::span("history.walk.anchored-paths");
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for cc in &decl_commits {
            let span = match read_span_at_in(repo, &args.span, Some(&cc.hash), span_root) {
                Ok(m) => m,
                Err(crate::Error::SpanNotFound(_)) => continue,
                Err(e) => return Err(e.into()),
            };
            for (_id, a) in &span.anchors {
                if seen.insert(a.path.clone()) {
                    seed_paths.push(a.path.clone());
                }
            }
        }
    }

    // Pass 2 — walk the union of the declaration and every anchored path. The
    // user's `--limit` scopes this pass.
    let limit = args.limit.unwrap_or(usize::MAX);
    let (mut commits, walk_complete) = {
        let _perf = crate::perf::span("history.walk");
        crate::git::git_log_name_only_for_paths(repo, limit, &seed_paths)?
    };

    // Fail-closed: a truncated timeline is not a whole one. Emit a warning to
    // stderr, no partial output, and exit non-zero.
    if !walk_complete {
        eprintln!(
            "error: history walk incomplete — not all commits were inspected (hit time budget)"
        );
        return Ok(1);
    }

    // The walk yields newest-first; the timeline is *built* oldest→newest
    // (baseline seeding requires it) and reversed again at render time.
    commits.reverse();

    // Verify the span actually exists somewhere in scope. An empty walk for a
    // never-committed name is a not-found error (mirrors `run_show`).
    if commits.is_empty() {
        // The span may exist only in the worktree (uncommitted). Probe HEAD /
        // worktree before declaring it missing.
        let head = read_span_at_in(repo, &args.span, Some("HEAD"), span_root);
        let work = read_span_at_in(repo, &args.span, None, span_root);
        if matches!(head, Err(crate::Error::SpanNotFound(_)))
            && matches!(work, Err(crate::Error::SpanNotFound(_)))
        {
            return Err(CliError {
                subcommand: "history",
                summary: format!("no span named `{}`.", args.span),
                what_happened: format!(
                    "No commit in the current history touched `{span_path}`, and the \
                     span does not exist in the working tree or at HEAD."
                ),
                next_steps: vec![NextStep::Bash("git span list".into())],
            }
            .into());
        }
    }

    let mut report = {
        let _perf = crate::perf::span("history.build-report");
        build_report(
            repo,
            &args.span,
            span_root,
            &span_path,
            walk_complete,
            &commits,
        )?
    };

    // `--limit 0` yields an empty window for a span that nonetheless exists
    // in history — an empty timeline must not read as "this span has no
    // history". `build_report` cannot see the window was non-empty before
    // scoping, so flag it here.
    if commits.is_empty() && args.limit == Some(0) {
        report.scoped = true;
    }

    // Fail-closed in spirit: a scoped/partial window must never read as the
    // complete record. Unlike the walk-budget truncation (an internal limit,
    // exit non-zero), `--limit` is an explicit user scope, so we still render
    // and exit 0 — but warn to stderr that older span history exists before
    // the window.
    if report.scoped {
        eprintln!(
            "warning: history is scoped — `--limit` dropped older commits; \
             this is a partial timeline, not the complete record"
        );
    }

    let _perf = crate::perf::span("history.render");
    match args.format {
        HistoryFormat::Human => {
            print!("{}", render_human(&report));
        }
        HistoryFormat::Json => {
            let value = render_json(&report);
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
    }
    Ok(0)
}

// ---------------------------------------------------------------------------
// State materialization
// ---------------------------------------------------------------------------

/// One anchor's extracted snapshot at a point in history: everything the
/// unified-diff renderer needs for one side of an anchor pseudo-diff.
struct Snapshot {
    /// Declared address (`path#Lstart-Lend` or a bare path).
    address: String,
    /// 1-based first line of the snapshot in its real file (`1` for
    /// whole-file anchors), so hunk headers carry real file coordinates.
    first_line: u32,
    /// Bare `rk64` hex from the declaration, for the `index rk64:…` line.
    hash: String,
    /// Extracted body at the declared address, taken at face value.
    body: AnchorBody,
}

/// The span's state rendered at a point in history: the commit it was read at
/// plus each anchor's extracted snapshot, in declaration order.
struct RenderedState {
    commit: String,
    anchors: Vec<Snapshot>,
}

/// Render the address for an anchor's extent.
fn anchor_address(a: &Anchor) -> String {
    match a.extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(&a.path, Some(start), Some(end))
        }
        AnchorExtent::WholeFile => format_anchor_address(&a.path, None, None),
    }
}

/// 1-based first line of an extent in its file.
fn extent_first_line(extent: AnchorExtent) -> u32 {
    match extent {
        AnchorExtent::LineRange { start, .. } => start,
        AnchorExtent::WholeFile => 1,
    }
}

/// Strip the algorithm prefix from a stored hash token (`rk64:<hex>` →
/// `<hex>`); the renderer re-applies the `rk64:` prefix itself.
fn bare_hash(stored_hash: &str) -> String {
    match stored_hash.split_once(':') {
        Some((_algo, hex)) => hex.to_string(),
        None => stored_hash.to_string(),
    }
}

/// Read an anchor's body from a specific commit's tree, degrading per-anchor
/// (never aborting the whole report) on missing files, out-of-range line
/// anchors, or non-UTF-8 content.
fn read_anchor_at_commit(repo: &gix::Repository, commit_oid: &str, a: &Anchor) -> AnchorBody {
    let blob_oid = match crate::git::path_blob_at(repo, commit_oid, &a.path) {
        Ok(oid) => oid,
        Err(_) => return AnchorBody::Note("(file absent at this commit)".to_string()),
    };
    match a.extent {
        AnchorExtent::LineRange { start, end } => {
            match crate::git::extract_blob_lines(repo, &blob_oid, start, end) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => AnchorBody::Text(text),
                    Err(_) => AnchorBody::Note("(binary or non-UTF-8 content)".to_string()),
                },
                Err(crate::Error::InvalidAnchor { .. }) => {
                    AnchorBody::Note("(line range past end of file)".to_string())
                }
                Err(crate::Error::Parse(_)) => {
                    AnchorBody::Note("(binary or non-UTF-8 content)".to_string())
                }
                Err(_) => AnchorBody::Note("(file absent at this commit)".to_string()),
            }
        }
        AnchorExtent::WholeFile => match crate::git::read_blob_bytes(repo, &blob_oid) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) => AnchorBody::Text(text),
                Err(_) => AnchorBody::Note("(binary or non-UTF-8 content)".to_string()),
            },
            Err(_) => AnchorBody::Note("(binary or non-UTF-8 content)".to_string()),
        },
    }
}

/// Build the rendered state for a span at a commit.
fn rendered_state_at(repo: &gix::Repository, commit_oid: &str, span: &Span) -> RenderedState {
    let mut anchors = Vec::with_capacity(span.anchors.len());
    for (_id, a) in &span.anchors {
        anchors.push(Snapshot {
            address: anchor_address(a),
            first_line: extent_first_line(a.extent),
            hash: bare_hash(&a.stored_hash),
            body: read_anchor_at_commit(repo, commit_oid, a),
        });
    }
    RenderedState {
        commit: commit_oid.to_string(),
        anchors,
    }
}

// ---------------------------------------------------------------------------
// Diff production
// ---------------------------------------------------------------------------

/// A blob's OID and text at some revision.
struct BlobAt {
    oid: String,
    text: String,
}

/// Read `path`'s blob OID and text from a commit's tree; `None` when the path
/// is absent there.
fn blob_at(repo: &gix::Repository, commit_oid: &str, path: &str) -> Option<BlobAt> {
    let oid = crate::git::path_blob_at(repo, commit_oid, path).ok()?;
    let bytes = crate::git::read_blob_bytes(repo, &oid).ok()?;
    Some(BlobAt {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        oid,
    })
}

/// Render the declaration's blob diff between two optional sides. An absent
/// side renders with `/dev/null` conventions and a null abbreviated OID.
/// Returns `None` when both sides are absent or byte-identical.
fn blob_diff(path: &str, old: Option<&BlobAt>, new: Option<&BlobAt>) -> Option<String> {
    if old.is_none() && new.is_none() {
        return None;
    }
    let abbrev = |b: Option<&BlobAt>| match b {
        Some(b) => b.oid.chars().take(7).collect::<String>(),
        None => "0000000".to_string(),
    };
    let header = DiffHeader::Blob {
        old_oid7: abbrev(old),
        new_oid7: abbrev(new),
    };
    render_unified_diff(&header, blob_side(path, old), blob_side(path, new))
}

/// One side of a declaration blob diff; an absent blob becomes the `/dev/null`
/// sentinel side.
fn blob_side<'a>(path: &str, blob: Option<&'a BlobAt>) -> DiffSide<'a> {
    match blob {
        Some(b) => DiffSide {
            label: path.to_string(),
            text: b.text.as_str(),
            first_line: 1,
        },
        None => DiffSide {
            label: DEV_NULL.to_string(),
            text: "",
            first_line: 1,
        },
    }
}

/// Render one anchor pseudo-diff between two optional snapshots. The kind is
/// derived from the pair: `Modify` at an unchanged address, `Rename` when the
/// address moved (headers always, hunks only when content also changed), and
/// `New`/`Deleted` for an unpaired side.
fn snapshot_diff(old: Option<&Snapshot>, new: Option<&Snapshot>) -> Option<String> {
    fn null_side() -> DiffSide<'static> {
        DiffSide {
            label: DEV_NULL.to_string(),
            text: "",
            first_line: 1,
        }
    }
    fn side(s: &Snapshot) -> DiffSide<'_> {
        DiffSide {
            label: s.address.clone(),
            text: s.body.text(),
            first_line: s.first_line,
        }
    }
    match (old, new) {
        (Some(o), Some(n)) => {
            let kind = if o.address == n.address {
                AnchorDiffKind::Modify
            } else {
                AnchorDiffKind::Rename {
                    similarity: similarity(o.body.text(), n.body.text()),
                }
            };
            render_unified_diff(
                &DiffHeader::Anchor {
                    old_hash: o.hash.clone(),
                    new_hash: n.hash.clone(),
                    kind,
                },
                side(o),
                side(n),
            )
        }
        (None, Some(n)) => render_unified_diff(
            &DiffHeader::Anchor {
                old_hash: NULL_ANCHOR_HASH.to_string(),
                new_hash: n.hash.clone(),
                kind: AnchorDiffKind::New,
            },
            null_side(),
            side(n),
        ),
        (Some(o), None) => render_unified_diff(
            &DiffHeader::Anchor {
                old_hash: o.hash.clone(),
                new_hash: NULL_ANCHOR_HASH.to_string(),
                kind: AnchorDiffKind::Deleted,
            },
            side(o),
            null_side(),
        ),
        (None, None) => None,
    }
}

/// Pair the old state's anchors with the new state's.
///
/// Exact address matches pair first (an anchor that stayed put). Every
/// leftover old×new candidate above [`RENAME_SIMILARITY_FLOOR`] is then paired
/// greedily by highest similarity — ties break by declaration order (lowest old
/// index, then lowest new index), so a deterministic pairing falls out of a
/// deterministic declaration. Whatever is still unpaired is a genuine
/// removal/addition.
///
/// Returns `pairs[new_index] = Some(old_index)` plus the old indices that
/// stayed unpaired, in declaration order.
fn pair_anchors(old: &[Snapshot], new: &[Snapshot]) -> (Vec<Option<usize>>, Vec<usize>) {
    let mut pairs: Vec<Option<usize>> = vec![None; new.len()];
    let mut old_used: Vec<bool> = vec![false; old.len()];

    for (j, n) in new.iter().enumerate() {
        if let Some(i) = old
            .iter()
            .enumerate()
            .position(|(i, o)| !old_used[i] && o.address == n.address)
        {
            old_used[i] = true;
            pairs[j] = Some(i);
        }
    }

    loop {
        let mut best: Option<(u8, usize, usize)> = None;
        for (i, o) in old.iter().enumerate() {
            if old_used[i] {
                continue;
            }
            for (j, n) in new.iter().enumerate() {
                if pairs[j].is_some() {
                    continue;
                }
                let sim = similarity(o.body.text(), n.body.text());
                if sim < RENAME_SIMILARITY_FLOOR {
                    continue;
                }
                // Ties break by declaration order: the iteration order is
                // (old asc, new asc), so a strict `>` keeps the first-seen
                // candidate.
                if best.is_none_or(|(bs, _, _)| sim > bs) {
                    best = Some((sim, i, j));
                }
            }
        }
        match best {
            Some((_, i, j)) => {
                old_used[i] = true;
                pairs[j] = Some(i);
            }
            None => break,
        }
    }

    let dropped = (0..old.len()).filter(|i| !old_used[*i]).collect();
    (pairs, dropped)
}

/// Diff a commit's rendered state against the previous rendered state and emit
/// a [`CommitSection`]. Returns `None` when nothing observable changed — a
/// commit that qualified for the walk (it touched an anchored file) but left
/// every declared range and the declaration itself untouched.
fn diff_section(
    repo: &gix::Repository,
    span_path: &str,
    ident: CommitIdent,
    prev: Option<&RenderedState>,
    cur: &RenderedState,
) -> Option<CommitSection> {
    let old_blob = prev.and_then(|p| blob_at(repo, &p.commit, span_path));
    let new_blob = blob_at(repo, &cur.commit, span_path);
    let span_diff = blob_diff(span_path, old_blob.as_ref(), new_blob.as_ref());

    let empty: Vec<Snapshot> = Vec::new();
    let old = prev.map(|p| p.anchors.as_slice()).unwrap_or(&empty);
    let new = cur.anchors.as_slice();
    let (pairs, dropped) = pair_anchors(old, new);

    let mut anchors: Vec<TimelineAnchor> = Vec::new();
    for (j, n) in new.iter().enumerate() {
        let o = pairs[j].map(|i| &old[i]);
        let Some(diff) = snapshot_diff(o, Some(n)) else {
            continue;
        };
        anchors.push(TimelineAnchor {
            path: n.address.clone(),
            diff,
            // A first-add carries the full snapshot so a consumer can render a
            // preview without reconstructing it from the addition diff.
            content: o.is_none().then(|| n.body.text().to_string()),
        });
    }
    for i in dropped {
        if let Some(diff) = snapshot_diff(Some(&old[i]), None) {
            anchors.push(TimelineAnchor {
                path: old[i].address.clone(),
                diff,
                content: None,
            });
        }
    }

    if span_diff.is_none() && anchors.is_empty() {
        return None;
    }

    Some(CommitSection {
        hash: ident.hash,
        date: ident.date,
        day: ident.day,
        summary: ident.summary,
        span_diff,
        anchors,
    })
}

/// Identity of the commit a section is being built for, in both date shapes
/// the two renderers need.
struct CommitIdent {
    hash: String,
    /// Full ISO-8601 timestamp with offset (JSON).
    date: String,
    /// `YYYY-MM-DD` (human `Date:` line).
    day: String,
    summary: String,
}

fn build_report(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    span_path: &str,
    walk_complete: bool,
    commits: &[crate::git::CommitChanges],
) -> Result<HistoryReport> {
    let mut sections: Vec<CommitSection> = Vec::new();

    // Seed the diff baseline from the true span state at the commit immediately
    // before the window. When `--limit` dropped older commits, the oldest shown
    // commit must diff against real prior state — otherwise every anchor
    // already present there is mislabeled as newly added. A non-empty seed also
    // means the window is a strict prefix-truncation of history → `scoped`.
    let (mut prev, scoped) = match commits.first() {
        Some(oldest) => seed_prior_state(repo, span_name, span_root, &oldest.hash)?,
        None => (None, false),
    };

    for cc in commits {
        // Read the span as it existed at this commit. An absent span
        // (deleted-then-re-added gap, or a commit predating the span's
        // creation that touched an anchored file) renders as an empty state.
        let span = match read_span_at_in(repo, span_name, Some(&cc.hash), span_root) {
            Ok(m) => Some(m),
            Err(crate::Error::SpanNotFound(_)) => None,
            Err(e) => return Err(e.into()),
        };

        let cur = match &span {
            Some(m) => rendered_state_at(repo, &cc.hash, m),
            None => RenderedState {
                commit: cc.hash.clone(),
                anchors: Vec::new(),
            },
        };

        let meta = crate::git::commit_meta(repo, &cc.hash)?;

        let ident = CommitIdent {
            hash: cc.hash.clone(),
            date: rfc2822_to_iso8601(&meta.author_date_rfc2822),
            day: rfc2822_to_ymd(&meta.author_date_rfc2822),
            summary: meta.summary.clone(),
        };

        if let Some(section) = diff_section(repo, span_path, ident, prev.as_ref(), &cur) {
            sections.push(section);
        }

        // Advance the baseline. A no-op commit yields `cur == prev`, so this is
        // harmless and never resets the diff anchor.
        prev = Some(cur);
    }

    // The current block diffs against the *last recorded timeline state* — the
    // newest in-window commit's state. With an empty window (`--limit 0`, or a
    // worktree-only span) fall back to HEAD, the only other recorded state.
    let last = match prev {
        Some(state) => Some(state),
        None => match read_span_at_in(repo, span_name, Some("HEAD"), span_root) {
            Ok(span) => crate::git::resolve_commit(repo, "HEAD")
                .ok()
                .map(|head| rendered_state_at(repo, &head, &span)),
            Err(crate::Error::SpanNotFound(_)) => None,
            Err(e) => return Err(e.into()),
        },
    };

    let current = build_current(repo, span_name, span_root, span_path, last.as_ref())?;

    Ok(HistoryReport {
        span: span_name.to_string(),
        walk_complete,
        scoped,
        commits: sections,
        current,
    })
}

/// Compute the rendered span state at the commit immediately before the window
/// (the first parent of `oldest_hash`), to seed the diff baseline truthfully.
///
/// Returns `(Some(state), true)` when a span-touching prior state exists — the
/// window is a strict prefix-truncation of history, so the first shown commit
/// diffs against real prior state and the report is flagged `scoped`. Returns
/// `(None, false)` when `oldest_hash` is the true history root for this span
/// (no parent, or the span did not exist at the parent), i.e. a genuine
/// first-appearance window that is the complete record from the span's birth.
fn seed_prior_state(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    oldest_hash: &str,
) -> Result<(Option<RenderedState>, bool)> {
    // Resolve the parent to a bare OID: `read_span_at_in` accepts a revspec,
    // but the per-anchor body reads (`path_blob_at`) require a 40-hex OID, so a
    // raw `<hash>~1` would fail blob lookup and degrade every anchor to a note
    // (spuriously diffing as changed). A root commit has no parent →
    // `resolve_commit` errors → genuine first appearance.
    let parent = match crate::git::resolve_commit(repo, &format!("{oldest_hash}~1")) {
        Ok(oid) => oid,
        Err(_) => return Ok((None, false)),
    };
    match read_span_at_in(repo, span_name, Some(&parent), span_root) {
        Ok(span) => Ok((Some(rendered_state_at(repo, &parent, &span)), true)),
        // `SpanNotFound` here covers both "no parent (root commit)" — an
        // unresolvable `<hash>~1` makes `tree_entry_at` yield `Ok(None)` →
        // `SpanNotFound` — and "the span file is absent at the parent". Either
        // way the oldest shown commit is the span's true first appearance.
        Err(crate::Error::SpanNotFound(_)) => Ok((None, false)),
        Err(e) => Err(e.into()),
    }
}

/// Convert an RFC2822 date (`Thu, 3 Nov 2025 …`) to `YYYY-MM-DD`.
fn rfc2822_to_ymd(rfc2822: &str) -> String {
    use chrono::DateTime;
    match DateTime::parse_from_rfc2822(rfc2822) {
        Ok(dt) => dt.format("%Y-%m-%d").to_string(),
        Err(_) => rfc2822.to_string(),
    }
}

/// Convert an RFC2822 date to a full ISO-8601 timestamp with offset
/// (`2026-07-29T15:12:41-07:00`, git's `%aI`). JSON consumers render both a
/// relative age and an absolute local time, neither of which a day-only string
/// can support.
fn rfc2822_to_iso8601(rfc2822: &str) -> String {
    use chrono::DateTime;
    match DateTime::parse_from_rfc2822(rfc2822) {
        Ok(dt) => dt.format("%Y-%m-%dT%H:%M:%S%:z").to_string(),
        Err(_) => rfc2822.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Current (working-tree) section
// ---------------------------------------------------------------------------

/// Build the address string for a resolved anchor location.
fn location_address(loc: &AnchorLocation) -> String {
    let path = loc.path.to_string_lossy();
    match loc.extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(&path, Some(start), Some(end))
        }
        AnchorExtent::WholeFile => format_anchor_address(&path, None, None),
    }
}

/// Compute the `rk64` content hash of a resolved location, using the same
/// canonicalization the resolver and `git span add` use, so the `index rk64:…`
/// line on the live side of a current diff is the token a re-anchor would
/// record.
fn location_hash(repo: &gix::Repository, loc: &AnchorLocation) -> String {
    // A resolved location's `blob` may be a *computed* hash the worktree layer
    // never wrote to the object database, so a lookup miss falls back to the
    // working tree — the same fallback `read_location_text` makes, keeping the
    // rendered content and its `index` hash describing the same bytes.
    let bytes = loc
        .blob
        .and_then(|oid| crate::git::read_blob_bytes(repo, &oid.to_string()).ok())
        .unwrap_or_else(|| {
            let path = loc.path.to_string_lossy().to_string();
            let mut filters = crate::resolver::layers::CustomFilters::new();
            crate::resolver::layers::read_worktree_normalized(repo, &mut filters, &path)
                .or_else(|_| crate::git::read_worktree_bytes(repo, &path))
                .unwrap_or_default()
        });
    git_span_core::rk64_to_hex(git_span_core::cheap_fingerprint_with_extent(
        &bytes, &loc.extent,
    ))
}

/// Build the optional `current` section from two triggers:
///
///   1. the resolver (the same `LayerSet::full()` engine `git span stale` uses)
///      reports a non-`Fresh` status for an anchor — committed-but-not-
///      re-anchored source drift, a relocated `moved` anchor, an uncommitted
///      edit, a deletion, …; each such anchor becomes one diff from its last
///      recorded timeline snapshot to its live content, plus a full snapshot;
///   2. the worktree declaration differs from HEAD — one `span_diff` covering
///      uncommitted why edits and uncommitted anchor add/remove alike (a
///      worktree-added anchor resolves as `Fresh`, so the declaration diff is
///      its only representation).
///
/// The section is omitted when neither fires.
fn build_current(
    repo: &gix::Repository,
    span_name: &str,
    span_root: &str,
    span_path: &str,
    last: Option<&RenderedState>,
) -> Result<Option<CurrentSection>> {
    // Trigger 2 — HEAD declaration blob vs. the worktree bytes. The worktree
    // side's `index` hash comes from `hash_blob`, which computes a blob OID
    // without writing the object.
    let head_blob = crate::git::resolve_commit(repo, "HEAD")
        .ok()
        .and_then(|head| blob_at(repo, &head, span_path));
    let work_blob = crate::git::read_worktree_bytes(repo, span_path)
        .ok()
        .and_then(|bytes| {
            let oid = crate::git::hash_blob(&bytes).ok()?;
            Some(BlobAt {
                oid: oid.to_string(),
                text: String::from_utf8_lossy(&bytes).into_owned(),
            })
        });
    let span_diff = blob_diff(span_path, head_blob.as_ref(), work_blob.as_ref());

    // Trigger 1 — resolve the live span through the same engine `git span
    // stale` uses: worktree-over-index-over-HEAD, with the staged-span layer
    // included. Each non-Fresh anchor becomes one `CurrentAnchor` whose content
    // is the engine's resolved live location (the relocated block for a `moved`
    // anchor), never a slice of the stored line range.
    let options = crate::types::EngineOptions {
        layers: crate::types::LayerSet::full(),
        ignore_unavailable: false,
        since: None,
        needs_all_layers: true,
        fuzzy_threshold: 0.95,
    };
    let names = [span_name.to_string()];
    let resolved = crate::resolver::resolve_named_spans(repo, span_root, &names, options)?;

    let mut anchors: Vec<CurrentAnchor> = Vec::new();
    for (_name, result) in resolved {
        let span = match result {
            Ok(m) => m,
            // A worktree-only span (no committed ref) still resolves; a genuine
            // not-found surfaces nothing for this anchor pass.
            Err(crate::Error::SpanNotFound(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        for r in &span.anchors {
            if r.status == crate::types::AnchorStatus::Fresh {
                continue;
            }
            // The old side is the anchor's last recorded timeline snapshot, at
            // its recorded address — not HEAD generally.
            let anchored_address = location_address(&r.anchored);
            let old = last.and_then(|s| s.anchors.iter().find(|a| a.address == anchored_address));

            let new = r.current.as_ref().map(|loc| Snapshot {
                address: location_address(loc),
                first_line: extent_first_line(loc.extent),
                hash: location_hash(repo, loc),
                body: AnchorBody::Text(crate::cli::stale_output::read_location_text(repo, loc)),
            });

            let path = new
                .as_ref()
                .map(|s| s.address.clone())
                .unwrap_or_else(|| anchored_address.clone());
            let content = new.as_ref().map(|s| s.body.text().to_string());
            let diff = snapshot_diff(old, new.as_ref());
            anchors.push(CurrentAnchor {
                path,
                diff,
                content,
            });
        }
    }

    if span_diff.is_none() && anchors.is_empty() {
        return Ok(None);
    }
    Ok(Some(CurrentSection { span_diff, anchors }))
}

// ---------------------------------------------------------------------------
// Renderers (pure functions of HistoryReport)
// ---------------------------------------------------------------------------

/// Render a `HistoryReport` as git-log-style text.
///
/// Uncommitted drift comes first with no commit header (git's own idiom for
/// "not yet committed"), then commit entries newest-first: `commit <40-hex>`,
/// `Date:   YYYY-MM-DD`, a blank line, the four-space-indented summary, then
/// the declaration diff and each anchor diff. Every block is separated by one
/// blank line.
pub fn render_human(report: &HistoryReport) -> String {
    let mut blocks: Vec<&str> = Vec::new();
    let headers: Vec<String> = report
        .commits
        .iter()
        .rev()
        .map(|c| format!("commit {}\nDate:   {}\n\n    {}\n", c.hash, c.day, c.summary))
        .collect();

    if let Some(cur) = &report.current {
        if let Some(d) = &cur.span_diff {
            blocks.push(d);
        }
        for a in &cur.anchors {
            if let Some(d) = &a.diff {
                blocks.push(d);
            }
        }
    }
    for (header, c) in headers.iter().zip(report.commits.iter().rev()) {
        blocks.push(header);
        if let Some(d) = &c.span_diff {
            blocks.push(d);
        }
        for a in &c.anchors {
            blocks.push(&a.diff);
        }
    }

    blocks.join("\n")
}

/// Render a `HistoryReport` as a `schema_version: 2` `serde_json::Value`.
///
/// `commits` is newest-first. Each timeline anchor carries `path` plus exactly
/// one of `diff` or `content` (`content` for a first-add); `current` anchors
/// carry both. `span_diff`, `current`, and `scoped` are omitted when absent.
pub fn render_json(report: &HistoryReport) -> Value {
    let commits: Vec<Value> = report
        .commits
        .iter()
        .rev()
        .map(|c| {
            let mut obj = serde_json::Map::new();
            obj.insert("hash".into(), json!(c.hash));
            obj.insert("date".into(), json!(c.date));
            obj.insert("summary".into(), json!(c.summary));
            if let Some(diff) = &c.span_diff {
                obj.insert("span_diff".into(), json!(diff));
            }
            let anchors: Vec<Value> = c
                .anchors
                .iter()
                .map(|a| {
                    let mut ao = serde_json::Map::new();
                    ao.insert("path".into(), json!(a.path));
                    match &a.content {
                        Some(content) => ao.insert("content".into(), json!(content)),
                        None => ao.insert("diff".into(), json!(a.diff)),
                    };
                    Value::Object(ao)
                })
                .collect();
            obj.insert("anchors".into(), json!(anchors));
            Value::Object(obj)
        })
        .collect();

    let mut root = serde_json::Map::new();
    root.insert("schema_version".into(), json!(2));
    root.insert("span".into(), json!(report.span));
    if report.scoped {
        root.insert("scoped".into(), json!(true));
    }
    if let Some(cur) = &report.current {
        let mut co = serde_json::Map::new();
        if let Some(diff) = &cur.span_diff {
            co.insert("span_diff".into(), json!(diff));
        }
        let anchors: Vec<Value> = cur
            .anchors
            .iter()
            .map(|a| {
                let mut ao = serde_json::Map::new();
                ao.insert("path".into(), json!(a.path));
                if let Some(diff) = &a.diff {
                    ao.insert("diff".into(), json!(diff));
                }
                if let Some(content) = &a.content {
                    ao.insert("content".into(), json!(content));
                }
                Value::Object(ao)
            })
            .collect();
        co.insert("anchors".into(), json!(anchors));
        root.insert("current".into(), Value::Object(co));
    }
    root.insert("commits".into(), json!(commits));

    Value::Object(root)
}
