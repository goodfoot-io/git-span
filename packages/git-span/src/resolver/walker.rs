//! HEAD-history walker. Translates an anchored `(path, line-anchor)` from
//! its anchor commit forward through `anchor..HEAD` by replaying each
//! commit's name-status and hunk diffs against the tracked location.

use crate::git;
use crate::resolver::session::BlobOidMemo;
use crate::types::CopyDetection;
use crate::{Error, Result};
use similar::{ChangeTag, TextDiff};
use std::str::FromStr;

#[derive(Clone, Debug)]
pub(crate) struct Tracked {
    pub(crate) path: String,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

pub(crate) enum Change {
    Unchanged,
    Deleted,
    Updated(Tracked),
}

pub(crate) const RENAME_BUDGET_DEFAULT: usize = 1000;

pub(crate) fn rename_budget() -> usize {
    std::env::var("GIT_SPAN_RENAME_BUDGET")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(RENAME_BUDGET_DEFAULT)
}

/// Advance the tracked location across one commit, given the
/// already-computed name-status entries for `(parent, commit)`. This is
/// the shared-session entry point — phase 1 callers pass pre-computed
/// deltas instead of re-running `name_status` per anchor.
///
/// `blob_oid_memo` is an optional session-scoped cache for
/// `(commit_sha, path) → blob_oid`. When provided, `compute_new_range`
/// looks up blob OIDs from the memo before falling back to tree
/// traversal, and populates the memo on miss. This eliminates redundant
/// `path_blob_at` calls when multiple anchors share the same commit ×
/// path combination within a single `drift` run.
pub(crate) fn advance_with_entries(
    repo: &gix::Repository,
    parent: &str,
    commit: &str,
    loc: &Tracked,
    entries: &[NS],
    blob_oid_memo: Option<&mut BlobOidMemo>,
) -> Result<Change> {
    let mut next_path: Option<String> = None;
    let mut deleted = false;
    let mut modified = false;
    for e in entries {
        match e {
            NS::Added { path } | NS::Modified { path } => {
                if path == &loc.path {
                    modified = true;
                    next_path = Some(loc.path.clone());
                }
            }
            NS::Deleted { path } => {
                if path == &loc.path {
                    deleted = true;
                }
            }
            NS::Renamed { from, to } => {
                if from == &loc.path {
                    next_path = Some(to.clone());
                    modified = true;
                    deleted = false;
                }
            }
            NS::Copied { from, to } => {
                if from == &loc.path {
                    next_path = Some(to.clone());
                    modified = true;
                }
            }
        }
    }
    if deleted {
        if let Some(p) = next_path {
            let (s, e) = compute_new_range(repo, parent, commit, loc, &p, blob_oid_memo)?;
            return Ok(Change::Updated(Tracked {
                path: p,
                start: s,
                end: e,
            }));
        }
        return Ok(Change::Deleted);
    }
    if !modified {
        return Ok(Change::Unchanged);
    }
    let p = next_path.unwrap_or_else(|| loc.path.clone());
    let (s, e) = compute_new_range(repo, parent, commit, loc, &p, blob_oid_memo)?;
    Ok(Change::Updated(Tracked {
        path: p,
        start: s,
        end: e,
    }))
}

/// Look up the blob OID for `path` at `commit`, using `memo` as a
/// session-scoped cache to avoid repeated tree traversals for the same
/// `(commit, path)` pair across multiple anchors.
fn blob_oid_at(
    repo: &gix::Repository,
    commit: &str,
    path: &str,
    memo: Option<&mut BlobOidMemo>,
) -> Option<String> {
    if let Some(m) = memo {
        if let Some(cached) = m.get(commit).and_then(|by_path| by_path.get(path)) {
            return cached.clone();
        }
        let oid = git::path_blob_at(repo, commit, path).ok();
        m.entry(commit.to_string())
            .or_default()
            .insert(path.to_string(), oid.clone());
        oid
    } else {
        git::path_blob_at(repo, commit, path).ok()
    }
}

pub(crate) fn compute_new_range(
    repo: &gix::Repository,
    parent: &str,
    commit: &str,
    loc: &Tracked,
    new_path: &str,
    mut blob_oid_memo: Option<&mut BlobOidMemo>,
) -> Result<(u32, u32)> {
    // Resolve blob OIDs, using the session-scoped memo when available to
    // avoid redundant tree traversals when multiple anchors share the same
    // (commit, path) combination within a single drift run.
    let old_blob_oid = blob_oid_at(repo, parent, &loc.path, blob_oid_memo.as_deref_mut());
    let new_blob_oid = blob_oid_at(repo, commit, new_path, blob_oid_memo);

    let old_text = blob_text_present(repo, old_blob_oid.as_deref(), parent, &loc.path)?;
    let new_text = blob_text_present(repo, new_blob_oid.as_deref(), commit, new_path)?;
    let hunks = compute_hunks(&old_text, &new_text);

    Ok(apply_hunks_to_range(&hunks, loc.start, loc.end))
}

/// Read one side of a remap diff as UTF-8 text.
///
/// `None` means the path has no blob at that side of the diff (the file was
/// added or deleted), where empty text is the honest representation. A
/// *present* blob that cannot be read back as UTF-8 — binary content, a
/// legacy encoding, a corrupt object — is never collapsed to empty text:
/// doing so fabricates a full-file insert/delete whose hunk math shifts
/// every tracked range by whole-file lengths while reporting success.
/// The read failure propagates instead (main-280).
///
/// One failure is not a failure: a gitlink (or tree) entry names an object
/// outside this repository's blob store — a submodule bump on a pinned
/// path. Its OID resolves in the tree but cannot be read here *by
/// design*, so that side is honestly empty and classification happens by
/// OID comparison upstream. The mode probe runs only on the failure path,
/// keeping the happy path one tree walk per side.
pub(crate) fn blob_text_present(
    repo: &gix::Repository,
    blob_oid: Option<&str>,
    commit: &str,
    path: &str,
) -> Result<String> {
    let Some(oid) = blob_oid else {
        return Ok(String::new());
    };
    match git::read_git_text(repo, oid) {
        Ok(text) => Ok(text),
        Err(read_err) => match git::path_entry_mode_at(repo, commit, path)? {
            Some(mode) if !mode.is_blob_or_symlink() => Ok(String::new()),
            _ => Err(Error::Git(format!("read `{path} @ {commit}`: {read_err}"))),
        },
    }
}

pub(crate) fn compute_hunks(old: &str, new: &str) -> Vec<(u32, u32, u32, u32)> {
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    let diff = TextDiff::from_slices(&a, &b);
    let mut hunks: Vec<(u32, u32, u32, u32)> = Vec::new();
    let mut cur_old_start: Option<usize> = None;
    let mut cur_new_start: Option<usize> = None;
    let mut cur_oc: u32 = 0;
    let mut cur_nc: u32 = 0;
    let mut next_old_line: usize = 1;
    let mut next_new_line: usize = 1;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                if cur_old_start.is_some() || cur_new_start.is_some() {
                    let os = cur_old_start.unwrap_or(next_old_line.saturating_sub(1));
                    let ns = cur_new_start.unwrap_or(next_new_line.saturating_sub(1));
                    let (emitted_os, emitted_ns) = if cur_oc == 0 {
                        (next_old_line.saturating_sub(1), ns)
                    } else if cur_nc == 0 {
                        (os, next_new_line.saturating_sub(1))
                    } else {
                        (os, ns)
                    };
                    hunks.push((emitted_os as u32, cur_oc, emitted_ns as u32, cur_nc));
                    cur_old_start = None;
                    cur_new_start = None;
                    cur_oc = 0;
                    cur_nc = 0;
                }
                next_old_line += 1;
                next_new_line += 1;
            }
            ChangeTag::Delete => {
                if cur_old_start.is_none() {
                    cur_old_start = Some(next_old_line);
                }
                cur_oc += 1;
                next_old_line += 1;
            }
            ChangeTag::Insert => {
                if cur_new_start.is_none() {
                    cur_new_start = Some(next_new_line);
                }
                cur_nc += 1;
                next_new_line += 1;
            }
        }
    }
    if cur_old_start.is_some() || cur_new_start.is_some() {
        let os = cur_old_start.unwrap_or(next_old_line.saturating_sub(1));
        let ns = cur_new_start.unwrap_or(next_new_line.saturating_sub(1));
        let (emitted_os, emitted_ns) = if cur_oc == 0 {
            (next_old_line.saturating_sub(1), ns)
        } else if cur_nc == 0 {
            (os, next_new_line.saturating_sub(1))
        } else {
            (os, ns)
        };
        hunks.push((emitted_os as u32, cur_oc, emitted_ns as u32, cur_nc));
    }
    hunks
}

pub(crate) fn apply_hunks_to_range(
    hunks: &[(u32, u32, u32, u32)],
    start: u32,
    end: u32,
) -> (u32, u32) {
    let mut s = start as i64;
    let mut e = end as i64;
    for (os, oc, _ns, nc) in hunks {
        let os = *os as i64;
        let oc = *oc as i64;
        let nc = *nc as i64;
        let delta = nc - oc;
        if oc == 0 {
            if os < s {
                s += delta;
                e += delta;
            } else if os >= e {
                // no effect
            } else {
                e += delta;
            }
            continue;
        }
        let old_last = os + oc - 1;
        if old_last < s {
            s += delta;
            e += delta;
        } else if os > e {
            // no effect
        } else {
            let new_last = if nc == 0 { os } else { os + nc - 1 };
            s = (s.min(os)).max(1);
            e = new_last.max(e + delta);
        }
    }
    let s = s.max(1) as u32;
    let e = e.max(s as i64) as u32;
    (s, e)
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) enum NS {
    Added { path: String },
    Modified { path: String },
    Deleted { path: String },
    Renamed { from: String, to: String },
    Copied { from: String, to: String },
}

pub(crate) fn name_status(
    repo: &gix::Repository,
    parent: &str,
    commit: &str,
    copy_detection: CopyDetection,
    warnings: &mut Vec<String>,
) -> Result<Vec<NS>> {
    let parent_oid = gix::ObjectId::from_str(parent)
        .map_err(|e| Error::Git(format!("parse parent oid: {e}")))?;
    let commit_oid = gix::ObjectId::from_str(commit)
        .map_err(|e| Error::Git(format!("parse commit oid: {e}")))?;
    let parent_commit = repo
        .find_commit(parent_oid)
        .map_err(|e| Error::Git(format!("find parent: {e}")))?;
    let commit_obj = repo
        .find_commit(commit_oid)
        .map_err(|e| Error::Git(format!("find commit: {e}")))?;
    let parent_tree = parent_commit
        .tree()
        .map_err(|e| Error::Git(format!("parent tree: {e}")))?;
    let new_tree = commit_obj
        .tree()
        .map_err(|e| Error::Git(format!("commit tree: {e}")))?;
    let budget = rename_budget();

    // Phase 3: a single tree-diff pass with rewrite tracking enabled.
    // The "no-rewrites" view is derived by splitting each Renamed/Copied
    // into its Added(+Deleted) parts; that matches the entry count the
    // cheap pass would have produced and lets us honor the budget without
    // running the diff twice.
    let mut entries = collect_changes(&parent_tree, &new_tree, copy_detection, true)?;
    let no_rewrites_len = derived_no_rewrites_count(&entries);
    if no_rewrites_len > budget {
        warnings.push(format!(
            "warning: rename detection disabled (--no-renames) for HEAD walk {}..{}; {} > GIT_SPAN_RENAME_BUDGET={}",
            &parent[..parent.len().min(8)],
            &commit[..commit.len().min(8)],
            no_rewrites_len,
            budget,
        ));
        return Ok(project_to_no_rewrites(entries));
    }

    // For AnyFileInCommit and AnyFileInRepo, run a widened similarity
    // search for added paths that were not already paired by the first pass.
    // Clone entries snapshot for use as first_pass so the mutable borrow is
    // separate from the snapshot borrow.
    match copy_detection {
        CopyDetection::Off | CopyDetection::SameCommit => {}
        CopyDetection::AnyFileInCommit => {
            let snapshot = entries.clone();
            widen_copies_in_commit(repo, &new_tree, &snapshot, &mut entries, commit, parent)?;
        }
        CopyDetection::AnyFileInRepo => {
            let snapshot = entries.clone();
            let _ = widen_copies_any_ref(
                repo,
                &new_tree,
                &snapshot,
                &mut entries,
                commit,
                parent,
                warnings,
            )?;
        }
    }

    Ok(entries)
}

/// Project a rewrite-tracked entry list to its "no-rewrites" equivalent.
/// `Renamed{from,to}` → `Deleted{from}` + `Added{to}`. `Copied{from,to}`
/// → `Added{to}` (the source path is unchanged in this commit, so no
/// `Deleted` row).
fn project_to_no_rewrites(entries: Vec<NS>) -> Vec<NS> {
    let mut out: Vec<NS> = Vec::with_capacity(entries.len() + 1);
    for e in entries {
        match e {
            NS::Renamed { from, to } => {
                out.push(NS::Deleted { path: from });
                out.push(NS::Added { path: to });
            }
            NS::Copied { from: _, to } => {
                out.push(NS::Added { path: to });
            }
            other => out.push(other),
        }
    }
    out
}

/// Count entries as the no-rewrites pass would: a Renamed pair counts as
/// 2 (Add + Delete) and a Copied counts as 1 (Add). Modifications,
/// Additions, Deletions count as 1 each.
fn derived_no_rewrites_count(entries: &[NS]) -> usize {
    let mut n = 0;
    for e in entries {
        match e {
            NS::Renamed { .. } => n += 2,
            _ => n += 1,
        }
    }
    n
}

/// Result of the AnyFileInRepo widening attempt.
enum WidenResult {
    Done,
    FellBack,
}

/// Collect all blob paths from `tree` into a `Vec<(path, blob_oid_string)>`.
pub(crate) fn tree_blob_paths(tree: &gix::Tree<'_>) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    tree.traverse()
        .breadthfirst
        .files()
        .map_err(|e| Error::Git(format!("tree traverse: {e}")))?
        .into_iter()
        .for_each(|entry| {
            let path = entry.filepath.to_string();
            let oid = entry.oid.to_string();
            out.push((path, oid));
        });
    Ok(out)
}

/// Collect every entry path present in `tree` — blobs, directories,
/// symlinks, and gitlinks alike — via one breadth-first traversal.
///
/// Entry-universe proof: `crate::git::tree_entry_at` resolves through
/// `gix`'s per-component tree lookup (`Tree::lookup_entry_by_path` ->
/// `gix_object::tree::next_entry`), which returns `Some(entry)` for the
/// final path component once the component iterator is exhausted,
/// regardless of that entry's `EntryMode` — a directory-only path is a
/// legitimate `Some`. The `gix_traverse::tree::Recorder` used here (via
/// `.breadthfirst.files()`, whose name is misleading — it does not filter
/// by kind) records every entry the same way: `visit_tree` and
/// `visit_nontree` both push to `records`. So this function's output set
/// has exactly the same membership as `tree_entry_at(tree, path).is_some()`
/// for every path reachable from `tree`: a path that names a directory in
/// this tree is "taken" here just as it would be via a direct probe, so a
/// candidate that later becomes a file is still correctly excluded from
/// being treated as unclaimed.
pub(crate) fn tree_all_paths(tree: &gix::Tree<'_>) -> Result<std::collections::HashSet<String>> {
    let mut out = std::collections::HashSet::new();
    tree.traverse()
        .breadthfirst
        .files()
        .map_err(|e| Error::Git(format!("tree traverse: {e}")))?
        .into_iter()
        .for_each(|entry| {
            out.insert(entry.filepath.to_string());
        });
    Ok(out)
}

/// Collect all blob paths from every ref's tree, deduped by blob OID.
/// Returns `(path, blob_oid)` pairs with unique blob OIDs.
fn all_ref_blob_paths(repo: &gix::Repository) -> Result<Vec<(String, String)>> {
    use std::collections::HashSet;
    let mut seen_oids: HashSet<String> = HashSet::new();
    let mut out: Vec<(String, String)> = Vec::new();

    let refs = repo
        .references()
        .map_err(|e| Error::Git(format!("refs: {e}")))?;
    let all = refs
        .all()
        .map_err(|e| Error::Git(format!("refs all: {e}")))?;

    for r in all {
        let mut r = match r {
            Ok(r) => r,
            Err(_) => continue,
        };
        let tip_id = match r.peel_to_id() {
            Ok(id) => id.detach(),
            Err(_) => continue,
        };
        // Try to peel to a tree (works for commit refs, skips tags to blobs etc.)
        let obj = match repo.find_object(tip_id) {
            Ok(o) => o,
            Err(_) => continue,
        };
        let tree = match obj.peel_to_tree() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let entries = tree_blob_paths(&tree).unwrap_or_default();
        for (path, oid) in entries {
            if seen_oids.insert(oid.clone()) {
                out.push((path, oid));
            }
        }
    }
    Ok(out)
}

/// Compute line-based Jaccard similarity between two text blobs.
/// Returns a value in [0.0, 1.0]. Uses multiset intersection/union of lines.
fn line_similarity(a: &str, b: &str) -> f64 {
    use std::collections::HashMap;
    let mut counts_a: HashMap<&str, i32> = HashMap::new();
    let mut counts_b: HashMap<&str, i32> = HashMap::new();
    for line in a.lines() {
        *counts_a.entry(line).or_default() += 1;
    }
    for line in b.lines() {
        *counts_b.entry(line).or_default() += 1;
    }
    let mut intersection = 0i32;
    let mut union = 0i32;
    for (line, &ca) in &counts_a {
        let cb = counts_b.get(line).copied().unwrap_or(0);
        intersection += ca.min(cb);
        union += ca.max(cb);
    }
    for (line, &cb) in &counts_b {
        if !counts_a.contains_key(line) {
            union += cb;
        }
    }
    if union == 0 {
        return 0.0;
    }
    intersection as f64 / union as f64
}

// ---------------------------------------------------------------------------
// Call counter for blob_text's ODB read attempt — used by the regression
// test for card main-283 (match_copies_from_pool re-read every candidate
// blob once per added path; the single-pass preload must pay ~one read per
// distinct pool blob instead of added×pool). Always compiled; the
// thread-local increment on a hot path has negligible cost.
// ---------------------------------------------------------------------------

thread_local! {
    static BLOB_TEXT_READ_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Reset the call counter.
pub(crate) fn reset_blob_text_read_count() {
    BLOB_TEXT_READ_COUNT.with(|c| c.set(0));
}

/// Read the call count.
pub(crate) fn blob_text_read_count() -> usize {
    BLOB_TEXT_READ_COUNT.with(|c| c.get())
}

/// Read a blob OID as text, returning empty string on failure.
fn blob_text(repo: &gix::Repository, blob_oid: &str) -> String {
    use std::str::FromStr;
    let Ok(oid) = gix::ObjectId::from_str(blob_oid) else {
        return String::new();
    };
    BLOB_TEXT_READ_COUNT.with(|c| c.set(c.get() + 1));
    let Ok(obj) = repo.find_object(oid) else {
        return String::new();
    };
    String::from_utf8(obj.into_blob().detach().data).unwrap_or_default()
}

/// Collect paths that are "added" in `entries` but not paired as a copy/rename source.
fn unpaired_added_paths(entries: &[NS]) -> Vec<String> {
    let mut paired: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in entries {
        match e {
            NS::Renamed { to, .. } | NS::Copied { to, .. } => {
                paired.insert(to.clone());
            }
            _ => {}
        }
    }
    entries
        .iter()
        .filter_map(|e| match e {
            NS::Added { path } if !paired.contains(path) => Some(path.clone()),
            _ => None,
        })
        .collect()
}

/// For each unpaired added path in the diff, search `candidates` for a source
/// blob with similarity >= 50%. If found, push a `NS::Copied` entry.
fn match_copies_from_pool(
    repo: &gix::Repository,
    commit: &str,
    added_paths: &[String],
    candidates: &[(String, String)], // (path, blob_oid)
    out: &mut Vec<NS>,
) -> Result<()> {
    // Build the blob OIDs for each added path in the new commit.
    let added_blobs: Vec<(String, String)> = added_paths
        .iter()
        .filter_map(|p| {
            git::path_blob_at(repo, commit, p)
                .ok()
                .map(|oid| (p.clone(), oid))
        })
        .collect();

    // Card main-283: preload each distinct candidate blob's text once,
    // before the added-path loop. The inner loop used to call `blob_text`
    // per (added path × candidate) pair — A×pool ODB reads per qualifying
    // commit under AnyFileInRepo — and re-tokenized each candidate every
    // time; now the pool costs ~pool reads regardless of A, and
    // comparisons run off shared `Arc<str>` handles (same convention as
    // the session's `blob_text_memo`). The session memo itself does not
    // fit here: it propagates read failures, while pool matching must keep
    // degrading an unreadable candidate (gitlink, non-UTF-8) to a skip.
    // Candidates whose text is empty or unreadable are simply absent from
    // this map, exactly the candidates the comparison loop used to skip.
    let mut texts_by_oid: std::collections::HashMap<&str, std::sync::Arc<str>> =
        std::collections::HashMap::with_capacity(candidates.len());
    let candidates: Vec<(&str, std::sync::Arc<str>)> = candidates
        .iter()
        .filter_map(|(cand_path, cand_blob_oid)| {
            if let Some(text) = texts_by_oid.get(cand_blob_oid.as_str()) {
                return Some((cand_path.as_str(), std::sync::Arc::clone(text)));
            }
            let text: std::sync::Arc<str> = std::sync::Arc::from(blob_text(repo, cand_blob_oid));
            if text.is_empty() {
                return None;
            }
            texts_by_oid.insert(cand_blob_oid.as_str(), std::sync::Arc::clone(&text));
            Some((cand_path.as_str(), text))
        })
        .collect();

    // For each added path, compare against the preloaded candidate texts.
    // Greedy: first candidate that beats threshold wins (stable ordering
    // from pool).
    for (added_path, added_blob_oid) in &added_blobs {
        let added_text = blob_text(repo, added_blob_oid);
        if added_text.is_empty() {
            continue;
        }
        let mut best_sim = 0.0f64;
        let mut best_src: Option<&str> = None;
        for (cand_path, cand_text) in &candidates {
            // Skip if candidate is the same path as the added file.
            // (Identical blob OIDs from different paths are valid copy sources.)
            if *cand_path == added_path.as_str() {
                continue;
            }
            let sim = line_similarity(cand_text, &added_text);
            if sim >= 0.5 && sim > best_sim {
                best_sim = sim;
                best_src = Some(cand_path);
            }
        }
        if let Some(src) = best_src {
            out.push(NS::Copied {
                from: src.to_string(),
                to: added_path.clone(),
            });
        }
    }
    Ok(())
}

/// Widen copy detection to every path in `new_tree` (AnyFileInCommit).
fn widen_copies_in_commit(
    repo: &gix::Repository,
    new_tree: &gix::Tree<'_>,
    first_pass: &[NS],
    out: &mut Vec<NS>,
    commit: &str,
    _parent: &str,
) -> Result<()> {
    let added_paths = unpaired_added_paths(first_pass);
    if added_paths.is_empty() {
        return Ok(());
    }
    // Pool: all blobs in new_tree not already in the added set.
    let added_set: std::collections::HashSet<&str> =
        added_paths.iter().map(|s| s.as_str()).collect();
    let pool: Vec<(String, String)> = tree_blob_paths(new_tree)?
        .into_iter()
        .filter(|(path, _)| !added_set.contains(path.as_str()))
        .collect();
    match_copies_from_pool(repo, commit, &added_paths, &pool, out)
}

/// Widen copy detection to every blob in any ref (AnyFileInRepo).
/// Falls back to AnyFileInCommit if the pool exceeds the budget.
fn widen_copies_any_ref(
    repo: &gix::Repository,
    new_tree: &gix::Tree<'_>,
    first_pass: &[NS],
    out: &mut Vec<NS>,
    commit: &str,
    parent: &str,
    warnings: &mut Vec<String>,
) -> Result<WidenResult> {
    let added_paths = unpaired_added_paths(first_pass);
    if added_paths.is_empty() {
        return Ok(WidenResult::Done);
    }
    let budget = rename_budget();
    let pool = all_ref_blob_paths(repo)?;
    if pool.len() > budget {
        warnings.push(format!(
            "warning: AnyFileInRepo copy pool ({} blobs) exceeds GIT_SPAN_RENAME_BUDGET={}; falling back to AnyFileInCommit for HEAD walk {}..{}",
            pool.len(),
            budget,
            &parent[..parent.len().min(8)],
            &commit[..commit.len().min(8)],
        ));
        widen_copies_in_commit(repo, new_tree, first_pass, out, commit, parent)?;
        return Ok(WidenResult::FellBack);
    }
    let added_set: std::collections::HashSet<&str> =
        added_paths.iter().map(|s| s.as_str()).collect();
    let pool_filtered: Vec<(String, String)> = pool
        .into_iter()
        .filter(|(path, _)| !added_set.contains(path.as_str()))
        .collect();
    match_copies_from_pool(repo, commit, &added_paths, &pool_filtered, out)?;
    Ok(WidenResult::Done)
}

fn collect_changes<'a>(
    parent_tree: &gix::Tree<'a>,
    new_tree: &gix::Tree<'a>,
    copy_detection: CopyDetection,
    track_rewrites: bool,
) -> Result<Vec<NS>> {
    let mut platform = parent_tree
        .changes()
        .map_err(|e| Error::Git(format!("tree changes: {e}")))?;
    platform.options(|opts| {
        let want_copies = !matches!(copy_detection, CopyDetection::Off);
        if track_rewrites {
            opts.track_path().track_rewrites(Some(gix::diff::Rewrites {
                copies: if want_copies {
                    Some(gix::diff::rewrites::Copies::default())
                } else {
                    None
                },
                percentage: Some(0.5),
                limit: 1000,
                track_empty: false,
            }));
        } else {
            opts.track_path().track_rewrites(None);
        }
    });
    let mut out = Vec::new();
    platform
        .for_each_to_obtain_tree(new_tree, |change| -> Result<std::ops::ControlFlow<()>> {
            use gix::object::tree::diff::Change as DC;
            match change {
                DC::Addition { location, .. } => out.push(NS::Added {
                    path: location.to_string(),
                }),
                DC::Deletion { location, .. } => out.push(NS::Deleted {
                    path: location.to_string(),
                }),
                DC::Modification { location, .. } => out.push(NS::Modified {
                    path: location.to_string(),
                }),
                DC::Rewrite {
                    source_location,
                    location,
                    copy,
                    ..
                } => {
                    if copy {
                        out.push(NS::Copied {
                            from: source_location.to_string(),
                            to: location.to_string(),
                        });
                    } else {
                        out.push(NS::Renamed {
                            from: source_location.to_string(),
                            to: location.to_string(),
                        });
                    }
                }
            }
            Ok(std::ops::ControlFlow::Continue(()))
        })
        .map_err(|e| Error::Git(format!("tree diff: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    use std::process::Command;
    use tempfile::tempdir;

    fn run_git(dir: &std::path::Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Unit test: verifies that `name_status` with `AnyFileInCommit` produces a
    /// `NS::Copied` entry when b.ts copies content from an unmodified a.ts.
    #[test]
    fn widen_any_file_in_commit_produces_copied_entry() {
        let td = tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);

        let content: String = (1..=20).map(|i| format!("content_line_{i}\n")).collect();
        std::fs::write(dir.join("a.ts"), &content).unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
        let parent = String::from_utf8(
            Command::new("git")
                .current_dir(dir)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        std::fs::write(dir.join("b.ts"), &content).unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "add b.ts"]);
        let commit = String::from_utf8(
            Command::new("git")
                .current_dir(dir)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        let repo = gix::open(dir).unwrap();
        let mut warnings = Vec::new();
        let entries = name_status(
            &repo,
            &parent,
            &commit,
            crate::types::CopyDetection::AnyFileInCommit,
            &mut warnings,
        )
        .unwrap();

        let has_copied = entries
            .iter()
            .any(|e| matches!(e, NS::Copied { from, to } if from == "a.ts" && to == "b.ts"));
        assert!(
            has_copied,
            "Expected Copied{{from=a.ts,to=b.ts}}; entries count={}, warnings={:?}",
            entries.len(),
            warnings
        );
    }

    /// Regression (main-283): pool matching must read each distinct
    /// candidate blob once per call, not once per (added path × candidate)
    /// pair. The fixture copies 3 files out of a 5-file pool, so the
    /// pre-fix inner loop paid 3×5=15 candidate reads plus 3 added-side
    /// reads; the single-pass preload pays 5+3, i.e. ~pool size
    /// regardless of A. Both widening modes funnel into the same
    /// `match_copies_from_pool`, so `AnyFileInCommit` pins the shared
    /// codepath.
    #[test]
    fn wide_copy_pool_reads_each_candidate_once() {
        let td = tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);

        // Pool: five distinct 20-line blobs.
        for i in 1..=5 {
            let content: String = (1..=20).map(|j| format!("c{i}_line_{j}\n")).collect();
            std::fs::write(dir.join(format!("c{i}.txt")), &content).unwrap();
        }
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "pool"]);
        let parent = rev_parse(dir, "HEAD");

        // Three exact copies out of that pool. The sources are unmodified
        // in this commit, so phase-1 rewrite tracking cannot pair them and
        // the widened pool search is what attributes the copies.
        for i in 1..=3 {
            let content = std::fs::read_to_string(dir.join(format!("c{i}.txt"))).unwrap();
            std::fs::write(dir.join(format!("a{i}.txt")), &content).unwrap();
        }
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "wide copy"]);
        let commit = rev_parse(dir, "HEAD");

        let repo = gix::open(dir).unwrap();
        reset_blob_text_read_count();
        let mut warnings = Vec::new();
        let entries = name_status(
            &repo,
            &parent,
            &commit,
            crate::types::CopyDetection::AnyFileInCommit,
            &mut warnings,
        )
        .unwrap();

        // Behavior is unchanged: every added file is attributed to its
        // exact-copy source.
        for i in 1..=3 {
            let src = format!("c{i}.txt");
            let dst = format!("a{i}.txt");
            assert!(
                entries
                    .iter()
                    .any(|e| matches!(e, NS::Copied { from, to } if from == &src && to == &dst)),
                "expected Copied{{from={src},to={dst}}}; entries count={}; warnings={warnings:?}",
                entries.len(),
            );
        }

        // Counter evidence: 5 distinct candidate reads + 3 added-side
        // reads. The pre-fix inner loop paid 3×5 + 3 = 18 here, and
        // A×pool + A in general.
        assert_eq!(
            blob_text_read_count(),
            8,
            "candidate texts must be preloaded once (~pool size), not re-read per added path"
        );
    }

    fn rev_parse(dir: &std::path::Path, rev: &str) -> String {
        String::from_utf8(
            Command::new("git")
                .current_dir(dir)
                .args(["rev-parse", rev])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string()
    }

    /// Regression (main-280): a commit replacing an anchored file's blob
    /// with non-UTF-8 content must fail the remap instead of degrading the
    /// new side to empty text — which fabricated a full-file insert and
    /// shifted every tracked range by whole-file lengths while reporting
    /// success.
    #[test]
    fn non_utf8_blob_fails_remap_fail_closed() {
        let td = tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);

        let utf8_content: String = (1..=10).map(|i| format!("line_{i}\n")).collect();
        std::fs::write(dir.join("f.txt"), &utf8_content).unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "utf8"]);
        let parent = rev_parse(dir, "HEAD");

        let binary: Vec<u8> = [vec![0xFF, 0xFE, b'\n'], vec![0x80, 0x81, b'\n']].concat();
        std::fs::write(dir.join("f.txt"), &binary).unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "binary"]);
        let commit = rev_parse(dir, "HEAD");

        let repo = gix::open(dir).unwrap();
        let loc = Tracked {
            path: "f.txt".to_string(),
            start: 5,
            end: 7,
        };
        let err = compute_new_range(&repo, &parent, &commit, &loc, "f.txt", None)
            .expect_err("non-UTF-8 blob must fail the remap");
        let msg = err.to_string();
        assert!(
            msg.contains("utf-8") && msg.contains("f.txt"),
            "error must name the file and the decode failure: {msg}"
        );
    }

    /// A gitlink side (pinned submodule bumped by a *committed* SHA change)
    /// names an object in another repository: legitimately unreadable here,
    /// so the remap stays silent and unmoved instead of failing closed.
    #[test]
    fn committed_gitlink_bump_is_empty_side_not_an_error() {
        let td = tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);

        // Inner repository whose commits become gitlink targets.
        let inner = td.path().join("inner");
        std::fs::create_dir(&inner).unwrap();
        run_git(&inner, &["init", "--initial-branch=main"]);
        run_git(&inner, &["config", "user.email", "t@t"]);
        run_git(&inner, &["config", "user.name", "t"]);
        run_git(&inner, &["config", "commit.gpgsign", "false"]);
        std::fs::write(inner.join("f.txt"), b"v1\n").unwrap();
        run_git(&inner, &["add", "."]);
        run_git(&inner, &["commit", "-m", "v1"]);
        let sha1 = rev_parse(&inner, "HEAD");
        std::fs::write(inner.join("f.txt"), b"v2\n").unwrap();
        run_git(&inner, &["add", "."]);
        run_git(&inner, &["commit", "-m", "v2"]);
        let sha2 = rev_parse(&inner, "HEAD");

        // Stage the gitlink twice in the outer repo.
        run_git(
            dir,
            &["update-index", "--add", "--cacheinfo", &format!("160000,{sha1},sub")],
        );
        run_git(dir, &["commit", "-m", "pin submodule"]);
        let parent = rev_parse(dir, "HEAD");
        run_git(
            dir,
            &["update-index", "--add", "--cacheinfo", &format!("160000,{sha2},sub")],
        );
        run_git(dir, &["commit", "-m", "bump submodule"]);
        let commit = rev_parse(dir, "HEAD");

        let repo = gix::open(dir).unwrap();
        let loc = Tracked {
            path: "sub".to_string(),
            start: 1,
            end: 1,
        };
        let range =
            compute_new_range(&repo, &parent, &commit, &loc, "sub", None)
                .expect("gitlink bump must not fail the remap");
        assert_eq!(range, (1, 1), "no comparable content: position unmoved");
    }

    /// Guard for `blob_text_present`: a genuinely absent blob (the file is
    /// added by this commit) is still honestly empty on the old side — the
    /// fail-closed rule covers present-but-unreadable blobs only.
    #[test]
    fn absent_old_blob_side_remains_empty_text() {
        let td = tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);

        std::fs::write(dir.join("other.txt"), b"unrelated\n").unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
        let parent = rev_parse(dir, "HEAD");

        std::fs::write(dir.join("f.txt"), b"a\nb\nc\n").unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "add f.txt"]);
        let commit = rev_parse(dir, "HEAD");

        let repo = gix::open(dir).unwrap();
        let loc = Tracked {
            path: "f.txt".to_string(),
            start: 1,
            end: 2,
        };
        // Old side absent → no error; the range math itself is unchanged
        // behavior for added files.
        assert!(compute_new_range(&repo, &parent, &commit, &loc, "f.txt", None).is_ok());
    }
}
