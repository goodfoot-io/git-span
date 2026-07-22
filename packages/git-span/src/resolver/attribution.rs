//! HEAD-source drift-locus attribution. Walks `anchor..HEAD` forward
//! along the anchored path and returns the first commit that mutates
//! the anchored byte range (`ChangedAt`), the commit that removes or
//! renames the path (`OrphanedAt`), or marks the anchor as unreachable
//! from HEAD.
//!
//! Only meaningful when the engine attributes drift to the HEAD layer
//! (`AnchorResolved.source == Some(DriftSource::Head)`); for shallower
//! sources the caller already has a layer-local label and this walk is
//! skipped.

use crate::Result;
use crate::git;
use crate::resolver::session::ConcurrentSession;
use crate::types::{AnchorExtent, AnchorResolved, DriftLocus, DriftSource};
use std::collections::HashMap;

/// Forward-walk `anchor..HEAD` along the anchored path and return the
/// `DriftLocus` that explains the drift. Returns `None` when
/// `resolved.source != Some(Head)` or the walk finds no overlapping
/// commit; the caller falls back on the per-layer label.
///
/// Every call computes the walk directly. The former per-resolution disk
/// cache (`resolver::cache`'s `drift_locus` kind) was removed in the
/// greenfield cutover — the SQLite store now caches at the whole-generation
/// level, so a per-`DriftLocus` disk tier is redundant. `session` still
/// carries the miss counter and the per-session deleted-locus memo the walk
/// populates for `Deleted` anchors.
pub(crate) fn drift_locus(
    repo: &gix::Repository,
    resolved: &AnchorResolved,
    session: &mut ConcurrentSession,
) -> Result<Option<DriftLocus>> {
    let _perf = crate::perf::span("attribution.drift-locus");

    // `Deleted` anchors go through the boundary-free backward walk (card
    // main-168), memoized per anchored path so every subsequent anchor
    // sharing a deleted path within this session reuses the first walk's
    // answer. This is checked ahead of the whole-file early-return and the
    // `anchor_sha` boundary below — both are meaningless for `Deleted`
    // (there is no boundary to walk from; see
    // `plans/bounded-rename-chain.md`).
    if resolved.status == crate::types::AnchorStatus::Deleted {
        let path = resolved.anchored.path.to_string_lossy().into_owned();
        if let Some(cached) = session.deleted_locus_memo.get(&path) {
            return Ok(cached.clone());
        }
        let locus = deleted_locus_walk(repo, &path)?;
        session.deleted_locus_memo.insert(path, locus.clone());
        return Ok(locus);
    }

    // The remaining walk applies only to HEAD-attributed drift
    // (Changed-in-HEAD); other layers carry their own per-layer label.
    if resolved.source != Some(DriftSource::Head) {
        return Ok(None);
    }

    // Whole-file anchors have no line range to attribute — exit early.
    let (anchored_start, anchored_end) = match resolved.anchored.extent {
        AnchorExtent::LineRange { start, end } => (start, end),
        AnchorExtent::WholeFile => return Ok(None),
    };

    let blob_oid = resolved
        .anchored
        .blob
        .map(|o| o.to_string())
        .unwrap_or_default();

    session.drift_locus_misses += 1;
    drift_locus_walk(repo, resolved, anchored_start, anchored_end, &blob_oid)
}

/// Perform the full forward walk.
fn drift_locus_walk(
    repo: &gix::Repository,
    resolved: &AnchorResolved,
    anchored_start: u32,
    anchored_end: u32,
    blob_oid: &str,
) -> Result<Option<DriftLocus>> {
    let head_hex = git::head_oid(repo)?;
    let head_id = match repo.rev_parse_single(head_hex.as_str()) {
        Ok(id) => id.detach(),
        Err(_) => return Ok(None),
    };
    let anchor_id = match repo.rev_parse_single(resolved.anchor_sha.as_str()) {
        Ok(id) => id.detach(),
        Err(_) => return Ok(None),
    };

    // Determine reachability and the anchor..HEAD walk in forward
    // (oldest-first) order. `rev_walk` is newest-first by default; collect
    // and reverse.
    let walk = match repo.rev_walk([head_id]).with_hidden([anchor_id]).all() {
        Ok(w) => w,
        Err(_) => return Ok(None),
    };
    let mut commits: Vec<gix::ObjectId> = Vec::new();
    for info in walk {
        match info {
            Ok(i) => commits.push(i.id),
            Err(_) => return Ok(None),
        }
    }
    if commits.is_empty() {
        // Anchor is at HEAD (or beyond): no commit on the path. The
        // caller should treat this as "no Head locus".
        return Ok(None);
    }
    commits.reverse();

    let anchored_text = git::read_git_text(repo, blob_oid).unwrap_or_default();
    let anchored_lines: Vec<&str> = anchored_text.lines().collect();
    let a_lo = (anchored_start as usize).saturating_sub(1);
    let a_hi = (anchored_end as usize).min(anchored_lines.len());
    let anchored_slice: Vec<&str> = if a_lo <= a_hi {
        anchored_lines[a_lo..a_hi].to_vec()
    } else {
        Vec::new()
    };

    // Track the path across renames as we step forward.
    let current_path = resolved.anchored.path.to_string_lossy().into_owned();

    // In-process blob-text memo: one read per OID per drift_locus call.
    let mut blob_text_memo: HashMap<gix::ObjectId, String> = HashMap::new();

    for commit_id in commits {
        let commit = match repo.find_commit(commit_id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let new_tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let parents: Vec<_> = commit.parent_ids().map(|p| p.detach()).collect();
        let old_tree = match parents.first() {
            Some(pid) => match repo.find_commit(*pid) {
                Ok(parent) => parent.tree().unwrap_or_else(|_| repo.empty_tree()),
                Err(_) => repo.empty_tree(),
            },
            None => repo.empty_tree(),
        };

        let mut opts = gix::diff::Options::default();
        opts.track_rewrites(Some(Default::default()));
        let changes = match repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(opts)) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let path_bytes = current_path.as_bytes();
        for change in changes.iter() {
            use gix::object::tree::diff::ChangeDetached;
            match change {
                ChangeDetached::Deletion { location, .. } => {
                    if location.as_slice() == path_bytes {
                        return Ok(Some(DriftLocus::OrphanedAt(commit_id)));
                    }
                }
                ChangeDetached::Rewrite {
                    source_location,
                    location,
                    ..
                } => {
                    if source_location.as_slice() == path_bytes {
                        // Rename of the anchored path: per §5, treat as
                        // orphan locus.
                        let _ = location;
                        return Ok(Some(DriftLocus::OrphanedAt(commit_id)));
                    }
                }
                ChangeDetached::Modification {
                    location,
                    previous_id,
                    id,
                    ..
                } => {
                    if location.as_slice() != path_bytes {
                        continue;
                    }
                    if range_overlaps_memo(
                        repo,
                        previous_id,
                        id,
                        &anchored_slice,
                        anchored_start,
                        anchored_end,
                        &mut blob_text_memo,
                    ) {
                        return Ok(Some(DriftLocus::ChangedAt(commit_id)));
                    }
                }
                ChangeDetached::Addition { location, id, .. } => {
                    // Addition can match when the path was previously
                    // removed and reintroduced. Compare the new blob's
                    // range against the anchored slice.
                    if location.as_slice() != path_bytes {
                        continue;
                    }
                    if range_overlaps_memo(
                        repo,
                        &gix::ObjectId::null(gix::hash::Kind::Sha1),
                        id,
                        &anchored_slice,
                        anchored_start,
                        anchored_end,
                        &mut blob_text_memo,
                    ) {
                        return Ok(Some(DriftLocus::ChangedAt(commit_id)));
                    }
                }
            }
        }
    }
    Ok(None)
}

/// Return `true` if the anchored byte range differs between two blobs.
/// The null OID is treated as empty content (used for synthetic
/// addition-from-nothing comparisons).
///
/// `blob_text_memo` is an in-process memo for the current `drift_locus_walk`
/// call that eliminates repeated git-object reads for the same OID.
fn range_overlaps_memo(
    repo: &gix::Repository,
    previous_id: &gix::ObjectId,
    id: &gix::ObjectId,
    anchored_slice: &[&str],
    anchored_start: u32,
    anchored_end: u32,
    blob_text_memo: &mut HashMap<gix::ObjectId, String>,
) -> bool {
    let prev_text = if previous_id.is_null() {
        String::new()
    } else {
        blob_text_memo
            .entry(*previous_id)
            .or_insert_with(|| {
                git::read_git_text(repo, &previous_id.to_string()).unwrap_or_default()
            })
            .clone()
    };
    let new_text = if id.is_null() {
        String::new()
    } else {
        blob_text_memo
            .entry(*id)
            .or_insert_with(|| git::read_git_text(repo, &id.to_string()).unwrap_or_default())
            .clone()
    };
    let prev_lines: Vec<&str> = prev_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();
    let lo = (anchored_start as usize).saturating_sub(1);
    let hi = anchored_end as usize;
    let prev_slice: &[&str] = if lo <= prev_lines.len() {
        &prev_lines[lo..hi.min(prev_lines.len())]
    } else {
        &[]
    };
    let new_slice: &[&str] = if lo <= new_lines.len() {
        &new_lines[lo..hi.min(new_lines.len())]
    } else {
        &[]
    };
    // If the new blob's slice equals the anchored slice, this commit did
    // not mutate the anchored content (e.g. it edited a different range
    // of the file). If the previous slice equals the new slice, the
    // commit changed only lines outside the anchored range.
    let anchored = anchored_slice;
    let new_eq_anchored = new_slice == anchored;
    let prev_eq_new = prev_slice == new_slice;
    !(new_eq_anchored || prev_eq_new)
}

// ---------------------------------------------------------------------------
// Deleted-locus walk (card main-168) — a boundary-free backward walk from
// HEAD that determines whether a `Deleted` anchor's last-known path was
// renamed (and to where) or genuinely removed. See
// `plans/bounded-rename-chain.md`'s "Deleted-locus walk" section for the
// full design and worked rename-chain trace.
//
// Phase 2 (card main-168 TDD bootstrap): these are contract stubs only —
// every body is `todo!()`. The tests below are the executable form of the
// spec against that contract; all are `#[ignore]`d and must never run in
// this phase. Phase 3 implements the real walk and unignores them.
// ---------------------------------------------------------------------------

/// Cap on rename-chain hops the terminal-path search will follow before
/// giving up and reporting "deleted" (fail-closed). Chosen generously above
/// any expected real-world rename chain depth; existence purely as a
/// defensive bound against pathological/adversarial histories (including a
/// rename cycle, which would otherwise never terminate on its own).
const MAX_RENAME_HOPS: u8 = 8;

/// What a `nearest_touching_commit` hit did to `path`, relative to that
/// commit's first parent.
#[derive(Debug, Clone, PartialEq, Eq)]
enum TouchKind {
    /// `path` was removed outright (no rewrite target).
    Deletion,
    /// `path` was the *source* of a rename; carries the destination path.
    Rewrite(String),
}

/// Determine why `path` (a `Deleted` anchor's last-known path) is absent
/// from HEAD. `commit_id` in the returned locus is always the anchor's OWN
/// orphaning commit — the nearest commit (walking HEAD backward) that
/// touched `path` itself — never a later hop's commit, even when the chain
/// that follows spans several more renames before reaching a path that
/// resolves at HEAD.
///
fn deleted_locus_walk(repo: &gix::Repository, path: &str) -> Result<Option<DriftLocus>> {
    let Some(commit_id) = nearest_touching_commit(repo, path)? else {
        return Ok(None); // history exhausted without a match: fail-closed
    };
    match classify_touching_commit(repo, commit_id, path)? {
        Some(TouchKind::Deletion) => Ok(Some(DriftLocus::OrphanedAt(commit_id))),
        Some(TouchKind::Rewrite(target)) => {
            // commit_id is pinned here — only the path is threaded forward.
            match resolve_terminal_path(repo, &target, MAX_RENAME_HOPS, commit_id)? {
                Some(terminal) => Ok(Some(DriftLocus::RenamedAt(commit_id, terminal))),
                None => Ok(Some(DriftLocus::OrphanedAt(commit_id))), // chain ends in a
                    // delete, an unclassifiable change, or exceeds the hop bound —
                    // report the anchor's own orphaning commit as a plain deletion
                    // rather than a rename to a path that turned out not to resolve.
            }
        }
        None => Ok(None), // e.g. a mode change (blob -> submodule gitlink):
                           // neither a plain deletion nor a content rewrite —
                           // fail-closed rather than guessing.
    }
}

/// Follow `path` forward through however many further renames it takes to
/// reach a path that resolves at HEAD. `created_at` is the commit that
/// produced `path` as a rewrite destination (the commit `deleted_locus_walk`
/// or a prior hop of this function classified as `Rewrite(path)`) — it
/// anchors the *forward* scan below so a later, unrelated file that happens
/// to resurrect an abandoned intermediate path can never be mistaken for the
/// live continuation of the lineage that arrived at it.
///
/// Returns the terminal path, or `None` if the chain ends in a deletion, an
/// unclassifiable change, a cycle, or exceeds `hops_left` — every `None`
/// case is fail-closed, never a guess. Carries no commit —
/// [`deleted_locus_walk`] owns the commit to report.
///
/// Rather than asking "does some file exist at `path` right now" (which a
/// resurrected, unrelated addition would satisfy just as well as the true
/// continuation), this scans forward from `created_at` (exclusive) to HEAD,
/// oldest-first, for the *next* commit that actually does something to
/// `path` itself: a further rename away (`Rewrite`, source = `path`) chases
/// the chain to its destination, and a plain deletion ends the chain
/// fail-closed. Any other touch (a content-only `Modification`, or the
/// unrelated `Addition` that resurrects an abandoned intermediate path after
/// the chain has already moved on) does not change what `path` refers to,
/// so it's skipped. If nothing in that range ever removes or renames
/// `path` away, the path has been continuously live since `created_at` and
/// is genuinely the terminal.
fn resolve_terminal_path(
    repo: &gix::Repository,
    path: &str,
    hops_left: u8,
    created_at: gix::ObjectId,
) -> Result<Option<String>> {
    let head_id = match repo.head_id() {
        Ok(id) => id.detach(),
        Err(_) => return Ok(None),
    };
    let walk = match repo.rev_walk([head_id]).with_hidden([created_at]).all() {
        Ok(w) => w,
        Err(_) => return Ok(None),
    };
    let mut commits: Vec<gix::ObjectId> = Vec::new();
    for info in walk {
        match info {
            Ok(i) => commits.push(i.id),
            Err(_) => return Ok(None),
        }
    }
    commits.reverse(); // oldest-first, i.e. created_at's earliest descendant first

    for commit_id in commits {
        match classify_touching_commit(repo, commit_id, path)? {
            Some(TouchKind::Deletion) => return Ok(None), // chain ends in a
                // delete between created_at and HEAD: fail-closed, never guess
            Some(TouchKind::Rewrite(next)) => {
                if hops_left == 0 {
                    return Ok(None); // fail-closed: chain too deep to trust
                }
                return resolve_terminal_path(repo, &next, hops_left - 1, commit_id);
            }
            None => continue, // content-only modification, an unrelated
                               // resurrection of this same path, or another
                               // unclassifiable change — none of these move
                               // the lineage, keep scanning forward
        }
    }

    // Nothing between created_at and HEAD ever removed or renamed `path`
    // away: it has been continuously live since created_at, so whatever is
    // there now is genuinely the same lineage, not a resurrection.
    if path_exists_at_head(repo, path)? {
        Ok(Some(path.to_string()))
    } else {
        Ok(None) // defensive fail-closed: shouldn't happen given the scan above
    }
}

/// Look up the blob OID at `path` in `tree`. Returns `None` when the path is
/// absent or does not resolve to a blob/symlink (a directory at that path is
/// treated as "no blob here"). Mirrors
/// [`crate::git::git_log_name_only_for_paths`]'s internal `blob_oid_at`.
fn blob_oid_at(tree: &gix::Tree<'_>, path: &str) -> Option<gix::ObjectId> {
    let entry = tree
        .clone()
        .lookup_entry_by_path(std::path::Path::new(path))
        .ok()??;
    if entry.mode().is_blob_or_symlink() {
        Some(entry.object_id())
    } else {
        None
    }
}

/// `true` when `path` resolves to a blob/symlink in HEAD's tree right now.
fn path_exists_at_head(repo: &gix::Repository, path: &str) -> Result<bool> {
    let head_id = match repo.head_id() {
        Ok(id) => id.detach(),
        Err(_) => return Ok(false),
    };
    let commit = match repo.find_commit(head_id) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return Ok(false),
    };
    Ok(blob_oid_at(&tree, path).is_some())
}

/// The tree of `commit_id`'s first parent, or the empty tree for a root
/// commit / an unreadable parent.
fn first_parent_tree_or_empty<'repo>(
    repo: &'repo gix::Repository,
    commit: &gix::Commit<'repo>,
) -> gix::Tree<'repo> {
    let parent_ids: Vec<_> = commit.parent_ids().map(|p| p.detach()).collect();
    match parent_ids.first() {
        Some(pid) => match repo.find_commit(*pid) {
            Ok(parent) => parent.tree().unwrap_or_else(|_| repo.empty_tree()),
            Err(_) => repo.empty_tree(),
        },
        None => repo.empty_tree(),
    }
}

/// Walk `HEAD` backward and return the first (nearest) commit whose blob OID
/// at `path` differs from its first-parent tree's — present↔absent and
/// blob↔different-blob both count as a match. Unlike
/// [`crate::git::git_log_name_only_for_paths`], merge commits are NOT
/// skipped: a merge commit that resolves a conflict by dropping a file is a
/// legitimate orphaning commit and must not be missed.
///
fn nearest_touching_commit(repo: &gix::Repository, path: &str) -> Result<Option<gix::ObjectId>> {
    let head_id = match repo.head_id() {
        Ok(id) => id.detach(),
        Err(_) => return Ok(None),
    };
    let walk = match repo.rev_walk([head_id]).all() {
        Ok(w) => w,
        Err(_) => return Ok(None),
    };
    for info in walk {
        let info = match info {
            Ok(i) => i,
            Err(_) => return Ok(None),
        };
        let commit = match repo.find_commit(info.id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let new_tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let old_tree = first_parent_tree_or_empty(repo, &commit);
        if blob_oid_at(&new_tree, path) != blob_oid_at(&old_tree, path) {
            return Ok(Some(info.id));
        }
    }
    Ok(None)
}

/// Classify how `commit_id` touched `path`, via a single
/// `track_rewrites(Some(Default::default()))` diff of `commit_id`'s tree
/// against its first parent's. Returns whichever of `Deletion`/`Rewrite`
/// matches `path` (by `location`/`source_location` respectively), or `None`
/// for an unclassifiable change (e.g. a mode change: blob -> submodule
/// gitlink) — fail-closed rather than guessing.
///
fn classify_touching_commit(
    repo: &gix::Repository,
    commit_id: gix::ObjectId,
    path: &str,
) -> Result<Option<TouchKind>> {
    let commit = match repo.find_commit(commit_id) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let new_tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let old_tree = first_parent_tree_or_empty(repo, &commit);

    let mut opts = gix::diff::Options::default();
    opts.track_rewrites(Some(Default::default()));
    let changes = match repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(opts)) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    let path_bytes = path.as_bytes();
    for change in changes.iter() {
        use gix::object::tree::diff::ChangeDetached;
        match change {
            ChangeDetached::Deletion { location, .. } if location.as_slice() == path_bytes => {
                return Ok(Some(TouchKind::Deletion));
            }
            ChangeDetached::Rewrite {
                source_location,
                location,
                ..
            } if source_location.as_slice() == path_bytes => {
                let target = std::str::from_utf8(location.as_slice())
                    .unwrap_or_default()
                    .to_string();
                return Ok(Some(TouchKind::Rewrite(target)));
            }
            _ => {}
        }
    }
    Ok(None)
}

#[cfg(test)]
mod deleted_locus_walk_tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Run a git command allowing a non-zero exit (e.g. a conflicting `merge`).
    fn git_allow_fail(dir: &Path, args: &[&str]) {
        let _ = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .expect("run git");
    }

    fn init_repo(dir: &Path) {
        // Isolate from any global/system git config, matching the
        // fixture-building convention used elsewhere in this crate (e.g.
        // `resolver::exact::tests::drifted_repo`).
        unsafe {
            std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
            std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
        }
        git(dir, &["init", "--initial-branch=main"]);
        git(dir, &["config", "user.name", "Test User"]);
        git(dir, &["config", "user.email", "test@example.com"]);
        git(dir, &["config", "commit.gpgsign", "false"]);
    }

    fn write_file(dir: &Path, rel: &str, contents: &str) {
        let p = dir.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(p, contents).expect("write file");
    }

    fn head_id(repo: &gix::Repository) -> gix::ObjectId {
        repo.head_id().expect("head id").detach()
    }

    #[test]
    fn single_rename_at_orphaning_commit_resolves_to_renamed_at() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        git(dir, &["mv", "a.rs", "b.rs"]);
        git(dir, &["commit", "-m", "rename a to b"]);
        let repo = gix::open(dir).expect("gix open");
        let x1 = head_id(&repo);

        let locus = deleted_locus_walk(&repo, "a.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::RenamedAt(x1, "b.rs".to_string())),
            "a single rename whose target is live at HEAD must resolve to RenamedAt \
             at the orphaning commit"
        );
    }

    #[test]
    fn true_deletion_resolves_to_orphaned_at() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        git(dir, &["rm", "a.rs"]);
        git(dir, &["commit", "-m", "delete a"]);
        let repo = gix::open(dir).expect("gix open");
        let x1 = head_id(&repo);

        let locus = deleted_locus_walk(&repo, "a.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::OrphanedAt(x1)),
            "a path with no rename involved must resolve to a plain deletion"
        );
    }

    /// The walk only ever compares path strings, never byte ranges, so a
    /// whole-file anchor's path and a line-range anchor's path go through
    /// the identical `deleted_locus_walk(repo, path)` call — there is no
    /// separate whole-file branch to exercise.
    #[test]
    fn extent_agnostic_whole_file_and_line_range_share_one_walk() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "whole.rs", "whole file content\n");
        write_file(dir, "lines.rs", "line1\nline2\nline3\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        // whole.rs stands in for a whole-file anchor: truly deleted.
        git(dir, &["rm", "whole.rs"]);
        git(dir, &["commit", "-m", "delete whole.rs"]);
        let repo = gix::open(dir).expect("gix open");
        let whole_deletion_commit = head_id(&repo);

        // lines.rs stands in for a line-range anchor: renamed, content lives on.
        git(dir, &["mv", "lines.rs", "code.rs"]);
        git(dir, &["commit", "-m", "rename lines.rs to code.rs"]);
        let repo = gix::open(dir).expect("gix open");
        let lines_rename_commit = head_id(&repo);

        assert_eq!(
            deleted_locus_walk(&repo, "whole.rs").expect("walk"),
            Some(DriftLocus::OrphanedAt(whole_deletion_commit)),
            "whole-file-anchored path must classify identically to a line-range one"
        );
        assert_eq!(
            deleted_locus_walk(&repo, "lines.rs").expect("walk"),
            Some(DriftLocus::RenamedAt(
                lines_rename_commit,
                "code.rs".to_string()
            )),
            "line-range-anchored path must classify identically to a whole-file one"
        );
    }

    #[test]
    fn path_never_tracked_returns_none_fail_closed() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);
        let repo = gix::open(dir).expect("gix open");

        let locus = deleted_locus_walk(&repo, "never/existed.rs").expect("walk");
        assert_eq!(
            locus, None,
            "history exhausted without ever touching the path must fail closed to None"
        );
    }

    #[test]
    fn rename_chain_reports_anchors_own_orphaning_commit() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        git(dir, &["mv", "a.rs", "b.rs"]);
        git(dir, &["commit", "-m", "rename a to b (X1)"]);
        let repo = gix::open(dir).expect("gix open");
        let x1 = head_id(&repo);

        git(dir, &["mv", "b.rs", "c.rs"]);
        git(dir, &["commit", "-m", "rename b to c (X2)"]);
        let repo = gix::open(dir).expect("gix open");

        let locus = deleted_locus_walk(&repo, "a.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::RenamedAt(x1, "c.rs".to_string())),
            "a multi-hop chain must report the anchor's OWN orphaning commit (X1), \
             not the last hop's commit (X2), while still threading the terminal \
             live path (c.rs) forward"
        );
    }

    #[test]
    fn rename_then_delete_resolves_to_orphaned_at_first_hop() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        git(dir, &["mv", "a.rs", "b.rs"]);
        git(dir, &["commit", "-m", "rename a to b (X1)"]);
        let repo = gix::open(dir).expect("gix open");
        let x1 = head_id(&repo);

        git(dir, &["rm", "b.rs"]);
        git(dir, &["commit", "-m", "delete b (X2)"]);
        let repo = gix::open(dir).expect("gix open");

        let locus = deleted_locus_walk(&repo, "a.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::OrphanedAt(x1)),
            "a rename immediately followed by a delete of the renamed target must \
             report a plain deletion, never a RenamedAt pointing at the now-deleted b.rs"
        );
    }

    #[test]
    fn rename_chain_exceeding_max_hops_fails_closed_and_terminates() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "p0.rs", "fn p() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        // A chain comfortably deeper than MAX_RENAME_HOPS (8): p0 -> p1 -> ...
        // -> p_hops, live at HEAD. The bound must fire before the chain
        // reaches its live tail.
        let hops = usize::from(MAX_RENAME_HOPS) + 4;
        let mut x1 = None;
        for i in 0..hops {
            let from = format!("p{i}.rs");
            let to = format!("p{}.rs", i + 1);
            git(dir, &["mv", &from, &to]);
            git(dir, &["commit", "-m", &format!("rename {from} to {to}")]);
            if i == 0 {
                let repo = gix::open(dir).expect("gix open");
                x1 = Some(head_id(&repo));
            }
        }
        let repo = gix::open(dir).expect("gix open");

        // The chain-follower itself must fail closed once hops are exhausted,
        // not loop forever and not guess a distant terminal path.
        let terminal = resolve_terminal_path(&repo, "p1.rs", MAX_RENAME_HOPS, x1.expect("x1 captured"))
            .expect("resolve");
        assert_eq!(
            terminal, None,
            "a chain deeper than MAX_RENAME_HOPS must fail closed to None"
        );

        // The top-level walk converts that None into a plain deletion at the
        // anchor's own orphaning commit — never a guessed RenamedAt.
        let locus = deleted_locus_walk(&repo, "p0.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::OrphanedAt(x1.expect("x1 captured"))),
            "exceeding MAX_RENAME_HOPS must fail closed to OrphanedAt at the anchor's \
             own orphaning commit, never a guessed RenamedAt"
        );
    }

    #[test]
    fn merge_commit_deletion_reads_as_orphaned_at_merge_commit() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "base\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        // `other` deletes a.rs.
        git(dir, &["checkout", "-b", "other"]);
        git(dir, &["rm", "a.rs"]);
        git(dir, &["commit", "-m", "delete a on other"]);

        // `main` independently modifies a.rs, so merging `other` is a
        // modify/delete conflict rather than an auto-mergeable clean delete
        // (a delete on one side with no touch on the other never conflicts).
        git(dir, &["checkout", "main"]);
        write_file(dir, "a.rs", "modified on main\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "modify a on main"]);

        git_allow_fail(dir, &["merge", "other"]);
        // Resolve the conflict by taking the delete side.
        git(dir, &["rm", "-f", "a.rs"]);
        git(dir, &["commit", "--no-edit"]);

        let repo = gix::open(dir).expect("gix open");
        let merge_commit = head_id(&repo);

        let locus = deleted_locus_walk(&repo, "a.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::OrphanedAt(merge_commit)),
            "a delete/modify conflict resolved by taking the delete side must \
             attribute to the merge commit itself — the regression guard for \
             nearest_touching_commit deliberately not skipping merge commits the \
             way git_log_name_only_for_paths' hardcoded --no-merges would"
        );
    }

    #[test]
    fn resurrected_intermediate_path_does_not_shadow_true_terminal() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        // a.rs -> b.rs (X1)
        git(dir, &["mv", "a.rs", "b.rs"]);
        git(dir, &["commit", "-m", "rename a to b (X1)"]);
        let repo = gix::open(dir).expect("gix open");
        let x1 = head_id(&repo);

        // b.rs -> c.rs (X2): the chain moves past b.rs entirely.
        git(dir, &["mv", "b.rs", "c.rs"]);
        git(dir, &["commit", "-m", "rename b to c (X2)"]);

        // b.rs is resurrected as a completely unrelated file, and survives to
        // HEAD. A naive "does something exist at this path right now" check
        // would mistake this for the live continuation of the a.rs -> b.rs
        // hop.
        write_file(dir, "b.rs", "totally unrelated content\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "resurrect b.rs as an unrelated file"]);

        // c.rs — the true terminal — is edited further, simulating content
        // drift heavy enough to defeat any fuzzy content-based relocation
        // scan elsewhere in the engine. The walk here never relies on
        // content matching, only path-identity continuity, so this must not
        // affect the outcome.
        write_file(dir, "c.rs", "fn a() { /* heavily rewritten */ }\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "heavily rewrite c.rs"]);

        let repo = gix::open(dir).expect("gix open");

        let locus = deleted_locus_walk(&repo, "a.rs").expect("walk");
        assert_eq!(
            locus,
            Some(DriftLocus::RenamedAt(x1, "c.rs".to_string())),
            "a resurrected, unrelated file at an abandoned intermediate path \
             (b.rs) must never be reported as the rename target — the walk must \
             see through it to the true terminal (c.rs), pinned at the anchor's \
             own orphaning commit (X1)"
        );
    }

    #[test]
    fn deleted_locus_memo_reused_across_anchors_sharing_a_path() {
        let td = tempfile::tempdir().expect("tempdir");
        let dir = td.path();
        init_repo(dir);
        write_file(dir, "a.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "init"]);

        git(dir, &["mv", "a.rs", "b.rs"]);
        git(dir, &["commit", "-m", "rename a to b (X1)"]);
        let repo = gix::open(dir).expect("gix open");
        let x1 = head_id(&repo);
        let mut session = ConcurrentSession::new(&repo);

        // First anchor sharing "a.rs": computes and memoizes the walk.
        let first = session
            .deleted_locus_memo
            .entry("a.rs".to_string())
            .or_insert_with(|| deleted_locus_walk(&repo, "a.rs").expect("walk"))
            .clone();
        assert_eq!(first, Some(DriftLocus::RenamedAt(x1, "b.rs".to_string())));
        assert_eq!(session.deleted_locus_memo.len(), 1);

        // Mutate history further: delete b.rs, recreate it, then delete it
        // again at a NEW commit closer to HEAD. A non-memoized second full
        // walk over "a.rs" would now resolve differently (through b.rs's
        // later history) — the memo must insulate the second anchor from
        // that drift within one session.
        git(dir, &["rm", "b.rs"]);
        git(dir, &["commit", "-m", "delete b (interim)"]);
        write_file(dir, "b.rs", "fn a() {}\n");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", "recreate b"]);
        git(dir, &["rm", "b.rs"]);
        git(dir, &["commit", "-m", "delete b again (X2)"]);
        let repo2 = gix::open(dir).expect("gix open");

        // Second anchor, same path, same session: memo hit, no re-walk
        // against the now-different repo state.
        let second = session
            .deleted_locus_memo
            .entry("a.rs".to_string())
            .or_insert_with(|| deleted_locus_walk(&repo2, "a.rs").expect("walk"))
            .clone();
        assert_eq!(
            second, first,
            "a memo hit must return the FIRST anchor's cached answer (X1), not \
             re-walk the now-different repo and find X2"
        );
        assert_eq!(
            session.deleted_locus_memo.len(),
            1,
            "one distinct path must occupy exactly one memo slot regardless of \
             how many anchors share it"
        );
    }
}
