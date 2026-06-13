//! `git mesh history <mesh>` — chronological timeline of a mesh file's git
//! history, rendered as XML (default) or JSON.
//!
//! # Output contract
//!
//! See `docs/history-example-output-xml.md` (canonical XML) and
//! `docs/history-example-output.md` (markdown variant) for concrete example
//! output that the integration tests assert against.

use crate::cli::format::format_anchor_address;
use crate::cli::{CliError, HistoryArgs, HistoryFormat, NextStep};
use crate::mesh::read::read_mesh_at_in;
use crate::types::{Anchor, AnchorExtent, Mesh};
use anyhow::Result;
use serde_json::{Value, json};

// ---------------------------------------------------------------------------
// Internal data model (drives both renderers — XML and JSON cannot diverge)
// ---------------------------------------------------------------------------

/// The full computed history of one mesh, ready to render in any format.
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
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Event {
    /// Anchor was not present before this commit (includes first-appearance).
    Added,
    /// Anchor was present before but its source content changed.
    Modified,
    /// Anchor was removed at this commit (no body rendered).
    Removed,
}

impl Event {
    fn as_str(self) -> &'static str {
        match self {
            Event::Added => "added",
            Event::Modified => "modified",
            Event::Removed => "removed",
        }
    }
}

/// The optional current-drift section, describing how the working tree differs
/// from HEAD. Uses the same drift labels as `git mesh stale`.
pub struct CurrentSection {
    /// Uncommitted why change, present only when it differs from HEAD.
    pub why: Option<String>,
    /// Anchors whose working-tree content differs from HEAD.
    pub anchors: Vec<CurrentAnchor>,
}

/// One anchor's drift record in the current section.
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
#[derive(Clone, PartialEq, Eq)]
pub enum AnchorBody {
    /// Normal source text extracted from the blob.
    Text(String),
    /// Degradation note substituted when the real content is unavailable
    /// (e.g. `"(file absent at this commit)"`, `"(line range past end of
    /// file)"`, `"(binary or non-UTF-8 content)"`).
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

/// Run `git mesh history <mesh>`.
///
/// Builds a [`HistoryReport`] by walking the mesh file's git history, then
/// renders it via `render_xml` or `render_json` according to `args.format`.
/// Returns exit code `0` on success, `1` on an incomplete walk or hard error.
///
/// Error/not-found mapping follows the same conventions as `run_show` in
/// `show.rs`.
pub fn run_history(repo: &gix::Repository, args: HistoryArgs, mesh_root: &str) -> Result<i32> {
    let mesh_path = format!("{mesh_root}/{}", args.mesh);

    // Cap the walk. `git_log_name_only_for_paths` has no "all" sentinel; an
    // unbounded request maps to usize::MAX so every qualifying commit is seen.
    let limit = args.limit.unwrap_or(usize::MAX);

    let (mut commits, walk_complete) = {
        let _perf = crate::perf::span("history.walk");
        crate::git::git_log_name_only_for_paths(repo, limit, std::slice::from_ref(&mesh_path))?
    };

    // Fail-closed: a truncated timeline is not a whole one. Emit a warning to
    // stderr, no partial output, and exit non-zero.
    if !walk_complete {
        eprintln!(
            "error: history walk incomplete — not all commits were inspected (hit time budget)"
        );
        return Ok(1);
    }

    // The walk yields newest-first; the timeline reads oldest→newest.
    commits.reverse();

    // `--since` is a lower bound: keep only commits at or after the resolved
    // commit-ish (i.e. the cutoff is an ancestor of the commit).
    if let Some(ref since) = args.since {
        let since_oid = crate::git::resolve_commit(repo, since).map_err(|e| CliError {
            subcommand: "history",
            summary: format!("`--since {since}` could not be resolved."),
            what_happened: format!("{e}"),
            next_steps: vec![NextStep::Prose(
                "Pass a valid commit-ish or date (e.g. a SHA, tag, or `HEAD~5`).".into(),
            )],
        })?;
        let mut kept = Vec::with_capacity(commits.len());
        for c in commits.into_iter() {
            if crate::git::is_ancestor(repo, &since_oid, &c.hash).unwrap_or(false) {
                kept.push(c);
            }
        }
        commits = kept;
    }

    // Verify the mesh actually exists somewhere in scope. An empty walk for a
    // never-committed name is a not-found error (mirrors `run_show`).
    if commits.is_empty() {
        // The mesh may exist only in the worktree (uncommitted). Probe HEAD /
        // worktree before declaring it missing.
        let head = read_mesh_at_in(repo, &args.mesh, Some("HEAD"), mesh_root);
        let work = read_mesh_at_in(repo, &args.mesh, None, mesh_root);
        if matches!(head, Err(crate::Error::MeshNotFound(_)))
            && matches!(work, Err(crate::Error::MeshNotFound(_)))
        {
            return Err(CliError {
                subcommand: "history",
                summary: format!("no mesh named `{}`.", args.mesh),
                what_happened: format!(
                    "No commit in the current history touched `{mesh_path}`, and the \
                     mesh does not exist in the working tree or at HEAD."
                ),
                next_steps: vec![NextStep::Bash("git mesh list".into())],
            }
            .into());
        }
    }

    let report = {
        let _perf = crate::perf::span("history.build-report");
        build_report(repo, &args.mesh, mesh_root, walk_complete, &commits)?
    };

    let _perf = crate::perf::span("history.render");
    match args.format {
        HistoryFormat::Xml => {
            print!("{}", render_xml(&report));
        }
        HistoryFormat::Json => {
            let value = render_json(&report);
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
    }
    Ok(0)
}

// ---------------------------------------------------------------------------
// Report construction
// ---------------------------------------------------------------------------

/// The content state rendered at a point in history: why prose plus each
/// anchor's address mapped to its extracted body. The diff between consecutive
/// rendered states decides what each commit section emits.
struct RenderedState {
    why: String,
    /// Ordered (address, extent, body). Order preserves the mesh's anchor
    /// order so first-appearance anchors render in a stable sequence.
    anchors: Vec<(String, AnchorBody)>,
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

/// Build the rendered state for a mesh at a commit.
fn rendered_state_at(repo: &gix::Repository, commit_oid: &str, mesh: &Mesh) -> RenderedState {
    let mut anchors = Vec::with_capacity(mesh.anchors.len());
    for (_id, a) in &mesh.anchors {
        let addr = anchor_address(a);
        let body = read_anchor_at_commit(repo, commit_oid, a);
        anchors.push((addr, body));
    }
    RenderedState {
        why: mesh.message.trim_end_matches('\n').to_string(),
        anchors,
    }
}

/// Diff a commit's rendered state against the previous rendered state and emit
/// a [`CommitSection`]. Returns `None` when nothing observable changed.
fn diff_section(
    hash: String,
    date: String,
    summary: String,
    prev: Option<&RenderedState>,
    cur: &RenderedState,
) -> Option<CommitSection> {
    let empty_why = String::new();
    let prev_why = prev.map(|p| &p.why).unwrap_or(&empty_why);
    let why = if &cur.why != prev_why {
        Some(cur.why.clone())
    } else {
        None
    };

    let mut anchors: Vec<TimelineAnchor> = Vec::new();

    // Added / modified: every current anchor compared to its prior body.
    for (addr, body) in &cur.anchors {
        let prior = prev.and_then(|p| p.anchors.iter().find(|(a, _)| a == addr).map(|(_, b)| b));
        match prior {
            None => anchors.push(TimelineAnchor {
                address: addr.clone(),
                event: Event::Added,
                content: Some(body.clone()),
            }),
            Some(prior_body) if prior_body != body => anchors.push(TimelineAnchor {
                address: addr.clone(),
                event: Event::Modified,
                content: Some(body.clone()),
            }),
            Some(_) => {}
        }
    }

    // Removed: anchors that were present before but are gone now.
    if let Some(p) = prev {
        for (addr, _) in &p.anchors {
            if !cur.anchors.iter().any(|(a, _)| a == addr) {
                anchors.push(TimelineAnchor {
                    address: addr.clone(),
                    event: Event::Removed,
                    content: None,
                });
            }
        }
    }

    if why.is_none() && anchors.is_empty() {
        return None;
    }

    Some(CommitSection {
        hash,
        date,
        summary,
        why,
        anchors,
    })
}

fn build_report(
    repo: &gix::Repository,
    mesh_name: &str,
    mesh_root: &str,
    walk_complete: bool,
    commits: &[crate::git::CommitChanges],
) -> Result<HistoryReport> {
    let mut sections: Vec<CommitSection> = Vec::new();
    let mut prev: Option<RenderedState> = None;

    for cc in commits {
        // Read the mesh as it existed at this commit. An absent mesh
        // (deleted-then-re-added gap) renders as an empty state so its anchors
        // diff as removed around the gap.
        let mesh = match read_mesh_at_in(repo, mesh_name, Some(&cc.hash), mesh_root) {
            Ok(m) => Some(m),
            Err(crate::Error::MeshNotFound(_)) => None,
            Err(e) => return Err(e.into()),
        };

        let cur = match &mesh {
            Some(m) => rendered_state_at(repo, &cc.hash, m),
            None => RenderedState {
                why: String::new(),
                anchors: Vec::new(),
            },
        };

        let meta = crate::git::commit_meta(repo, &cc.hash)?;
        let date = rfc2822_to_ymd(&meta.author_date_rfc2822);

        if let Some(section) = diff_section(
            cc.hash.clone(),
            date,
            meta.summary.clone(),
            prev.as_ref(),
            &cur,
        ) {
            sections.push(section);
        }

        // Advance the baseline. A no-op commit yields `cur == prev`, so this is
        // harmless and never resets the diff anchor.
        prev = Some(cur);
    }

    let current = build_current(repo, mesh_name, mesh_root)?;

    Ok(HistoryReport {
        mesh: mesh_name.to_string(),
        walk_complete,
        commits: sections,
        current,
    })
}

/// Convert an RFC2822 date (`Thu, 3 Nov 2025 …`) to `YYYY-MM-DD`.
fn rfc2822_to_ymd(rfc2822: &str) -> String {
    use chrono::DateTime;
    match DateTime::parse_from_rfc2822(rfc2822) {
        Ok(dt) => dt.format("%Y-%m-%d").to_string(),
        Err(_) => rfc2822.to_string(),
    }
}

/// Read live worktree content for an anchor, normalized exactly as the resolver
/// compares it so EOL normalization never fabricates drift. Returns `None` when
/// the file is absent in the worktree.
fn read_anchor_worktree(repo: &gix::Repository, a: &Anchor) -> Option<AnchorBody> {
    let mut custom_filters = crate::resolver::layers::CustomFilters::new();
    let bytes = match crate::resolver::layers::read_worktree_normalized(
        repo,
        &mut custom_filters,
        &a.path,
    ) {
        Ok(b) => b,
        Err(_) => return None,
    };
    // `read_worktree_normalized` returns empty bytes for a missing file; treat
    // a truly absent worktree path as deleted.
    let abs = repo.workdir().map(|w| w.join(&a.path));
    if let Some(abs) = abs
        && !abs.exists()
    {
        return None;
    }
    body_from_bytes(&bytes, a.extent)
}

/// Slice `bytes` to an anchor extent and wrap in an [`AnchorBody`].
fn body_from_bytes(bytes: &[u8], extent: AnchorExtent) -> Option<AnchorBody> {
    let text = match std::str::from_utf8(bytes) {
        Ok(t) => t,
        Err(_) => return Some(AnchorBody::Note("(binary or non-UTF-8 content)".to_string())),
    };
    match extent {
        AnchorExtent::WholeFile => Some(AnchorBody::Text(text.to_string())),
        AnchorExtent::LineRange { start, end } => {
            let lines: Vec<&str> = text.lines().collect();
            let lo = (start.saturating_sub(1)) as usize;
            let hi = (end as usize).min(lines.len());
            if lo > hi || lo >= lines.len() {
                return Some(AnchorBody::Note("(line range past end of file)".to_string()));
            }
            let mut out = String::new();
            for line in &lines[lo..hi] {
                out.push_str(line);
                out.push('\n');
            }
            Some(AnchorBody::Text(out))
        }
    }
}

/// Build the optional `current` section: working-tree mesh vs HEAD mesh.
fn build_current(
    repo: &gix::Repository,
    mesh_name: &str,
    mesh_root: &str,
) -> Result<Option<CurrentSection>> {
    let head = match read_mesh_at_in(repo, mesh_name, Some("HEAD"), mesh_root) {
        Ok(m) => Some(m),
        Err(crate::Error::MeshNotFound(_)) => None,
        Err(e) => return Err(e.into()),
    };
    let work = match read_mesh_at_in(repo, mesh_name, None, mesh_root) {
        Ok(m) => Some(m),
        Err(crate::Error::MeshNotFound(_)) => None,
        Err(e) => return Err(e.into()),
    };

    let head_oid = crate::git::resolve_commit(repo, "HEAD").ok();

    // Uncommitted why change.
    let head_why = head
        .as_ref()
        .map(|m| m.message.trim_end_matches('\n').to_string())
        .unwrap_or_default();
    let work_why = work
        .as_ref()
        .map(|m| m.message.trim_end_matches('\n').to_string())
        .unwrap_or_default();
    let why = if work_why != head_why {
        Some(work_why)
    } else {
        None
    };

    let mut anchors: Vec<CurrentAnchor> = Vec::new();

    if let Some(work_mesh) = &work {
        for (_id, a) in &work_mesh.anchors {
            let addr = anchor_address(a);
            // HEAD body for this anchor (None when the anchor or file is absent
            // at HEAD).
            let head_body = match (&head, &head_oid) {
                (Some(head_mesh), Some(oid))
                    if head_mesh.anchors.iter().any(|(_, h)| anchor_address(h) == addr) =>
                {
                    Some(read_anchor_at_commit(repo, oid, a))
                }
                _ => None,
            };

            let live = read_anchor_worktree(repo, a);

            match (head_body, live) {
                // Anchor present at HEAD; compare live vs HEAD content.
                (Some(head_body), Some(live_body)) => {
                    if live_body != head_body {
                        anchors.push(CurrentAnchor {
                            address: addr,
                            status: "changed in the working tree".to_string(),
                            content: Some(live_body),
                        });
                    }
                }
                // Anchor present at HEAD but its file is gone from the worktree.
                (Some(_), None) => {
                    anchors.push(CurrentAnchor {
                        address: addr,
                        status: "deleted in the working tree".to_string(),
                        content: None,
                    });
                }
                // Anchor newly added in the worktree (not at HEAD).
                (None, Some(live_body)) => {
                    anchors.push(CurrentAnchor {
                        address: addr,
                        status: "changed in the working tree".to_string(),
                        content: Some(live_body),
                    });
                }
                (None, None) => {}
            }
        }
    }

    // Anchors removed in the worktree (present at HEAD, gone from worktree mesh).
    if let (Some(head_mesh), Some(work_mesh)) = (&head, &work) {
        for (_id, h) in &head_mesh.anchors {
            let addr = anchor_address(h);
            let still_present = work_mesh
                .anchors
                .iter()
                .any(|(_, w)| anchor_address(w) == addr);
            if !still_present {
                anchors.push(CurrentAnchor {
                    address: addr,
                    status: "deleted in the working tree".to_string(),
                    content: None,
                });
            }
        }
    }

    if why.is_none() && anchors.is_empty() {
        return Ok(None);
    }
    Ok(Some(CurrentSection { why, anchors }))
}

// ---------------------------------------------------------------------------
// Renderers (pure functions of HistoryReport)
// ---------------------------------------------------------------------------

/// XML-attribute-escape `&`, `<`, and `"`.
fn xml_attr_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// Wrap a body in CDATA, splitting any literal `]]>` so it cannot terminate the
/// CDATA section prematurely.
fn cdata_wrap(s: &str) -> String {
    let split = s.replace("]]>", "]]]]><![CDATA[>");
    format!("<![CDATA[{split}]]>")
}

/// Render an anchor body inside a CDATA-or-note context. Degradation notes are
/// emitted as plain text (not CDATA); real source is CDATA-wrapped.
fn render_body_xml(body: &AnchorBody) -> String {
    match body {
        AnchorBody::Text(s) => cdata_wrap(s),
        AnchorBody::Note(s) => s.clone(),
    }
}

/// Render a `HistoryReport` as an XML string.
pub fn render_xml(report: &HistoryReport) -> String {
    let mut out = String::new();
    for c in &report.commits {
        out.push_str(&format!(
            "<commit hash=\"{}\" date=\"{}\" summary=\"{}\">\n",
            xml_attr_escape(&c.hash),
            xml_attr_escape(&c.date),
            xml_attr_escape(&c.summary),
        ));
        if let Some(why) = &c.why {
            out.push_str(&format!("<why>{}</why>\n", cdata_wrap(why)));
        }
        for a in &c.anchors {
            match a.event {
                Event::Removed => {
                    out.push_str(&format!(
                        "<anchor path=\"{}\" event=\"removed\"/>\n",
                        xml_attr_escape(&a.address)
                    ));
                }
                Event::Added | Event::Modified => {
                    let body = a
                        .content
                        .as_ref()
                        .map(render_body_xml)
                        .unwrap_or_default();
                    out.push_str(&format!(
                        "<anchor path=\"{}\" event=\"{}\">{}</anchor>\n",
                        xml_attr_escape(&a.address),
                        a.event.as_str(),
                        body,
                    ));
                }
            }
        }
        out.push_str("</commit>\n");
    }

    if let Some(cur) = &report.current {
        out.push_str("<current>\n");
        if let Some(why) = &cur.why {
            out.push_str(&format!("<why>{}</why>\n", cdata_wrap(why)));
        }
        for a in &cur.anchors {
            match &a.content {
                None => {
                    out.push_str(&format!(
                        "<anchor path=\"{}\" status=\"{}\"/>\n",
                        xml_attr_escape(&a.address),
                        xml_attr_escape(&a.status),
                    ));
                }
                Some(body) => {
                    out.push_str(&format!(
                        "<anchor path=\"{}\" status=\"{}\">{}</anchor>\n",
                        xml_attr_escape(&a.address),
                        xml_attr_escape(&a.status),
                        render_body_xml(body),
                    ));
                }
            }
        }
        out.push_str("</current>\n");
    }

    out
}

/// Render a `HistoryReport` as a `serde_json::Value`.
pub fn render_json(report: &HistoryReport) -> Value {
    let commits: Vec<Value> = report
        .commits
        .iter()
        .map(|c| {
            let mut obj = serde_json::Map::new();
            obj.insert("hash".into(), json!(c.hash));
            obj.insert("date".into(), json!(c.date));
            obj.insert("summary".into(), json!(c.summary));
            if let Some(why) = &c.why {
                obj.insert("why".into(), json!(why));
            }
            let anchors: Vec<Value> = c
                .anchors
                .iter()
                .map(|a| {
                    let mut ao = serde_json::Map::new();
                    ao.insert("path".into(), json!(a.address));
                    ao.insert("event".into(), json!(a.event.as_str()));
                    // Removed anchors carry no content key.
                    if a.event != Event::Removed
                        && let Some(body) = &a.content
                    {
                        ao.insert("content".into(), json!(body.text()));
                    }
                    Value::Object(ao)
                })
                .collect();
            obj.insert("anchors".into(), json!(anchors));
            Value::Object(obj)
        })
        .collect();

    let mut root = serde_json::Map::new();
    root.insert("schema_version".into(), json!(1));
    root.insert("mesh".into(), json!(report.mesh));
    root.insert("commits".into(), json!(commits));

    if let Some(cur) = &report.current {
        let mut co = serde_json::Map::new();
        if let Some(why) = &cur.why {
            co.insert("why".into(), json!(why));
        }
        let anchors: Vec<Value> = cur
            .anchors
            .iter()
            .map(|a| {
                let mut ao = serde_json::Map::new();
                ao.insert("path".into(), json!(a.address));
                ao.insert("status".into(), json!(a.status));
                if let Some(body) = &a.content {
                    ao.insert("content".into(), json!(body.text()));
                }
                Value::Object(ao)
            })
            .collect();
        co.insert("anchors".into(), json!(anchors));
        root.insert("current".into(), Value::Object(co));
    }

    Value::Object(root)
}
