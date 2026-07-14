//! Git plumbing helpers.
//!
//! Thin typed wrappers around `gix`. These are the only place in the
//! crate that talks to git directly; the rest of the crate stays on
//! typed results via [`crate::Result`].

use crate::{Error, Result};
use std::path::Path;
use std::str::FromStr;

use gix::ObjectId;

fn parse_oid(hex: &str) -> Result<ObjectId> {
    ObjectId::from_str(hex).map_err(|e| Error::Git(format!("invalid oid `{hex}`: {e}")))
}

// ---------------------------------------------------------------------------
// Primitive gix helpers.
// ---------------------------------------------------------------------------

pub(crate) fn work_dir(repo: &gix::Repository) -> Result<&Path> {
    repo.workdir()
        .ok_or_else(|| Error::Git("bare repositories are not supported".into()))
}

/// Per-repository git directory. For a linked worktree this resolves
/// to `<main-git-dir>/worktrees/<id>` rather than `<workdir>/.git`,
/// which in a worktree is a pointer file (not a directory). All
/// `span/` filesystem state must be anchored here, not under the
/// workdir's `.git`.
pub(crate) fn git_dir(repo: &gix::Repository) -> &Path {
    repo.git_dir()
}

/// Common (shared) git directory. For a linked worktree this points at
/// the main repository's `.git/`, where shared state like `config` and
/// `lfs/objects/` lives.
pub(crate) fn common_dir(repo: &gix::Repository) -> &Path {
    repo.common_dir()
}

/// Shared cache directory rooted at the common git directory.
/// For the main worktree, `common_dir == git_dir`, so the path is identical
/// to `git_dir().join("span").join("cache")` — no path change for the main
/// worktree.  For linked worktrees, `common_dir` points at the main `.git/`,
/// so all worktrees converge on one physical directory.
pub(crate) fn cache_dir(repo: &gix::Repository) -> std::path::PathBuf {
    common_dir(repo).join("span").join("cache")
}

/// Resolve `HEAD` to a commit OID.
pub(crate) fn head_oid(repo: &gix::Repository) -> Result<String> {
    let id = repo
        .head_id()
        .map_err(|e| Error::Git(format!("resolve HEAD: {e}")))?;
    Ok(id.detach().to_string())
}

// ---------------------------------------------------------------------------
// git_log_name_only — history channel helper for the suggest detector.
// ---------------------------------------------------------------------------

/// One commit's hash and the set of paths changed by it (vs its first parent).
///
/// Mirrors the JS `{ hash, files }` shape in `loadGitHistory`.
#[derive(Clone, Debug)]
pub struct CommitChanges {
    pub hash: String,
    /// Paths changed in this commit relative to its first parent.
    /// For the root commit the parent is the empty tree.
    pub changed_paths: Vec<String>,
}

/// Walk HEAD's first `n` ancestors (no-merges) via `gix` and return each
/// commit's changed paths via tree-to-tree diff against its first parent.
///
/// Equivalent to `git log --name-only --no-merges -n N --pretty=format:commit:%H`
/// but implemented entirely via the `gix` library.
///
/// Results are in git-log order (most recent first). Merge commits are excluded.
pub fn git_log_name_only(repo: &gix::Repository, n: usize) -> Result<Vec<CommitChanges>> {
    let head_id = repo
        .head_id()
        .map_err(|e| Error::Git(format!("resolve HEAD: {e}")))?
        .detach();

    let walk = repo
        .rev_walk([head_id])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(|e| Error::Git(format!("rev walk: {e}")))?;

    let mut out = Vec::with_capacity(n.min(512));

    for info in walk {
        if out.len() >= n {
            break;
        }
        let info = info.map_err(|e| Error::Git(format!("rev walk next: {e}")))?;
        let commit = repo
            .find_commit(info.id)
            .map_err(|e| Error::Git(format!("find commit {}: {e}", info.id)))?;

        // Skip merge commits (more than one parent) — matches `--no-merges`.
        let parent_ids: Vec<_> = commit.parent_ids().map(|p| p.detach()).collect();
        if parent_ids.len() > 1 {
            continue;
        }

        let new_tree = commit
            .tree()
            .map_err(|e| Error::Git(format!("commit tree {}: {e}", info.id)))?;

        let old_tree = match parent_ids.first() {
            Some(pid) => match repo.find_commit(*pid) {
                Ok(parent) => parent.tree().unwrap_or_else(|_| repo.empty_tree()),
                Err(_) => repo.empty_tree(),
            },
            None => repo.empty_tree(),
        };

        // Disable rename tracking — we only want which paths changed,
        // not rename pairing (matches `git log --name-only` defaults).
        let mut opts = gix::diff::Options::default();
        opts.track_rewrites(None);

        let changes = repo
            .diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(opts))
            .map_err(|e| Error::Git(format!("diff tree {}: {e}", info.id)))?;

        let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for change in &changes {
            use gix::object::tree::diff::ChangeDetached;
            match change {
                ChangeDetached::Addition {
                    location,
                    entry_mode,
                    ..
                }
                | ChangeDetached::Deletion {
                    location,
                    entry_mode,
                    ..
                } => {
                    // Only record blob entries; skip tree/directory entries.
                    if !entry_mode.is_blob_or_symlink() {
                        continue;
                    }
                    paths.insert(
                        std::str::from_utf8(location.as_slice())
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
                ChangeDetached::Modification {
                    location,
                    entry_mode,
                    ..
                } => {
                    if !entry_mode.is_blob_or_symlink() {
                        continue;
                    }
                    paths.insert(
                        std::str::from_utf8(location.as_slice())
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
                ChangeDetached::Rewrite {
                    source_location,
                    source_entry_mode,
                    location,
                    entry_mode,
                    ..
                } => {
                    if source_entry_mode.is_blob_or_symlink() {
                        paths.insert(
                            std::str::from_utf8(source_location.as_slice())
                                .unwrap_or_default()
                                .to_string(),
                        );
                    }
                    if entry_mode.is_blob_or_symlink() {
                        paths.insert(
                            std::str::from_utf8(location.as_slice())
                                .unwrap_or_default()
                                .to_string(),
                        );
                    }
                }
            }
        }

        out.push(CommitChanges {
            hash: info.id.to_string(),
            changed_paths: paths.into_iter().collect(),
        });
    }

    Ok(out)
}

/// Walk HEAD's first-parent chain and return only commits whose changed-path
/// set intersects `seed_paths`, up to `n` qualifying commits.
///
/// Equivalent to `git log --name-only --no-merges -- <seed_paths>` but
/// implemented entirely via `gix`.  Unlike `git_log_name_only`, the walk
/// stops as soon as `n` **qualifying** commits have been collected, so the
/// caller receives at most `n` entries.
///
/// Results are in git-log order (most recent first). Merge commits are excluded.
///
/// # Why this is path-targeted, not a full tree diff
///
/// A given commit qualifies iff one of the (few) `seed_paths` changed between
/// it and its first parent. Diffing the *whole* tree of each commit pair —
/// reading every subtree object across the repo — to then keep only the seed
/// paths is enormously wasteful: with `n = usize::MAX` (the `history` default)
/// the walk must visit every reachable commit to confirm the rest do not
/// qualify, so the per-commit cost is multiplied by the entire history. On a
/// fuse filesystem that full-tree-diff scan dominated `git span history`
/// (~97% of wall-clock). Instead we look up each seed path's blob OID in the
/// commit's tree and its first parent's tree and compare: a path changed iff
/// the OIDs differ, where "absent" (no entry, including the root commit's
/// empty-tree parent) is its own distinct state. This reads at most a handful
/// of tree objects along each seed path's directory chain per commit instead
/// of the whole tree, and is byte-for-byte equivalent to `git log -- <paths>`
/// for which commits qualify (rename tracking is off in both, so a rename is
/// seen as the delete+add of its endpoints — matching the prior full-diff
/// behavior with `track_rewrites(None)`).
pub fn git_log_name_only_for_paths(
    repo: &gix::Repository,
    n: usize,
    seed_paths: &[String],
) -> Result<(Vec<CommitChanges>, bool)> {
    if n == 0 || seed_paths.is_empty() {
        return Ok((Vec::new(), true));
    }

    let seed_paths: Vec<&str> = seed_paths.iter().map(|p| p.as_str()).collect();

    let head_id = repo
        .head_id()
        .map_err(|e| Error::Git(format!("resolve HEAD: {e}")))?
        .detach();

    let walk = repo
        .rev_walk([head_id])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(|e| Error::Git(format!("rev walk: {e}")))?;

    let mut out: Vec<CommitChanges> = Vec::with_capacity(n.min(512));
    let budget_start = std::time::Instant::now();
    // Safety valve for pathological histories only. The walk normally
    // terminates by exhausting the (small) qualifying-commit set or hitting
    // the `n` cap long before this fires. The budget must stay well clear of
    // the worst-case cost of a *small* history so a complete walk is never
    // truncated to `walk_complete = false` merely because the host is busy:
    // `gix` tree lookups on Windows under parallel test load are ~10-25x slower
    // than the Linux baseline this was originally tuned against, and a
    // spuriously incomplete walk silently disables the history cache and
    // degrades suggestions. 8s still bounds genuinely huge repos.
    let budget = std::time::Duration::from_secs(8);

    /// Look up the blob OID at `path` in `tree`. Returns `None` when the path is
    /// absent or does not resolve to a blob/symlink (a directory at that path is
    /// treated as "no blob here", matching the prior diff's blob-only filter).
    fn blob_oid_at(tree: &gix::Tree<'_>, path: &str) -> Option<ObjectId> {
        // `lookup_entry_by_path` clones the tree's data internally; it is the
        // same primitive `tree_entry_at`/`read_span_at_in` use.
        let entry = tree.clone().lookup_entry_by_path(Path::new(path)).ok()??;
        if entry.mode().is_blob_or_symlink() {
            Some(entry.object_id())
        } else {
            None
        }
    }

    for info in walk {
        if out.len() >= n {
            break;
        }
        if budget_start.elapsed() > budget {
            return Ok((out, false));
        }
        let info = info.map_err(|e| Error::Git(format!("rev walk next: {e}")))?;
        let commit = repo
            .find_commit(info.id)
            .map_err(|e| Error::Git(format!("find commit {}: {e}", info.id)))?;

        // Skip merge commits (more than one parent) — matches `--no-merges`.
        let parent_ids: Vec<_> = commit.parent_ids().map(|p| p.detach()).collect();
        if parent_ids.len() > 1 {
            continue;
        }

        let new_tree = commit
            .tree()
            .map_err(|e| Error::Git(format!("commit tree {}: {e}", info.id)))?;

        let old_tree = match parent_ids.first() {
            Some(pid) => match repo.find_commit(*pid) {
                Ok(parent) => parent.tree().unwrap_or_else(|_| repo.empty_tree()),
                Err(_) => repo.empty_tree(),
            },
            None => repo.empty_tree(),
        };

        // A seed path changed at this commit iff its blob OID differs between
        // the commit's tree and its first parent's tree. Present↔absent and
        // blob↔blob-with-different-content both register as a change; a path
        // unchanged on both sides registers as no change. This is the per-path
        // restriction of the old full-tree diff's Addition/Deletion/Modification
        // verdict.
        let mut changed: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for &path in &seed_paths {
            if blob_oid_at(&new_tree, path) != blob_oid_at(&old_tree, path) {
                changed.insert(path.to_string());
            }
        }

        if changed.is_empty() {
            continue;
        }

        out.push(CommitChanges {
            hash: info.id.to_string(),
            changed_paths: changed.into_iter().collect(),
        });
    }

    Ok((out, true))
}

/// Walk `HEAD`'s ancestry (newest-first) and return up to `max` ancestor
/// commit hashes, **excluding `HEAD` itself** (card main-157 Phase 4B).
///
/// Every returned commit is reachable from `HEAD`, so `HEAD` is a descendant
/// of each — the soundness precondition the incremental path relies on: for a
/// path whose blob is identical between an ancestor's tree and `HEAD`'s tree,
/// and which no intervening commit on the `ancestor..HEAD` range touched, an
/// anchor's history walk yields the same classification at `HEAD` as it did at
/// the ancestor. The walk is bounded so the ancestor search stays cheap; past
/// `max` commits back the incremental path degrades to a full resolve (which
/// republishes a generation nearby again).
pub fn head_ancestors(repo: &gix::Repository, max: usize) -> Result<Vec<String>> {
    if max == 0 {
        return Ok(Vec::new());
    }
    let head_id = repo
        .head_id()
        .map_err(|e| Error::Git(format!("resolve HEAD: {e}")))?
        .detach();
    let walk = repo
        .rev_walk([head_id])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(|e| Error::Git(format!("rev walk: {e}")))?;
    let mut out = Vec::with_capacity(max.min(128));
    for info in walk {
        let info = info.map_err(|e| Error::Git(format!("rev walk next: {e}")))?;
        if info.id == head_id {
            continue; // exclude HEAD itself; candidates are strictly earlier
        }
        out.push(info.id.to_string());
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}

/// The set of source paths whose blob differs between two commits' trees
/// (card main-157 Phase 4B). Rename tracking is **off** — a committed rename
/// registers as the delete+add of both its endpoints, so both paths land in
/// the changed set. This matches the relocation semantics of
/// `resolver/engine/anchor.rs`'s `find_relocated_range_in_paths`
/// (`track_rewrites(None)`), which is what the incremental affected-set
/// computation must be consistent with.
///
/// Only blob/symlink entries are reported; tree (directory) entries are
/// skipped, matching `git_log_name_only`'s filter.
pub fn changed_paths_between(
    repo: &gix::Repository,
    from_commit: &str,
    to_commit: &str,
) -> Result<std::collections::BTreeSet<String>> {
    let from_tree = commit_tree(repo, from_commit)?;
    let to_tree = commit_tree(repo, to_commit)?;

    let mut opts = gix::diff::Options::default();
    opts.track_rewrites(None);

    let changes = repo
        .diff_tree_to_tree(Some(&from_tree), Some(&to_tree), Some(opts))
        .map_err(|e| Error::Git(format!("diff tree {from_commit}..{to_commit}: {e}")))?;

    let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for change in &changes {
        use gix::object::tree::diff::ChangeDetached;
        match change {
            ChangeDetached::Addition {
                location,
                entry_mode,
                ..
            }
            | ChangeDetached::Deletion {
                location,
                entry_mode,
                ..
            }
            | ChangeDetached::Modification {
                location,
                entry_mode,
                ..
            } => {
                if entry_mode.is_blob_or_symlink() {
                    paths.insert(
                        std::str::from_utf8(location.as_slice())
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
            }
            ChangeDetached::Rewrite {
                source_location,
                source_entry_mode,
                location,
                entry_mode,
                ..
            } => {
                if source_entry_mode.is_blob_or_symlink() {
                    paths.insert(
                        std::str::from_utf8(source_location.as_slice())
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
                if entry_mode.is_blob_or_symlink() {
                    paths.insert(
                        std::str::from_utf8(location.as_slice())
                            .unwrap_or_default()
                            .to_string(),
                    );
                }
            }
        }
    }
    Ok(paths)
}

/// Peel a commit hash to its tree object.
fn commit_tree<'repo>(
    repo: &'repo gix::Repository,
    commit_oid: &str,
) -> Result<gix::Tree<'repo>> {
    let oid = parse_oid(commit_oid)?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| Error::Git(format!("find commit `{commit_oid}`: {e}")))?;
    commit
        .tree()
        .map_err(|e| Error::Git(format!("commit tree `{commit_oid}`: {e}")))
}

/// Extracted commit metadata.
#[derive(Clone, Debug)]
pub(crate) struct CommitMeta {
    pub author_date_rfc2822: String,
    pub summary: String,
}

pub(crate) fn commit_meta(repo: &gix::Repository, commit_oid: &str) -> Result<CommitMeta> {
    let oid = parse_oid(commit_oid)?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| Error::Git(format!("find commit `{commit_oid}`: {e}")))?;
    let decoded = commit
        .decode()
        .map_err(|e| Error::Git(format!("decode commit: {e}")))?;
    let author_sig = decoded
        .author()
        .map_err(|e| Error::Git(format!("author: {e}")))?;
    let author_time = author_sig
        .time()
        .map_err(|e| Error::Git(format!("author time: {e}")))?;
    let message = decoded.message.to_string();
    let summary = message.lines().next().unwrap_or("").to_string();
    Ok(CommitMeta {
        author_date_rfc2822: format_rfc2822(author_time),
        summary,
    })
}

fn format_rfc2822(t: gix::date::Time) -> String {
    // Produce `Thu, 1 Jan 1970 00:00:00 +0000` style matching `git show --format=%aD`.
    use chrono::{DateTime, FixedOffset};
    let secs = t.seconds;
    let offset_secs = t.offset;
    let fixed =
        FixedOffset::east_opt(offset_secs).unwrap_or_else(|| FixedOffset::east_opt(0).unwrap());
    let dt_utc = DateTime::from_timestamp(secs, 0)
        .unwrap_or_else(|| DateTime::from_timestamp(0, 0).unwrap());
    let dt: DateTime<FixedOffset> = dt_utc.with_timezone(&fixed);
    dt.format("%a, %-d %b %Y %H:%M:%S %z").to_string()
}

/// Is `anchor` reachable from `HEAD` only?
///
/// Used by the resolver's orphaned-classification gate: per the drift-label
/// spec, an anchor commit is "orphaned" relative to HEAD when HEAD's history
/// no longer contains it, regardless of whether other refs still keep it
/// alive (e.g. `refs/heads/main` after a `checkout --orphan`).
pub(crate) fn commit_reachable_from_head(repo: &gix::Repository, anchor: &str) -> Result<bool> {
    let anchor_id = match parse_oid(anchor) {
        Ok(id) => id,
        Err(_) => return Ok(false),
    };
    let head_id = match repo.head_id() {
        Ok(id) => id.detach(),
        Err(_) => return Ok(false),
    };
    if head_id == anchor_id {
        return Ok(true);
    }
    match repo.merge_base(head_id, anchor_id) {
        Ok(base) => Ok(base.detach() == anchor_id),
        Err(_) => Ok(false),
    }
}

/// Create a commit object (without updating any ref) and return its hex OID.
///
/// Uses the repository's configured author/committer; callers/tests that need
/// a fixed identity should set `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env vars,
/// which gix honors.
pub fn create_commit(
    repo: &gix::Repository,
    tree_oid: &str,
    message: &str,
    parents: &[String],
) -> Result<String> {
    let tree = parse_oid(tree_oid)?;
    let parent_ids: Vec<ObjectId> = parents
        .iter()
        .map(|p| parse_oid(p))
        .collect::<Result<_>>()?;
    let commit = repo
        .new_commit(message, tree, parent_ids)
        .map_err(|e| Error::Git(format!("create commit: {e}")))?;
    Ok(commit.id.to_string())
}

pub(crate) fn read_blob_bytes(repo: &gix::Repository, blob_oid: &str) -> Result<Vec<u8>> {
    blob_data(repo, blob_oid)
}

fn blob_data(repo: &gix::Repository, blob_oid: &str) -> Result<Vec<u8>> {
    let oid = parse_oid(blob_oid)?;
    let obj = repo
        .find_object(oid)
        .map_err(|e| Error::Git(format!("find object `{blob_oid}`: {e}")))?;
    Ok(obj.into_blob().detach().data)
}

// ---------------------------------------------------------------------------
// Typed public helpers (Slice B signatures).
// ---------------------------------------------------------------------------

/// Read a blob object as UTF-8 text (anchor records, config blobs, etc).
pub fn read_git_text(repo: &gix::Repository, oid: &str) -> Result<String> {
    let data = blob_data(repo, oid)?;
    String::from_utf8(data).map_err(|e| Error::Parse(format!("object not utf-8: {e}")))
}

/// Resolve a commit-ish to a full commit OID.
///
/// Errors are curated at this boundary so the upstream `gix-revision`
/// `Display` (which embeds `/.cargo/registry/.../gix-revision-x.y.z/src/...rs:NNN`)
/// never reaches CLI stderr. Callers prefix the originating flag (e.g.
/// `--since`, `--at`) themselves.
pub fn resolve_commit(repo: &gix::Repository, commit_ish: &str) -> Result<String> {
    let id = repo
        .rev_parse_single(commit_ish)
        .map_err(|e| Error::Git(curate_rev_parse_error(commit_ish, &e.to_string())))?;
    Ok(id.detach().to_string())
}

/// Translate the upstream `gix-revision` error string into a clean,
/// host-stable message. Recognized variants:
///
/// - `couldn't parse revision` → "not a valid revision"
/// - `delegate.traverse(NthAncestor(N))` → "has fewer than N ancestors"
/// - anything else → "could not resolve `<rev>`"
fn curate_rev_parse_error(commit_ish: &str, raw: &str) -> String {
    if let Some(after) = raw.split("NthAncestor(").nth(1)
        && let Some(num_str) = after.split(')').next()
        && let Ok(n) = num_str.parse::<u64>()
    {
        return format!("has fewer than {n} ancestors");
    }
    if raw.contains("couldn't parse revision") {
        return "not a valid revision".to_string();
    }
    format!("could not resolve `{commit_ish}`")
}

/// True if `ancestor` is an ancestor of `descendant` (or equal).
pub fn is_ancestor(repo: &gix::Repository, ancestor: &str, descendant: &str) -> Result<bool> {
    let ancestor_id = repo
        .rev_parse_single(ancestor)
        .map_err(|e| Error::Git(format!("rev-parse `{ancestor}`: {e}")))?
        .detach();
    let descendant_id = repo
        .rev_parse_single(descendant)
        .map_err(|e| Error::Git(format!("rev-parse `{descendant}`: {e}")))?
        .detach();
    if ancestor_id == descendant_id {
        return Ok(true);
    }
    match repo.merge_base(ancestor_id, descendant_id) {
        Ok(base) => Ok(base.detach() == ancestor_id),
        Err(_) => Ok(false),
    }
}

/// Read the blob OID of `path` at `commit_oid`'s tree.
pub fn path_blob_at(repo: &gix::Repository, commit_oid: &str, path: &str) -> Result<String> {
    let oid = parse_oid(commit_oid).map_err(|_| Error::PathNotInTree {
        path: path.to_string(),
        commit: commit_oid.to_string(),
    })?;
    let commit = repo.find_commit(oid).map_err(|_| Error::PathNotInTree {
        path: path.to_string(),
        commit: commit_oid.to_string(),
    })?;
    let mut tree = commit.tree().map_err(|_| Error::PathNotInTree {
        path: path.to_string(),
        commit: commit_oid.to_string(),
    })?;
    let entry = tree
        .peel_to_entry_by_path(Path::new(path))
        .map_err(|_| Error::PathNotInTree {
            path: path.to_string(),
            commit: commit_oid.to_string(),
        })?
        .ok_or_else(|| Error::PathNotInTree {
            path: path.to_string(),
            commit: commit_oid.to_string(),
        })?;
    Ok(entry.object_id().to_string())
}

/// Read file bytes from the working tree, relative to the repo root.
pub fn read_worktree_bytes(repo: &gix::Repository, path: &str) -> Result<Vec<u8>> {
    let wd = work_dir(repo)?;
    Ok(std::fs::read(wd.join(path))?)
}

/// Line count of `blob_oid`.
pub fn blob_line_count(repo: &gix::Repository, blob_oid: &str) -> Result<u32> {
    let data = blob_data(repo, blob_oid)?;
    let text =
        std::str::from_utf8(&data).map_err(|e| Error::Parse(format!("blob not utf-8: {e}")))?;
    Ok(text.lines().count() as u32)
}

/// Extract lines `[start, end]` (1-based inclusive) from a blob.
pub fn extract_blob_lines(
    repo: &gix::Repository,
    blob_oid: &str,
    start: u32,
    end: u32,
) -> Result<Vec<u8>> {
    let data = blob_data(repo, blob_oid)?;
    let text =
        std::str::from_utf8(&data).map_err(|e| Error::Parse(format!("blob not utf-8: {e}")))?;
    let lines: Vec<&str> = text.lines().collect();
    let lo = start.saturating_sub(1) as usize;
    let hi = (end as usize).min(lines.len());
    if lo > hi {
        return Err(Error::InvalidAnchor { start, end });
    }
    let mut out = String::new();
    for line in &lines[lo..hi] {
        out.push_str(line);
        out.push('\n');
    }
    Ok(out.into_bytes())
}

/// Placeholder for §5.1 per-commit `log -L` walker. Implemented inside
/// [`crate::resolver`] for now; kept here as an unimplemented hook.
pub fn log_l_resolve(
    _repo: &gix::Repository,
    _anchor_sha: &str,
    _path: &str,
    _start: u32,
    _end: u32,
    _copy_detection: crate::types::CopyDetection,
) -> Result<Option<(String, u32, u32, String)>> {
    // Resolver lives in stale.rs (ported from v1). This hook exists only
    // to preserve the Slice B signature.
    Err(Error::Git(
        "git::log_l_resolve is not used; call resolver::resolve_anchor".into(),
    ))
}

// ---------------------------------------------------------------------------
// Slice 1: shared gix helpers (replacements for `Command::new("git")`).
// ---------------------------------------------------------------------------

/// Resolve `commit_ish`, peel to its tree, and look up `path` within it.
///
/// Returns `Ok(None)` when `path` isn't present in the tree (matches the
/// "no row" semantics of `git ls-tree <sha> -- <path>` we are replacing).
/// Returns `Err` only for plumbing failures (bad commit-ish, unreadable
/// objects, ill-formed UTF-8 path components).
pub fn tree_entry_at(
    repo: &gix::Repository,
    commit_ish: &str,
    path: &Path,
) -> Result<Option<(gix::objs::tree::EntryMode, ObjectId)>> {
    let id = match repo.rev_parse_single(commit_ish) {
        Ok(id) => id,
        Err(_) => return Ok(None),
    };
    let object = id
        .object()
        .map_err(|e| Error::Git(format!("find object `{commit_ish}`: {e}")))?;
    let tree = object
        .peel_to_tree()
        .map_err(|e| Error::Git(format!("peel `{commit_ish}` to tree: {e}")))?;
    let entry = tree
        .lookup_entry_by_path(path)
        .map_err(|e| Error::Git(format!("lookup entry `{}`: {e}", path.display())))?;
    Ok(entry.map(|e| (e.mode(), e.object_id())))
}

/// Snapshot of an index entry used by callers that previously parsed
/// `git ls-files --stage` / `git ls-files -u -z` lines.
#[derive(Clone, Debug)]
pub struct IndexEntrySnapshot {
    pub mode: gix::objs::tree::EntryMode,
    pub oid: ObjectId,
    pub stage: gix::index::entry::Stage,
    pub path: String,
}

// ---------------------------------------------------------------------------
// Call counter for index_entries — used by the reproduction test for card
// main-105 (run_add re-reads git index per anchor). Always compiled; the
// atomic increment on a hot path has negligible cost.
// ---------------------------------------------------------------------------

static INDEX_ENTRIES_CALL_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Reset the call counter.
pub fn reset_index_entries_call_count() {
    INDEX_ENTRIES_CALL_COUNT.store(0, std::sync::atomic::Ordering::SeqCst);
}

/// Read the call counter.
pub fn index_entries_call_count() -> usize {
    INDEX_ENTRIES_CALL_COUNT.load(std::sync::atomic::Ordering::SeqCst)
}

/// Load the worktree index (or synthesize it from `HEAD^{tree}` if there
/// is no on-disk index yet) and return one snapshot per entry.
///
/// Returning owned snapshots keeps the borrow shape simple at call sites
/// that want to filter / collect without keeping the index file alive.
pub fn index_entries(repo: &gix::Repository) -> Result<Vec<IndexEntrySnapshot>> {
    INDEX_ENTRIES_CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    let idx = repo
        .index_or_load_from_head()
        .map_err(|e| Error::Git(format!("load index: {e}")))?;
    let state = &*idx;
    let mut out = Vec::with_capacity(state.entries().len());
    for entry in state.entries() {
        let mode = match gix::objs::tree::EntryMode::try_from(entry.mode.bits()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let path = entry.path(state).to_string();
        out.push(IndexEntrySnapshot {
            mode,
            oid: entry.id,
            stage: entry.stage(),
            path,
        });
    }
    Ok(out)
}

/// Check whether the index entry for `path` has the SKIP_WORKTREE flag set,
/// indicating the path is excluded by sparse-checkout and should not be
/// expected on disk.
pub(crate) fn is_skip_worktree(repo: &gix::Repository, path: &str) -> Result<bool> {
    let idx = repo
        .index_or_load_from_head()
        .map_err(|e| Error::Git(format!("load index: {e}")))?;
    let file = &*idx;
    for entry in file.entries() {
        if entry.path(file) == path {
            return Ok(entry.flags.contains(gix::index::entry::Flags::SKIP_WORKTREE));
        }
    }
    Ok(false)
}

/// Check whether the repository has promisor pack files (partial clone
/// markers in `objects/info/`), indicating that some blobs referenced by
/// the commit graph may not be locally available.
pub(crate) fn promisor_active(repo: &gix::Repository) -> bool {
    let od = common_dir(repo).join("objects");
    std::fs::read_dir(od.join("info"))
        .map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().starts_with("promisor")))
        .unwrap_or(false)
}

/// Compute the SHA-1 a blob with `bytes` would have, without writing it
/// (replaces `git hash-object [--stdin] <…>`).
pub fn hash_blob(bytes: &[u8]) -> Result<ObjectId> {
    gix::objs::compute_hash(gix::hash::Kind::Sha1, gix::objs::Kind::Blob, bytes)
        .map_err(|e| Error::Git(format!("hash-object: {e}")))
}

/// Resolve a single `.gitattributes` attribute for `rel_path` relative to
/// the repo's worktree root. Returns:
///
/// * `Ok(None)` when the attribute is unset / unspecified.
/// * `Ok(Some("set"))` for boolean-set attributes (`<attr>` or `<attr>=true`).
/// * `Ok(Some("<value>"))` for valued attributes.
///
/// The `binary` macro is expanded by `gix_attributes` automatically;
/// callers that need the macro itself should query `"binary"` directly.
pub fn attr_for(
    repo: &gix::Repository,
    rel_path: &Path,
    name: &str,
) -> Result<Option<gix::bstr::BString>> {
    crate::perf::record_attr_for_call();
    let index = repo
        .index_or_load_from_head()
        .map_err(|e| Error::Git(format!("load index: {e}")))?;
    let mut stack = repo
        .attributes(
            &index,
            gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
            gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped,
            None,
        )
        .map_err(|e| Error::Git(format!("attribute stack: {e}")))?;
    let mut outcome = stack.selected_attribute_matches([name]);
    let platform = stack
        .at_entry(rel_path, None)
        .map_err(|e| Error::Git(format!("attr at_entry `{}`: {e}", rel_path.display())))?;
    if !platform.matching_attributes(&mut outcome) {
        return Ok(None);
    }
    if let Some(m) = outcome.iter_selected().next() {
        return Ok(match m.assignment.state {
            gix::attrs::StateRef::Set => Some("set".into()),
            gix::attrs::StateRef::Unset => None,
            gix::attrs::StateRef::Value(v) => Some(v.as_bstr().to_owned()),
            gix::attrs::StateRef::Unspecified => None,
        });
    }
    Ok(None)
}

/// Whether `rel_path` matches a `.gitignore` exclude rule (pattern-only;
/// the index is not consulted, so a force-added *tracked* path that also
/// matches a pattern still reports `true` here — callers that care about
/// git's effective "would be excluded" semantics must additionally check
/// trackedness).
///
/// Mirrors `git check-ignore`'s pattern evaluation via gix's exclude
/// stack. Returns `Ok(false)` when the path matches no rule.
pub fn path_is_ignored(repo: &gix::Repository, rel_path: &Path) -> Result<bool> {
    let index = repo
        .index_or_load_from_head()
        .map_err(|e| Error::Git(format!("load index: {e}")))?;
    let mut stack = repo
        .excludes(
            &index,
            None,
            gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped,
        )
        .map_err(|e| Error::Git(format!("exclude stack: {e}")))?;
    let platform = stack
        .at_entry(rel_path, None)
        .map_err(|e| Error::Git(format!("exclude at_entry `{}`: {e}", rel_path.display())))?;
    Ok(platform.is_excluded())
}

/// Read a single config string by full key (e.g. `"filter.lfs.process"`).
pub fn config_string(repo: &gix::Repository, key: &str) -> Option<String> {
    repo.config_snapshot().string(key).map(|v| v.to_string())
}

#[cfg(test)]
mod gix_helper_tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) {
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

    fn seed_repo() -> (tempfile::TempDir, gix::Repository, String) {
        let td = tempfile::tempdir().unwrap();
        let dir = td.path();
        run_git(dir, &["init", "--initial-branch=main"]);
        run_git(dir, &["config", "user.email", "t@t"]);
        run_git(dir, &["config", "user.name", "t"]);
        run_git(dir, &["config", "commit.gpgsign", "false"]);
        std::fs::write(dir.join("a.txt"), "alpha\n").unwrap();
        std::fs::write(
            dir.join(".gitattributes"),
            "*.bin binary\n*.tx filter=foo\n",
        )
        .unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
        let head = String::from_utf8(
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
        crate::perf::record_gix_open();
        let repo = gix::open(dir).unwrap();
        (td, repo, head)
    }

    #[test]
    fn tree_entry_at_finds_blob() {
        let (_td, repo, head) = seed_repo();
        let entry = tree_entry_at(&repo, &head, Path::new("a.txt")).unwrap();
        let (_mode, oid) = entry.expect("a.txt should exist at HEAD");
        assert_eq!(oid.to_string().len(), 40);
    }

    #[test]
    fn tree_entry_at_missing_returns_none() {
        let (_td, repo, head) = seed_repo();
        let out = tree_entry_at(&repo, &head, Path::new("nope.txt")).unwrap();
        assert!(out.is_none());
    }

    #[test]
    fn index_entries_returns_committed_files() {
        let (_td, repo, _head) = seed_repo();
        let entries = index_entries(&repo).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"a.txt"));
        assert!(paths.contains(&".gitattributes"));
        assert!(
            entries
                .iter()
                .all(|e| e.stage == gix::index::entry::Stage::Unconflicted)
        );
    }

    #[test]
    fn hash_blob_matches_git() {
        let (td, _repo, _head) = seed_repo();
        let bytes = b"hello world\n";
        let oid = hash_blob(bytes).unwrap();
        use std::io::Write;
        let mut child = Command::new("git")
            .current_dir(td.path())
            .args(["hash-object", "--stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.as_mut().unwrap().write_all(bytes).unwrap();
        let res = child.wait_with_output().unwrap();
        let expected = String::from_utf8(res.stdout).unwrap().trim().to_string();
        assert_eq!(oid.to_string(), expected);
    }

    #[test]
    fn attr_for_reads_filter_and_binary() {
        let (_td, repo, _head) = seed_repo();
        std::fs::write(_td.path().join("x.tx"), "y").unwrap();
        std::fs::write(_td.path().join("y.bin"), [0u8, 1u8]).unwrap();
        let f = attr_for(&repo, Path::new("x.tx"), "filter").unwrap();
        assert_eq!(f.as_ref().map(|b| b.to_string()), Some("foo".to_string()));
        let b = attr_for(&repo, Path::new("y.bin"), "binary").unwrap();
        // `binary` is a macro; resolves as Set when it matches.
        assert_eq!(b.as_ref().map(|s| s.to_string()), Some("set".to_string()));
        let none = attr_for(&repo, Path::new("a.txt"), "filter").unwrap();
        assert!(none.is_none());
    }

    #[test]
    fn config_string_reads_value() {
        let (td, repo, _head) = seed_repo();
        run_git(
            td.path(),
            &["config", "filter.lfs.process", "git-lfs filter-process"],
        );
        crate::perf::record_gix_open();
        let repo = gix::open(repo.path()).unwrap();
        assert_eq!(
            config_string(&repo, "filter.lfs.process").as_deref(),
            Some("git-lfs filter-process"),
        );
        assert!(config_string(&repo, "no.such.key").is_none());
    }
}
