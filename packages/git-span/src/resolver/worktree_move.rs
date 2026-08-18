//! Worktree-blob fallback for unstaged moves (card main-264).
//!
//! When an anchor's path is gone from the worktree but still resolves at
//! HEAD (and neither history nor the index explains a rename), the fallback
//! hashes the anchor's last-known blob and searches the worktree's
//! untracked files for an identical blob:
//!
//! - a unique match is a `Moved (uncommitted)` finding that `--fix`
//!   resolves by retiring the old address and installing the new one;
//! - several identical-content candidates fail closed into a ranked
//!   proposal (`Ambiguous`) instead of an auto-fix;
//! - no match leaves every existing branch exactly as it runs today —
//!   the fallback is strictly additive and fail-closed by construction.
//!
//! The trigger gates (file-backed, HEAD-present, worktree-layer, and the
//! skip-worktree sparse gate) live at the call sites in the classification
//! arms ([`engine::anchor`], [`engine::whole_file`]); this module owns
//! enumeration, hashing, and the decision.

use std::path::PathBuf;

use gix::ObjectId;

use crate::Result;
use crate::resolver::session::ConcurrentSession;

/// Outcome of the worktree-blob fallback search.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum WorktreeMove {
    /// No untracked file has content identical to the anchor's last-known
    /// blob. Every existing branch runs exactly as today.
    None,
    /// Exactly one untracked file matches; `path` is the move destination.
    Unique { path: PathBuf },
    /// Several untracked files match; the anchor stays drifted and the
    /// candidates are surfaced as a ranked proposal (fail-closed, never a
    /// guess).
    Ambiguous { candidates: Vec<PathBuf> },
}

/// Search the worktree's untracked files for an exact-content match to the
/// anchor's last-known blob (`last_blob_oid`).
///
/// The untracked path→blob-OID map is computed once per scan on first
/// trigger and held in [`ConcurrentSession::worktree_move_cache`], shared
/// across every missing anchor in the run.
///
/// `path` is the anchored path the search is explaining. It is part of the
/// contract surface so a call site that later needs to exclude it (or
/// surface it in diagnostics) can do so without a signature change; the
/// search itself is purely content-addressed, and a tracked path never
/// appears in the untracked candidate set anyway.
pub(crate) fn find_worktree_move(
    repo: &gix::Repository,
    concurrent: &ConcurrentSession,
    path: &str,
    last_blob_oid: ObjectId,
) -> Result<WorktreeMove> {
    let _ = path;
    // Enumeration (or workdir resolution) failure collapses to `None` —
    // fail closed: no candidate knowledge, cached so the scan does not
    // retry the subprocess per anchor.
    let candidates = match concurrent.worktree_move_cache.get_or_init(|| {
        build_untracked_blob_map(repo).unwrap_or_default()
    }) {
        Some(map) => map,
        None => return Ok(WorktreeMove::None),
    };
    Ok(decide_worktree_move(candidates, last_blob_oid))
}

/// Hash every untracked worktree file to its blob OID(s), once per scan.
///
/// Returns `Ok(None)` when the underlying `git ls-files` enumeration fails
/// (fail-closed: the fallback knows nothing and every existing branch runs
/// as today). Per-entry failures — unreadable files, broken symlinks,
/// directories including nested-repo entries — skip the entry and never
/// abort the scan.
fn build_untracked_blob_map(
    repo: &gix::Repository,
) -> Result<Option<std::collections::HashMap<std::path::PathBuf, ObjectId>>> {
    let files = match crate::git::untracked_worktree_files(repo) {
        Ok(files) => files,
        Err(_) => return Ok(None),
    };
    let workdir = crate::git::work_dir(repo)?;
    // Repo-level line-ending config does not vary per path; probe once per
    // map build instead of once per entry.
    let repo_converted = repo_has_conversion_config(repo);
    let mut map = std::collections::HashMap::with_capacity(files.len());
    for rel in files {
        let abs = workdir.join(&rel);
        // `git ls-files -z` output is bytes; the lossy conversion in
        // `untracked_worktree_files` guarantees the resulting string is
        // valid, so the lossy view here is exact.
        let rel_str = rel.to_string_lossy();
        if let Ok(Some((raw_oid, cleaned_oid))) =
            hash_untracked_entry(repo, &abs, &rel_str, repo_converted)
        {
            map.insert(rel.clone(), raw_oid);
            if let Some(cleaned_oid) = cleaned_oid {
                map.insert(rel, cleaned_oid);
            }
        }
    }
    Ok(Some(map))
}

/// Blob-OID(s) of one untracked worktree file, `None` when the entry must
/// be skipped (directory, unreadable, broken symlink).
///
/// The first OID is the file hashed the way git stores it when no content
/// conversion applies: raw bytes for a regular file, the target string for
/// a symlink, and the clean pipeline ([`read_worktree_cleaned`]) for paths
/// carrying a non-core `filter=<name>` attribute. The second OID is present
/// only when the path also carries a line-ending/ident/encoding conversion
/// (`text`, `eol`, `ident`, `working-tree-encoding`) — or the repo has
/// `core.autocrlf` / `core.eol` conversion — and the clean pipeline (the
/// conversion git runs on `git add`) produced a *different* blob than the
/// raw read. The map is keyed under both OIDs then, so an untracked copy
/// matches both a normalized HEAD blob (via the cleaned key) and a blob
/// stored with conversion off (via the raw key).
///
/// Dual keying stays fail-closed: either key is a form git could store for
/// this exact path. When the attribute probe fails, the cleaned pass is
/// skipped (raw key only, exactly today's behavior); when the cleaned read
/// fails, the entry keeps its raw key rather than being dropped.
fn hash_untracked_entry(
    repo: &gix::Repository,
    abs: &std::path::Path,
    rel: &str,
    repo_converted: bool,
) -> Result<Option<(ObjectId, Option<ObjectId>)>> {
    let md = match std::fs::symlink_metadata(abs) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    // Directories — including the trailing-slash directory entries that
    // nested git repositories surface as — are never candidates.
    if md.file_type().is_dir() {
        return Ok(None);
    }
    if md.file_type().is_symlink() {
        // A symlink's blob is its target string, not the target's content;
        // git never applies text/ident conversion to symlinks.
        let target = match std::fs::read_link(abs) {
            Ok(t) => t,
            Err(_) => return Ok(None),
        };
        let oid = crate::git::hash_blob(&target.to_string_lossy().into_owned().into_bytes())?;
        return Ok(Some((oid, None)));
    }
    if super::layers::diff::filter_driver_for(repo, rel).is_some() {
        // A non-core filter driver owns the stored form; the clean pipeline
        // is the only hash git could store for this path.
        return match super::layers::diff::read_worktree_cleaned(repo, abs, rel) {
            Ok(Some(b)) => Ok(Some((crate::git::hash_blob(&b)?, None))),
            _ => Ok(None),
        };
    }
    let raw_bytes = match std::fs::read(abs) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };
    let raw_oid = crate::git::hash_blob(&raw_bytes)?;
    // Line-ending/ident/encoding conversion is not a filter driver, so it
    // needs its own probe: on a converted repo the raw bytes hash to a
    // different OID than the anchor's HEAD blob (stored normalized), and
    // without the cleaned key the fallback never fires.
    if !repo_converted && !path_carries_conversion(repo, rel) {
        return Ok(Some((raw_oid, None)));
    }
    match super::layers::diff::read_worktree_cleaned(repo, abs, rel) {
        Ok(Some(b)) => {
            let cleaned_oid = crate::git::hash_blob(&b)?;
            Ok(Some((
                raw_oid,
                (cleaned_oid != raw_oid).then_some(cleaned_oid),
            )))
        }
        // The cleaned pass failed; the raw key alone is exactly what the
        // pre-fallback code would have produced for this entry.
        _ => Ok(Some((raw_oid, None))),
    }
}

/// Whether git would run content conversion on `rel` when committing it, so
/// the raw worktree bytes could differ from the stored blob.
///
/// Probes the per-path conversion attributes — `text`, `eol`, `ident`,
/// `working-tree-encoding` — in a single attribute-stack pass. Repo-level
/// line-ending config ([`repo_has_conversion_config`]) is the other half of
/// the probe; the caller hoists it since it does not vary per path.
///
/// A failed lookup reports `false`: the caller then keeps only the raw
/// hash — today's behavior — rather than guessing which blob the pipeline
/// would produce.
fn path_carries_conversion(repo: &gix::Repository, rel: &str) -> bool {
    let index = match repo.index_or_load_from_head() {
        Ok(i) => i,
        Err(_) => return false,
    };
    let mut stack = match repo.attributes(
        &index,
        gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
        gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped,
        None,
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let mut outcome =
        stack.selected_attribute_matches(["text", "eol", "ident", "working-tree-encoding"]);
    let platform = match stack.at_entry(std::path::Path::new(rel), None) {
        Ok(p) => p,
        Err(_) => return false,
    };
    if !platform.matching_attributes(&mut outcome) {
        return false;
    }
    // Set (`text`, `ident`) or valued (`eol=crlf`, `working-tree-encoding=…`)
    // attributes convert; `-text` / `-eol` / unspecified opt out.
    outcome.iter_selected().any(|m| {
        matches!(
            m.assignment.state,
            gix::attrs::StateRef::Set | gix::attrs::StateRef::Value(_)
        )
    })
}

/// Whether repository-level line-ending config can make worktree bytes
/// differ from stored blobs: `core.autocrlf` (`true` or `input`) converts
/// on commit, and a non-default `core.eol` (`crlf`/`lf`) applies to
/// `text`-marked files. Checked once per map build, not per entry.
fn repo_has_conversion_config(repo: &gix::Repository) -> bool {
    let snap = repo.config_snapshot();
    if snap
        .string("core.autocrlf")
        .map(|v| {
            let v = v.to_string();
            v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("input")
        })
        .unwrap_or(false)
    {
        return true;
    }
    snap.string("core.eol").is_some_and(|v| {
        let v = v.to_string();
        v.eq_ignore_ascii_case("crlf") || v.eq_ignore_ascii_case("lf")
    })
}

/// Pure decision over the untracked candidate map: how many untracked
/// worktree files hold a blob identical to `last_blob_oid`, and which.
///
/// This is the contract the unit checks pin; `find_worktree_move` (the
/// IO-bearing search) consults it once the candidate map is built. The
/// result is fully determined by the map, so sorting happens here — equal
/// candidates render in deterministic path order, never in hash-map order.
pub(crate) fn decide_worktree_move(
    candidates: &std::collections::HashMap<std::path::PathBuf, ObjectId>,
    last_blob_oid: ObjectId,
) -> WorktreeMove {
    let mut matches: Vec<std::path::PathBuf> = candidates
        .iter()
        .filter(|(_, oid)| **oid == last_blob_oid)
        .map(|(path, _)| path.clone())
        .collect();
    matches.sort();
    match matches.len() {
        0 => WorktreeMove::None,
        1 => WorktreeMove::Unique {
            path: matches.pop().expect("len == 1"),
        },
        _ => WorktreeMove::Ambiguous { candidates: matches },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// 40-hex OIDs distinct from each other, standing in for distinct blobs.
    const OID_A: &str = "1111111111111111111111111111111111111111";
    const OID_B: &str = "2222222222222222222222222222222222222222";
    const OID_C: &str = "3333333333333333333333333333333333333333";

    fn oid(hex: &str) -> ObjectId {
        ObjectId::from_hex(hex.as_bytes()).expect("valid 40-hex oid")
    }

    fn candidates(entries: &[(&str, &str)]) -> HashMap<PathBuf, ObjectId> {
        entries
            .iter()
            .map(|(path, hex)| (PathBuf::from(path), oid(hex)))
            .collect()
    }

    /// No untracked file matches the anchor's blob → `None` (today's
    /// behavior, unchanged).
    #[test]
        fn no_matching_candidate_is_none() {
        let set = candidates(&[("a.txt", OID_A), ("b.txt", OID_B)]);
        assert_eq!(decide_worktree_move(&set, oid(OID_C)), WorktreeMove::None);
        assert_eq!(
            decide_worktree_move(&HashMap::new(), oid(OID_C)),
            WorktreeMove::None
        );
    }

    /// Exactly one untracked file matches → `Unique`, that path.
    #[test]
        fn single_matching_candidate_is_unique() {
        let set = candidates(&[("a.txt", OID_A), ("b.txt", OID_B)]);
        assert_eq!(
            decide_worktree_move(&set, oid(OID_B)),
            WorktreeMove::Unique {
                path: PathBuf::from("b.txt")
            }
        );
    }

    /// Several identical-content candidates → `Ambiguous` with the paths in
    /// deterministic path order, regardless of hash-map iteration order.
    #[test]
        fn multiple_matching_candidates_are_ambiguous_in_path_order() {
        let set = candidates(&[
            ("b.txt", OID_A),
            ("a.txt", OID_A),
            ("c.txt", OID_B),
        ]);
        assert_eq!(
            decide_worktree_move(&set, oid(OID_A)),
            WorktreeMove::Ambiguous {
                candidates: vec![PathBuf::from("a.txt"), PathBuf::from("b.txt")]
            }
        );
    }
}
