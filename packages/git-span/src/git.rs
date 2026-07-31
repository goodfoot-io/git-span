//! Git plumbing helpers.
//!
//! Thin typed wrappers around `gix`. These are the only place in the
//! crate that talks to git directly; the rest of the crate stays on
//! typed results via [`crate::Result`].

use crate::{Error, Result};
use std::cell::Cell;
use std::collections::HashSet;
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

/// Reject history-sensitive commands when Git's effective commit graph differs
/// from the object graph exposed by `gix`.
///
/// Active replacement refs can rewrite any part of a commit object, while
/// `info/grafts` rewrites its parents. The resolver and history renderer both
/// use raw `gix` objects. Letting either command continue would make them
/// report trees, metadata, or topology that differ from Git's effective
/// history, and making only history shell out to Git would merely split the
/// authority. Until the resolver can consume effective commits, both surfaces
/// fail before rendering anything.
pub(crate) fn reject_replacement_topology(repo: &gix::Repository) -> Result<()> {
    // Git disables replacement refs when the variable merely exists (the
    // value is immaterial). Honour that before probing the default or a custom
    // namespace. Grafts are independent of this switch and remain active.
    let replacements_disabled = std::env::var_os("GIT_NO_REPLACE_OBJECTS").is_some();
    let replacement_base =
        std::env::var("GIT_REPLACE_REF_BASE").unwrap_or_else(|_| "refs/replace/".into());

    let mut changed_targets = HashSet::new();
    if !replacements_disabled {
        // `for-each-ref` is a bounded metadata lookup, understands packed refs,
        // and follows Git's selected namespace. Ordinary repositories stop
        // here without walking a single commit.
        let refs = std::process::Command::new("git")
            .current_dir(work_dir(repo)?)
            .args([
                "for-each-ref",
                "--format=%(refname) %(objectname)",
                &replacement_base,
            ])
            .output()
            .map_err(|e| Error::Git(format!("inspect replacement refs: {e}")))?;
        if !refs.status.success() {
            return Err(Error::Git(format!(
                "inspect replacement refs: {}",
                String::from_utf8_lossy(&refs.stderr).trim()
            )));
        }
        for line in String::from_utf8_lossy(&refs.stdout).lines() {
            let (name, replacement) = line.split_once(' ').ok_or_else(|| {
                Error::Git("inspect replacement refs: malformed for-each-ref output".into())
            })?;
            let original = name.strip_prefix(&replacement_base).ok_or_else(|| {
                Error::Git(format!(
                    "replacement ref `{name}` is outside its configured namespace"
                ))
            })?;
            let original = parse_oid(original)?;
            let replacement = parse_oid(replacement)?;
            // Equal object IDs imply equal object bytes. Any other replacement
            // changes at least one commit semantic (tree, metadata, or parents),
            // even when the parent list happens to remain identical.
            if original != replacement {
                changed_targets.insert(original);
            }
        }
    }

    let grafts_path = common_dir(repo).join("info/grafts");
    if let Ok(text) = std::fs::read_to_string(&grafts_path) {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut fields = line.split_whitespace();
            let original_text = fields.next().expect("non-empty graft line");
            let original = parse_oid(original_text).map_err(|_| {
                Error::Git(format!(
                    "inspect info/grafts: invalid commit id `{original_text}`"
                ))
            })?;
            let declared_parents = fields.map(parse_oid).collect::<Result<Vec<ObjectId>>>()?;
            let raw_parents = repo.find_commit(original).ok().map(|commit| {
                commit
                    .parent_ids()
                    .map(|id| id.detach())
                    .collect::<Vec<_>>()
            });
            // A dangling graft cannot affect HEAD. Defer reachability for it,
            // while malformed/missing objects remain harmless unless reached.
            if raw_parents.as_ref() != Some(&declared_parents) {
                changed_targets.insert(original);
            }
        }
    }

    if changed_targets.is_empty() {
        return Ok(());
    }

    let Some(head) = repo.head_id().ok().map(|id| id.detach()) else {
        return Ok(());
    };
    let started = std::time::Instant::now();
    let budget = std::time::Duration::from_secs(8);
    const MAX_COMMITS: usize = 1_000_000;
    let mut pending = vec![head];
    let mut seen = HashSet::new();
    while let Some(id) = pending.pop() {
        if started.elapsed() > budget || seen.len() >= MAX_COMMITS {
            return Err(Error::Git(
                "replacement topology check incomplete: reachable history exceeded its safety bound"
                    .into(),
            ));
        }
        if !seen.insert(id) {
            continue;
        }
        if changed_targets.contains(&id) {
            return Err(Error::Git(
                "replacement topology is unsupported: remove refs/replace or info/grafts before running this command"
                    .into(),
            ));
        }
        let commit = repo
            .find_commit(id)
            .map_err(|e| Error::Git(format!("inspect raw commit {id}: {e}")))?;
        pending.extend(commit.parent_ids().map(|parent| parent.detach()));
    }
    Ok(())
}

/// Resolve `HEAD` to a commit OID.
pub(crate) fn head_oid(repo: &gix::Repository) -> Result<String> {
    let id = repo
        .head_id()
        .map_err(|e| Error::Git(format!("resolve HEAD: {e}")))?;
    Ok(id.detach().to_string())
}

/// The set of commit OIDs currently checked out by an *active worktree* — this
/// repository's own HEAD, the main worktree's HEAD (this repo may itself be a
/// linked worktree), and every linked worktree's HEAD.
///
/// These are the "live" heads GC retains generations for
/// (`notes/architecture-and-complexity.md` GC: "Retain generations used by
/// active worktrees/refs"). The store keys each cached generation by its
/// publish-time HEAD hint, so a generation whose HEAD is absent from this set
/// is backed by no active worktree — it has been superseded and is eligible
/// for quota eviction.
///
/// **Fails closed on blindness, not on a single prunable worktree.** The
/// distinction is deliberate (card main-157 F3). *Enumerating* the linked
/// worktrees is a hard error: if we cannot list them we may be blind to an
/// entire live worktree, so the caller must skip reconciliation rather than
/// demote against a set that silently omits one. But once enumeration succeeds,
/// a *single* worktree that cannot be opened or whose HEAD will not resolve —
/// the ordinary, persistent state of a linked worktree whose working directory
/// was deleted without `git worktree remove`/`prune` — is skipped, not fatal:
/// its head is simply excluded from the live set. Its failure is never treated
/// as proof of non-liveness for any *other* head, and the resolvable heads
/// (this worktree's, the main worktree's, every healthy linked worktree's) are
/// still a sound basis for demoting a head that no resolvable worktree sits on.
/// Failing the whole reconcile on that one entry instead would let a prunable
/// worktree permanently disable quota reclamation. This worktree's own HEAD
/// must resolve — if it does not we are in no state to reason about liveness,
/// so that one is fatal. The main worktree's HEAD when the main repo is bare or
/// unborn (no checked-out state to keep alive) is a tolerated absent
/// contribution, not an error.
pub(crate) fn live_worktree_heads(repo: &gix::Repository) -> Result<HashSet<String>> {
    let mut heads = HashSet::new();
    // This worktree's own HEAD — always present, always the generation we just
    // published with. Fatal if unresolvable.
    heads.insert(head_oid(repo)?);

    // The main worktree, reached from a linked worktree. A bare/unborn main has
    // no live checkout, so an unresolvable HEAD there is tolerated, not fatal.
    if let Ok(main) = repo.main_repo()
        && let Ok(id) = main.head_id()
    {
        heads.insert(id.detach().to_string());
    }

    // Enumerating the linked worktrees must succeed — a failure here means we
    // cannot see the full set and might miss a live worktree entirely, so we
    // fail closed and the caller skips reconciliation.
    let proxies = repo
        .worktrees()
        .map_err(|e| Error::Git(format!("enumerate worktrees: {e}")))?;
    // A single linked worktree that will not open or whose HEAD will not
    // resolve is skipped, not fatal (see the fail-closed-on-blindness note
    // above): its head is excluded from the live set, never treated as proof of
    // non-liveness for another head.
    for proxy in proxies {
        let Ok(wt) = proxy.into_repo() else { continue };
        let Ok(id) = wt.head_id() else { continue };
        heads.insert(id.detach().to_string());
    }
    Ok(heads)
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
/// Results are in git-log order (most recent first).
///
/// # Why merges are walked
///
/// This walk deliberately does **not** carry `--no-merges`. A merge that
/// resolves a conflict by hand, or that drops a file, changes the mainline
/// state at a seed path with no other commit accounting for it: skipping it
/// made the breaking commit anchor-silent, and where the merge was HEAD the
/// newest rendered state contradicted both HEAD and `git span stale` — whose
/// engine ([`crate::resolver::attribution`]) has never skipped merges. The two
/// commands must walk the same history.
///
/// The qualifying test below does the gating on its own: a merge qualifies iff
/// a seed path's blob differs between its tree and its **first parent's**, so a
/// merge that merely brings a side change onto the mainline unchanged still
/// drops out (its first-parent diff is empty on every seed path), and it is
/// attributed to the side commit that made it, as before. That rule has no
/// residue: an anchor's rendered content is a pure function of the blob at its
/// declared path, and the declaration is itself a seed path — so "first-parent
/// blob identical on every seed path" means nothing observable moved on the
/// mainline, and skipping is correct there.
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

    let mut next = Some(head_id);
    let mut seen = HashSet::new();
    while let Some(id) = next {
        if out.len() >= n {
            break;
        }
        if budget_start.elapsed() > budget {
            return Ok((out, false));
        }
        if !seen.insert(id) {
            return Err(Error::Git(
                "first-parent walk encountered a commit cycle".into(),
            ));
        }
        let commit = repo
            .find_commit(id)
            .map_err(|e| Error::Git(format!("find commit {id}: {e}")))?;

        // Merges are *not* skipped: the qualifying test below compares against
        // `parent_ids.first()` for any arity, so a merge qualifies exactly when
        // it moved the mainline at a seed path. See the "Why merges are walked"
        // section above. Parent #1 is well defined for an octopus merge too, so
        // no arity-specific clause is needed.
        let parent_ids: Vec<_> = commit.parent_ids().map(|p| p.detach()).collect();

        let new_tree = commit
            .tree()
            .map_err(|e| Error::Git(format!("commit tree {id}: {e}")))?;

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
            next = parent_ids.first().copied();
            continue;
        }

        out.push(CommitChanges {
            hash: id.to_string(),
            changed_paths: changed.into_iter().collect(),
        });
        next = parent_ids.first().copied();
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
fn commit_tree<'repo>(repo: &'repo gix::Repository, commit_oid: &str) -> Result<gix::Tree<'repo>> {
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
    pub author_date_iso8601: String,
    pub author_date_git: String,
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
    let author_time = parse_git_author_time(author_sig.time)?;
    let message = decoded.message.to_string();
    let summary = message.lines().next().unwrap_or("").to_string();
    let (author_date_iso8601, author_date_git) = format_git_dates(author_time)?;
    Ok(CommitMeta {
        author_date_iso8601,
        author_date_git,
        summary,
    })
}

/// The commit's **first parent** (parent #1), or `None` for a root commit.
///
/// "First parent" is meant in git's own `^1` sense and nothing looser. It is
/// the only baseline a commit's patch may be stated against: the *previous
/// entry in a walk* coincides with it on linear history alone, and on a
/// branched history the two diverge — which is how a rendered entry came to
/// assert edits (a revert of a sibling branch's line) that its commit never
/// made. Parent #1 is well defined at any arity, so an octopus merge needs no
/// special case.
pub(crate) fn first_parent_of(repo: &gix::Repository, commit_oid: &str) -> Result<Option<String>> {
    let oid = parse_oid(commit_oid)?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| Error::Git(format!("find commit `{commit_oid}`: {e}")))?;
    Ok(commit.parent_ids().next().map(|p| p.detach().to_string()))
}

struct GitAuthorTime {
    seconds: i64,
    offset_seconds: i64,
    compact_offset: String,
    colon_offset: String,
}

fn format_git_dates(t: GitAuthorTime) -> Result<(String, String)> {
    // Git records an absolute timestamp plus an offset whose accepted range is
    // wider than chrono's `FixedOffset` (for example `+9999` normalizes to
    // +100:39). Shift the calendar instant ourselves and render the recorded
    // offset separately so no valid Git date is silently rewritten as UTC.
    let local_seconds = t
        .seconds
        .checked_add(t.offset_seconds)
        .ok_or_else(|| Error::Git("author date is outside the supported timestamp range".into()))?;
    let local = chrono::DateTime::from_timestamp(local_seconds, 0)
        .ok_or_else(|| Error::Git("author date is outside the supported timestamp range".into()))?
        .naive_utc();
    Ok((
        format!("{}{}", local.format("%Y-%m-%dT%H:%M:%S"), t.colon_offset),
        format!(
            "{} {}",
            local.format("%a %b %-d %H:%M:%S %Y"),
            t.compact_offset
        ),
    ))
}

fn parse_git_author_time(raw: &str) -> Result<GitAuthorTime> {
    // gix's strict raw-date parser treats offsets outside the civil-time range
    // as invalid and defaults their offset to zero. Git itself accepts the
    // complete HHMM field and may store normalized offsets with more than two
    // hour digits, so parse that field without narrowing it.
    let mut fields = raw.split_whitespace();
    let seconds = fields
        .next()
        .ok_or_else(|| Error::Git("author date is missing its timestamp".into()))?
        .parse::<i64>()
        .map_err(|e| Error::Git(format!("invalid author timestamp: {e}")))?;
    let offset = fields
        .next()
        .ok_or_else(|| Error::Git("author date is missing its offset".into()))?;
    if fields.next().is_some() {
        return Err(Error::Git("author date contains unexpected fields".into()));
    }
    let (sign, digits) = match offset.as_bytes().first() {
        Some(b'+') => (1i64, &offset[1..]),
        Some(b'-') => (-1i64, &offset[1..]),
        _ => return Err(Error::Git("author date offset is missing its sign".into())),
    };
    if digits.len() < 4 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(Error::Git(format!("invalid author date offset `{offset}`")));
    }
    let minute_start = digits.len() - 2;
    let hours = digits[..minute_start]
        .parse::<i64>()
        .map_err(|e| Error::Git(format!("invalid author date hours: {e}")))?;
    let minutes = digits[minute_start..]
        .parse::<i64>()
        .map_err(|e| Error::Git(format!("invalid author date minutes: {e}")))?;
    let magnitude = hours
        .checked_mul(3600)
        .and_then(|value| minutes.checked_mul(60).and_then(|m| value.checked_add(m)))
        .ok_or_else(|| Error::Git(format!("author date offset `{offset}` is out of range")))?;
    let offset_seconds = magnitude
        .checked_mul(sign)
        .ok_or_else(|| Error::Git(format!("author date offset `{offset}` is out of range")))?;
    i32::try_from(offset_seconds)
        .map_err(|_| Error::Git(format!("author date offset `{offset}` is out of range")))?;
    Ok(GitAuthorTime {
        seconds,
        offset_seconds,
        compact_offset: offset.to_string(),
        colon_offset: format!(
            "{}{}:{}",
            &offset[..1],
            &digits[..minute_start],
            &digits[minute_start..]
        ),
    })
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

/// Read an object's bytes, requiring it to be a blob.
///
/// The type check is not decoration: a caller that resolved a *path* to an OID
/// (`path_blob_at`) hands over whatever the tree holds there, and a `.span/`
/// namespace name like `agent-hooks` resolves to a tree. `into_blob()` panics
/// on a non-blob, so the guard is what turns `git span history <namespace>`
/// into a curated exit-1 error instead of an exit-101 panic — matching
/// `blob_oid_at`'s `is_blob_or_symlink()` filter and the behaviour of
/// `git span show` / `git span tree` on the same input.
fn blob_data(repo: &gix::Repository, blob_oid: &str) -> Result<Vec<u8>> {
    let oid = parse_oid(blob_oid)?;
    let obj = repo
        .find_object(oid)
        .map_err(|e| Error::Git(format!("find object `{blob_oid}`: {e}")))?;
    if obj.kind != gix::object::Kind::Blob {
        return Err(Error::Git(format!(
            "object `{blob_oid}` is a {}, not a blob",
            obj.kind
        )));
    }
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

/// Slice decoded file text down to lines `[start, end]` (1-based inclusive),
/// erroring with [`Error::InvalidAnchor`] when the range starts past the text's
/// end.
///
/// This is the *one* line-range policy in the product, deliberately shared by
/// every path that turns a file into an anchor's snapshot: the blob read
/// ([`extract_blob_lines`]), the working-tree read behind `git span history`'s
/// `current` block, and `git span stale`'s display slicing. Two
/// implementations is how the same file state came to be a structural
/// `range-past-eof` when read from a commit and a fabricated empty string when
/// read from disk — the same class of split as the lossy-versus-strict UTF-8
/// decode that preceded it.
///
/// A range that *overlaps* the end is clipped, not rejected (`L2-L9` over a
/// three-line file yields two lines): the drift being visualized is precisely
/// that the file shrank under a stale range, and truncation is the honest
/// account of it. Only a range with no overlap at all — `lo >= hi`, i.e. a start
/// past the last line — has nothing to show.
///
/// The `>=` is the whole boundary. `lo == hi` is *zero* lines of overlap, which
/// is the no-overlap case and not an empty-but-valid slice, and a `lo > hi`
/// guard let it fall through to `Ok("")` and fabricate an empty text side for a
/// range the file does not have.
///
/// `lo == hi` has exactly two algebraic causes — `lines.len() == start - 1` or
/// `end == start - 1` — and the second cannot reach here: the span-file parser
/// fails closed on `end < start` (`malformed anchor address …: end line 3 <
/// start line 5`), so `end >= start` holds before this function is called. The
/// boundary is therefore precisely "the file has `start - 1` lines", and that is
/// not an exotic depth. Every anchor declared from
/// line 1 has `start - 1 == 0`, so it meets this boundary the moment its file is
/// merely emptied — cleared, regenerated empty, truncated to zero — and the
/// emptied file reported as having no such content while it sat on disk.
pub fn slice_line_range(text: &str, start: u32, end: u32) -> Result<String> {
    let lines: Vec<&str> = text.lines().collect();
    let lo = start.saturating_sub(1) as usize;
    let hi = (end as usize).min(lines.len());
    if lo >= hi {
        return Err(Error::InvalidAnchor { start, end });
    }
    let mut out = String::new();
    for line in &lines[lo..hi] {
        out.push_str(line);
        out.push('\n');
    }
    Ok(out)
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
    Ok(slice_line_range(text, start, end)?.into_bytes())
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
    TREE_ENTRY_AT_CALL_COUNT.with(|c| c.set(c.get() + 1));
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

// ---------------------------------------------------------------------------
// Call counter for tree_entry_at — used by the reproduction test for card
// main-157 F4 (the warm-hit dirty-tree withhold check re-walked HEAD's tree
// once per relevant path via this function instead of reusing one traversal;
// see `resolver::dirty::head_blob_path_map`). Always compiled; the
// thread-local increment on a hot path has negligible cost.
// ---------------------------------------------------------------------------

thread_local! {
    static TREE_ENTRY_AT_CALL_COUNT: Cell<usize> = const { Cell::new(0) };
}

/// Reset the call counter.
pub fn reset_tree_entry_at_call_count() {
    TREE_ENTRY_AT_CALL_COUNT.with(|c| c.set(0));
}

/// Read the call counter.
pub fn tree_entry_at_call_count() -> usize {
    TREE_ENTRY_AT_CALL_COUNT.with(|c| c.get())
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
            return Ok(entry
                .flags
                .contains(gix::index::entry::Flags::SKIP_WORKTREE));
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
        .map(|rd| {
            rd.flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with("promisor"))
        })
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

#[cfg(test)]
mod line_range_policy_tests {
    use super::*;

    /// [`slice_line_range`]'s documented policy, restated so this test does not
    /// read the code it is checking: a range has nothing to show exactly when
    /// it begins after the file's last line (`start > file_lines`), and
    /// otherwise it is the lines it names, clipped to the end.
    ///
    /// Defined only for `start <= end`, which is not a gap: the span-file parser
    /// rejects `end < start` before any address reaches this function, so an
    /// inverted range is unreachable here rather than merely unswept.
    fn documented_policy(text: &str, start: u32, end: u32) -> Option<String> {
        debug_assert!(start <= end);
        let lines: Vec<&str> = text.lines().collect();
        if start as usize > lines.len() {
            return None;
        }
        let lo = start as usize - 1;
        let hi = (end as usize).min(lines.len());
        Some(lines[lo..hi].iter().map(|l| format!("{l}\n")).collect())
    }

    fn file_of(len: usize) -> String {
        (1..=len).map(|i| format!("line{i}\n")).collect()
    }

    /// The guard must agree with the documented predicate at *every* depth, not
    /// at the one depth a fixture happened to pick.
    ///
    /// The boundary is `file_lines == start - 1`: zero lines of overlap, which
    /// is "no overlap at all" and therefore past end of file — but a `lo > hi`
    /// guard reads `lo == hi` as an empty-but-valid slice and returns `Ok("")`,
    /// fabricating content for a range the file does not have. This sweep is
    /// the measurement rather than the argument: exhaustive over file lengths
    /// `0..=8` and `start <= end` in `1..=8`, it reports every disagreement at
    /// once instead of stopping at the first.
    #[test]
    fn the_line_range_guard_matches_the_documented_predicate_at_every_depth() {
        let mut disagreements: Vec<String> = Vec::new();
        for len in 0..=8usize {
            let text = file_of(len);
            for start in 1..=8u32 {
                for end in start..=8u32 {
                    let got = slice_line_range(&text, start, end).ok();
                    let want = documented_policy(&text, start, end);
                    if got != want {
                        disagreements.push(format!(
                            "  file_lines={len} L{start}-L{end}: policy says {want:?}, \
                             slice_line_range says {got:?}"
                        ));
                    }
                }
            }
        }
        assert!(
            disagreements.is_empty(),
            "{} of the swept ranges disagree with the documented policy:\n{}",
            disagreements.len(),
            disagreements.join("\n")
        );
    }

    /// The boundary named on its own, in the shape a user meets it: a file
    /// truncated to exactly `start - 1` lines.
    #[test]
    fn a_range_starting_one_line_past_the_last_line_has_nothing_to_show() {
        for start in 1..=6u32 {
            let text = file_of(start as usize - 1);
            let end = start + 2;
            assert!(
                slice_line_range(&text, start, end).is_err(),
                "L{start}-L{end} over a {}-line file overlaps zero lines, so it is \
                 past end of file, not an empty range",
                start - 1
            );
        }
    }

    /// The everyday face of the same boundary: every anchor that starts at line
    /// 1 hits it the moment its file is merely *emptied*, because `start - 1`
    /// is 0 lines.
    #[test]
    fn a_line_one_range_over_an_emptied_file_has_nothing_to_show() {
        for end in 1..=5u32 {
            assert!(
                slice_line_range("", 1, end).is_err(),
                "L1-L{end} over an emptied file overlaps zero lines"
            );
        }
    }

    /// The other side of the boundary must not move: one line of overlap is
    /// still a clip, which is the honest account of a file that shrank under a
    /// stale range.
    #[test]
    fn a_range_overlapping_by_one_line_is_still_clipped() {
        for start in 1..=6u32 {
            let text = file_of(start as usize);
            let end = start + 2;
            assert_eq!(
                slice_line_range(&text, start, end).ok(),
                Some(format!("line{start}\n")),
                "L{start}-L{end} over a {start}-line file overlaps its last line"
            );
        }
    }
}
