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
    /// `true` when the rendered timeline is a scoped/partial view of history:
    /// `--limit` or `--since` dropped older mesh-touching commits that exist
    /// before the window. The first shown commit still diffs against the true
    /// prior mesh state (so its events stay truthful), but a consumer must not
    /// read the window as the complete record.
    pub scoped: bool,
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
            // Fail-closed: a plumbing error in the ancestry check must abort,
            // not silently drop the commit from the timeline.
            if crate::git::is_ancestor(repo, &since_oid, &c.hash).map_err(|e| CliError {
                subcommand: "history",
                summary: format!("could not test `--since {since}` ancestry for commit {}.", c.hash),
                what_happened: format!("{e}"),
                next_steps: vec![NextStep::Prose(
                    "Pass a valid commit-ish or date (e.g. a SHA, tag, or `HEAD~5`).".into(),
                )],
            })? {
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

    let mut report = {
        let _perf = crate::perf::span("history.build-report");
        build_report(repo, &args.mesh, mesh_root, walk_complete, &commits)?
    };

    // `--limit 0` (and `--since` cutting every commit) yields an empty window
    // for a mesh that nonetheless exists in history — an empty timeline must
    // not read as "this mesh has no history". `build_report` cannot see the
    // window was non-empty before scoping, so flag it here.
    if commits.is_empty() && (args.limit == Some(0) || args.since.is_some()) {
        report.scoped = true;
    }

    // Fail-closed in spirit: a scoped/partial window must never read as the
    // complete record. Unlike the walk-budget truncation (an internal limit,
    // exit non-zero), `--limit`/`--since` are explicit user scopes, so we still
    // render and exit 0 — but warn to stderr that older mesh history exists
    // before the window. The first shown commit's events are already truthful
    // (seeded from real prior state); this warning prevents a consumer reading
    // stdout alone as the whole timeline.
    if report.scoped {
        eprintln!(
            "warning: history is scoped — `--limit`/`--since` dropped older commits; \
             this is a partial timeline, not the complete record"
        );
    }

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

    // Seed the diff baseline from the true mesh state at the commit immediately
    // before the window. When `--limit`/`--since` dropped older commits, the
    // oldest shown commit must diff against real prior state — otherwise every
    // anchor already present there is mislabeled `added` and an earlier
    // unchanged `why` is re-emitted. A non-empty seed also means the window is a
    // strict prefix-truncation of history → `scoped`.
    let (mut prev, scoped) = match commits.first() {
        Some(oldest) => seed_prior_state(repo, mesh_name, mesh_root, &oldest.hash)?,
        None => (None, false),
    };

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
        scoped,
        commits: sections,
        current,
    })
}

/// Compute the rendered mesh state at the commit immediately before the window
/// (the first parent of `oldest_hash`), to seed the diff baseline truthfully.
///
/// Returns `(Some(state), true)` when a mesh-touching prior state exists — the
/// window is a strict prefix-truncation of history, so the first shown commit
/// diffs against real prior state and the report is flagged `scoped`. Returns
/// `(None, false)` when `oldest_hash` is the true history root for this mesh
/// (no parent, or the mesh did not exist at the parent), i.e. a genuine
/// first-appearance window that is the complete record from the mesh's birth.
fn seed_prior_state(
    repo: &gix::Repository,
    mesh_name: &str,
    mesh_root: &str,
    oldest_hash: &str,
) -> Result<(Option<RenderedState>, bool)> {
    // Resolve the parent to a bare OID: `read_mesh_at_in` accepts a revspec,
    // but the per-anchor body reads (`path_blob_at`) require a 40-hex OID, so a
    // raw `<hash>~1` would fail blob lookup and degrade every anchor to a note
    // (spuriously diffing as `modified`). A root commit has no parent →
    // `resolve_commit` errors → genuine first appearance.
    let parent = match crate::git::resolve_commit(repo, &format!("{oldest_hash}~1")) {
        Ok(oid) => oid,
        Err(_) => return Ok((None, false)),
    };
    match read_mesh_at_in(repo, mesh_name, Some(&parent), mesh_root) {
        Ok(mesh) => Ok((Some(rendered_state_at(repo, &parent, &mesh)), true)),
        // `MeshNotFound` here covers both "no parent (root commit)" — an
        // unresolvable `<hash>~1` makes `tree_entry_at` yield `Ok(None)` →
        // `MeshNotFound` — and "the mesh file is absent at the parent". Either
        // way the oldest shown commit is the mesh's true first appearance.
        Err(crate::Error::MeshNotFound(_)) => Ok((None, false)),
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

/// Build the address string for a resolved anchor location.
fn location_address(loc: &crate::types::AnchorLocation) -> String {
    let path = loc.path.to_string_lossy();
    match loc.extent {
        AnchorExtent::LineRange { start, end } => {
            format_anchor_address(&path, Some(start), Some(end))
        }
        AnchorExtent::WholeFile => format_anchor_address(&path, None, None),
    }
}

/// Build the optional `current` section by running the same stale/resolver
/// engine `git mesh stale` uses, so the two commands agree on which anchors
/// drift, the human drift phrase, and the live content rendered.
///
/// The section is emitted when any of the card's three triggers fire:
///   1. the engine reports a non-`Fresh` `AnchorStatus` for any HEAD anchor
///      (committed-but-not-re-anchored source drift, a relocated `moved`
///      anchor, an uncommitted edit, a deletion, …),
///   2. an uncommitted `--why` prose edit, or
///   3. a worktree anchor-set change (an anchor added to, or removed from, the
///      mesh file in the working tree relative to HEAD): a worktree-added
///      anchor resolves as `Fresh` (its stored hash just matched) and is
///      skipped by the resolver guard in trigger 1, so it is detected here by
///      set-diffing the worktree and HEAD anchor addresses; a worktree-removed
///      anchor is absent from the worktree mesh entirely so the resolver never
///      sees it — likewise detected by set-diff.
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

    // Uncommitted why change (trigger 2).
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

    // Resolve the live mesh through the same engine `git mesh stale` uses:
    // worktree-over-index-over-HEAD, with the staged-mesh layer included so a
    // worktree anchor-set change is visible. Each non-Fresh anchor becomes one
    // `CurrentAnchor`; its status is verbatim `format_drift_label` and its
    // content is the engine's resolved live location (the relocated block for a
    // `moved` anchor), never a slice of the stored line range.
    //
    // NOTE: a worktree-ADDED anchor resolves as `Fresh` (its stored hash was
    // just computed from the live content) → the guard below skips it. Trigger
    // 3 catches it separately by comparing the anchor-address sets.
    let options = crate::types::EngineOptions {
        layers: crate::types::LayerSet::full(),
        ignore_unavailable: false,
        since: None,
        needs_all_layers: true,
    };
    let names = [mesh_name.to_string()];
    let resolved = crate::resolver::resolve_named_meshes(repo, mesh_root, &names, options)?;

    // Collect the addresses already emitted by the resolver pass (trigger 1)
    // so trigger-3 anchors are not double-emitted.
    let mut resolver_addresses: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    let mut anchors: Vec<CurrentAnchor> = Vec::new();
    for (_name, result) in resolved {
        let mesh = match result {
            Ok(m) => m,
            // A worktree-only mesh (no committed ref) still resolves; a genuine
            // not-found surfaces nothing for this anchor pass.
            Err(crate::Error::MeshNotFound(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        for r in &mesh.anchors {
            if r.status == crate::types::AnchorStatus::Fresh {
                continue;
            }
            let status = crate::cli::drift_label::format_drift_label(
                &r.status,
                r.source,
                r.locus.as_ref(),
                r.current.is_some(),
            );
            // Address keys off the anchored (stored) location so it matches the
            // mesh's recorded anchor; the resolved `current` location carries
            // the live content (and the relocated path/range when `moved`).
            let address = location_address(&r.anchored);
            resolver_addresses.insert(address.clone());
            let content = r.current.as_ref().map(|loc| {
                let text = crate::cli::stale_output::read_location_text(repo, loc);
                AnchorBody::Text(text)
            });
            anchors.push(CurrentAnchor {
                address,
                status,
                content,
            });
        }
    }

    // Trigger 3: detect anchors added to or removed from the worktree mesh
    // relative to HEAD. These are not surfaced by the resolver pass above.
    {
        // Build address sets for both sides (empty when the mesh is absent).
        let head_addrs: Vec<String> = head
            .as_ref()
            .map(|m| m.anchors.iter().map(|(_id, a)| anchor_address(a)).collect())
            .unwrap_or_default();
        let work_addrs: Vec<String> = work
            .as_ref()
            .map(|m| m.anchors.iter().map(|(_id, a)| anchor_address(a)).collect())
            .unwrap_or_default();

        let head_set: std::collections::HashSet<&str> =
            head_addrs.iter().map(String::as_str).collect();
        let work_set: std::collections::HashSet<&str> =
            work_addrs.iter().map(String::as_str).collect();

        // Worktree-added anchors: present in worktree but not in HEAD, and not
        // already emitted by the resolver pass.
        for addr in &work_addrs {
            if !head_set.contains(addr.as_str()) && !resolver_addresses.contains(addr) {
                // Read the live content from the worktree for this anchor.
                let content = work.as_ref().and_then(|m| {
                    m.anchors
                        .iter()
                        .find(|(_id, a)| &anchor_address(a) == addr)
                        .map(|(_id, a)| {
                            // Build an AnchorLocation pointing at the worktree
                            // (no blob oid = read from filesystem) and reuse the
                            // shared `read_location_text` helper.
                            let loc = crate::types::AnchorLocation {
                                path: std::path::PathBuf::from(&a.path),
                                extent: a.extent,
                                blob: None,
                            };
                            let text =
                                crate::cli::stale_output::read_location_text(repo, &loc);
                            AnchorBody::Text(text)
                        })
                });
                anchors.push(CurrentAnchor {
                    address: addr.clone(),
                    status: "added in the working tree".to_string(),
                    content,
                });
            }
        }

        // Worktree-removed anchors: present in HEAD but not in worktree (and
        // not already emitted by the resolver pass).
        for addr in &head_addrs {
            if !work_set.contains(addr.as_str()) && !resolver_addresses.contains(addr) {
                anchors.push(CurrentAnchor {
                    address: addr.clone(),
                    status: "removed in the working tree".to_string(),
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
    if report.scoped {
        out.push_str("<scoped/>\n");
    }
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
    if report.scoped {
        root.insert("scoped".into(), json!(true));
    }
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
