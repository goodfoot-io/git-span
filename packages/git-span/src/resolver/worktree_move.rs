//! Worktree-blob fallback for unstaged moves (card main-264).
//!
//! When an anchor's path is gone from the worktree but still resolves at
//! HEAD (and neither history nor the index explains a rename), the fallback
//! hashes the anchor's last-known blob and searches the worktree's
//! untracked files for an identical blob. Untracked candidates are keyed
//! under every blob form the querying anchor could store — raw bytes, the
//! clean pipeline under the candidate path's conversion rules, and the
//! clean pipeline under the ANCHOR path's conversion rules (a file checked
//! out under conversion attributes at the anchor path keeps those smudged
//! bytes when shell-moved to a path that does not carry the same rules):
//!
//! - a unique match is a `Moved (uncommitted)` finding that `--fix`
//!   resolves by retiring the old address and installing the new one;
//! - several identical-content candidates fail closed into a ranked
//!   proposal (`Ambiguous`) instead of an auto-fix;
//! - no match leaves every existing branch exactly as it runs today —
//!   the fallback is strictly additive and fail-closed by construction.
//!
//! The anchor-rule keys depend on the querying anchor's conversion rule
//! context — the effective state of the four conversion attributes at the
//! anchor path — so the candidate map is rebuilt per distinct context, at
//! most once per context per scan, never per anchor (see
//! [`WorktreeMoveCache`]).
//!
//! The trigger gates (file-backed, HEAD-present, worktree-layer,
//! index-presence, and the skip-worktree sparse gate) live at the call
//! sites in the classification arms ([`engine::anchor`],
//! [`engine::whole_file`]); this module owns enumeration, hashing, and the
//! decision.

use std::path::PathBuf;
use std::sync::Mutex;

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
/// `path` is the anchored path the search is explaining — load-bearing.
/// A file checked out at the anchor path was smudged by the anchor path's
/// conversion rules, and a shell move carries those bytes to a destination
/// that may not carry the same rules; the anchor's stored blob is the clean
/// form under the anchor's OWN rules, so candidates must be keyed under
/// that clean form too (see [`hash_untracked_entry`]). Which anchor-rule
/// keys a candidate map holds therefore depends on the querying anchor's
/// conversion rule context (the effective state of the four conversion
/// attributes at the anchor path), so the map is built per distinct context
/// — at most once per context per scan, never once per anchor (see
/// [`WorktreeMoveCache`]).
pub(crate) fn find_worktree_move(
    repo: &gix::Repository,
    concurrent: &ConcurrentSession,
    path: &str,
    last_blob_oid: ObjectId,
) -> Result<WorktreeMove> {
    // Repo-level line-ending config applies to every path, so it never
    // splits the context; per-path conversion attributes are the rebuild
    // axis. A failed probe reports the no-rule context — the anchor then
    // gets no anchor-rule keys, exactly today's behavior.
    let repo_converted = repo_has_conversion_config(repo);
    let context = conversion_context(repo, path, repo_converted);
    let cache = concurrent
        .worktree_move_cache
        .get_or_init(|| Mutex::new(WorktreeMoveCache::new()));
    // The decision is pure; the candidate map must not outlive the lock
    // guard, so the decision is made inside the locked scope.
    let outcome = {
        let mut guard = cache.lock().expect("worktree_move_cache lock poisoned");
        match guard.map_for(repo, path, context) {
            Some(map) => decide_worktree_move(map, last_blob_oid),
            None => WorktreeMove::None,
        }
    };
    Ok(outcome)
}

/// Lazily-built, per-anchor-conversion-rule-context candidate maps (card
/// main-264).
///
/// The untracked candidate map keys each path under every blob form the
/// querying anchor could store (see [`hash_untracked_entry`]). The
/// anchor-rule key — the clean pipeline under the ANCHOR path's conversion
/// rules — depends on which anchor queries the map, so each distinct anchor
/// conversion rule context (the effective state of the four conversion
/// attributes at the anchor path — [`ConversionContext`] — with repo-level
/// config folded in) gets its own map, built at most once per scan and
/// never rebuilt for the same context. Anchors whose paths carry no
/// conversion rules at all share the single raw-only map — the common case
/// is exactly one build — and a whole-directory move inside one attribute
/// scope (every anchor in the same context) is one build too, matching the
/// plan's characterized sweep cost.
pub(crate) struct WorktreeMoveCache {
    /// The untracked enumeration failed on the first build attempt — the
    /// fallback is disabled for the rest of the scan (fail-closed), and no
    /// further context is attempted.
    failed: bool,
    /// One candidate map per distinct anchor conversion rule context, in
    /// first-use order.
    maps: Vec<(
        ConversionContext,
        std::collections::HashMap<std::path::PathBuf, ObjectId>,
    )>,
}

impl WorktreeMoveCache {
    fn new() -> Self {
        WorktreeMoveCache {
            failed: false,
            maps: Vec::new(),
        }
    }

    /// The candidate map for `context`, built on first use for that rule
    /// context with `anchor_rel` as the anchor-rule rules-path. `None`
    /// when the enumeration already failed — the fallback stays disabled
    /// for the rest of the scan.
    fn map_for(
        &mut self,
        repo: &gix::Repository,
        anchor_rel: &str,
        context: ConversionContext,
    ) -> Option<&std::collections::HashMap<std::path::PathBuf, ObjectId>> {
        if self.failed {
            return None;
        }
        // Index scan: the immutable borrow ends at `position`'s return, so
        // the context check cannot conflict with the build's later mutable
        // borrow of `self.maps`.
        if let Some(pos) = self.maps.iter().position(|(ctx, _)| *ctx == context) {
            return Some(&self.maps[pos].1);
        }
        match build_untracked_blob_map(repo, anchor_rel, &context) {
            Some(map) => {
                self.maps.push((context, map));
                self.maps.last().map(|(_, m)| m)
            }
            // Enumeration (or workdir resolution) failure: fail closed —
            // no candidate knowledge, and never retry the enumeration for a
            // later context.
            None => {
                self.failed = true;
                None
            }
        }
    }
}

/// Hash every untracked worktree file to its blob OID(s) for one anchor
/// conversion rule context, once per scan.
///
/// Returns `None` when the underlying `git ls-files` enumeration (or the
/// workdir lookup) fails — fail-closed: the fallback knows nothing and
/// every existing branch runs as today. Per-entry failures — unreadable
/// files, broken symlinks, directories including nested-repo entries — skip
/// the entry and never abort the build.
fn build_untracked_blob_map(
    repo: &gix::Repository,
    anchor_rel: &str,
    context: &ConversionContext,
) -> Option<std::collections::HashMap<std::path::PathBuf, ObjectId>> {
    let files = crate::git::untracked_worktree_files(repo).ok()?;
    let workdir = crate::git::work_dir(repo).ok()?;
    // The context carries the repo-level half of the conversion probe,
    // resolved once per context — never per entry.
    let repo_converted = context.repo_converted;
    let anchor_converted = context.has_conversion();
    let mut map = std::collections::HashMap::with_capacity(files.len());
    for rel in files {
        let abs = workdir.join(&rel);
        // `git ls-files -z` output is bytes; the lossy conversion in
        // `untracked_worktree_files` guarantees the resulting string is
        // valid, so the lossy view here is exact.
        let rel_str = rel.to_string_lossy();
        if let Ok(Some(hashes)) = hash_untracked_entry(
            repo,
            &abs,
            &rel_str,
            repo_converted,
            anchor_rel,
            anchor_converted,
        ) {
            map.insert(rel.clone(), hashes.raw);
            if let Some(cleaned_oid) = hashes.candidate_cleaned {
                map.insert(rel.clone(), cleaned_oid);
            }
            if let Some(cleaned_oid) = hashes.anchor_cleaned {
                map.insert(rel, cleaned_oid);
            }
        }
    }
    Some(map)
}

/// The blob forms one untracked worktree file could present to a querying
/// anchor — up to three OIDs, each a form git could store:
///
/// 1. **raw** — the file hashed the way git stores it when no content
///    conversion applies: raw bytes for a regular file, the target string
///    for a symlink, and the clean pipeline ([`read_worktree_cleaned`]) for
///    paths carrying a non-core `filter=<name>` attribute;
/// 2. **candidate-rule cleaned** — the clean pipeline (the conversion git
///    runs on `git add`) under the CANDIDATE path's conversion rules —
///    `text`, `eol`, `ident`, `working-tree-encoding`, or repo-level
///    `core.autocrlf` / `core.eol` — when it produced a *different* blob
///    than the raw read;
/// 3. **anchor-rule cleaned** — the same pipeline under the ANCHOR path's
///    conversion rules, when `anchor_converted`. A file checked out under
///    conversion attributes at the anchor path keeps those smudged bytes
///    when shell-moved to a path that does not carry the same rules, so the
///    anchor's stored blob (the clean form under the anchor's own rules)
///    can only match via this key.
///
/// `None` in a cleaned slot means that form is identical to the raw one
/// (or was uncomputable — the entry keeps its other keys rather than being
/// dropped).
struct EntryHashes {
    raw: ObjectId,
    candidate_cleaned: Option<ObjectId>,
    anchor_cleaned: Option<ObjectId>,
}

/// Blob form(s) of one untracked worktree file ([`EntryHashes`]), `None`
/// when the entry must be skipped (directory, unreadable, broken symlink).
///
/// The map is keyed under every present OID, so an untracked copy matches
/// both a normalized HEAD blob (via a cleaned key) and a blob stored with
/// conversion off (via the raw key). Triple keying stays fail-closed: every
/// key is a form git could store for this exact anchor. When the attribute
/// probe fails, the cleaned passes are skipped (raw key only, exactly
/// today's behavior); when a cleaned read fails, the entry keeps its raw
/// key rather than being dropped.
fn hash_untracked_entry(
    repo: &gix::Repository,
    abs: &std::path::Path,
    rel: &str,
    repo_converted: bool,
    anchor_rel: &str,
    anchor_converted: bool,
) -> Result<Option<EntryHashes>> {
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
        return Ok(Some(EntryHashes {
            raw: oid,
            candidate_cleaned: None,
            anchor_cleaned: None,
        }));
    }
    if super::layers::diff::filter_driver_for(repo, rel).is_some() {
        // A non-core filter driver owns the stored form; the clean pipeline
        // is the only hash git could store for this path. The early-return
        // branch stays as-is: the driver is path-agnostic, so neither the
        // candidate-rule nor the anchor-rule key applies.
        return match super::layers::diff::read_worktree_cleaned(repo, abs, rel) {
            Ok(Some(b)) => Ok(Some(EntryHashes {
                raw: crate::git::hash_blob(&b)?,
                candidate_cleaned: None,
                anchor_cleaned: None,
            })),
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
    // without a cleaned key the fallback never fires. With no conversion
    // anywhere — not on the candidate path, not on the anchor path, not in
    // the repo config — the raw key is the only form git could store.
    if !repo_converted && !path_carries_conversion(repo, rel) && !anchor_converted {
        return Ok(Some(EntryHashes {
            raw: raw_oid,
            candidate_cleaned: None,
            anchor_cleaned: None,
        }));
    }
    // Candidate-rule cleaned key: the clean form under the candidate's own
    // rules, for the repo-converted and path-scoped candidate cases.
    let candidate_cleaned = if repo_converted || path_carries_conversion(repo, rel) {
        match super::layers::diff::read_worktree_cleaned(repo, abs, rel) {
            Ok(Some(b)) => {
                let cleaned_oid = crate::git::hash_blob(&b)?;
                (cleaned_oid != raw_oid).then_some(cleaned_oid)
            }
            // The cleaned pass failed; the raw key alone is exactly what
            // the pre-fallback code would have produced for this entry.
            _ => None,
        }
    } else {
        None
    };
    // Anchor-rule cleaned key: the same pipeline under the ANCHOR path's
    // rules. The fallback only fires when the anchor path is gone from the
    // worktree, so a candidate at `rel == anchor_rel` cannot occur in
    // practice; defensively it is harmless — the duplicate key collapses
    // under the guard.
    let anchor_cleaned = if anchor_converted {
        match super::layers::diff::read_worktree_cleaned(repo, abs, anchor_rel) {
            Ok(Some(b)) => {
                let cleaned_oid = crate::git::hash_blob(&b)?;
                (cleaned_oid != raw_oid).then_some(cleaned_oid)
            }
            // Fail closed: the anchor-rule key is a *form the anchor could
            // store*, not a guess; without it the entry keeps its raw and
            // candidate-rule keys, exactly today's behavior.
            _ => None,
        }
    } else {
        None
    };
    Ok(Some(EntryHashes {
        raw: raw_oid,
        candidate_cleaned,
        anchor_cleaned,
    }))
}

/// The effective per-path conversion rule context at a path: the resolved
/// state of the four conversion attributes (`text`, `eol`, `ident`,
/// `working-tree-encoding`), with repo-level line-ending config folded in.
///
/// This is the axis that decides whether two anchors can share a candidate
/// map ([`WorktreeMoveCache`]): anchors whose contexts are equal run the
/// same clean pipeline under either one's rules, so the map builder's
/// rules-path is safe for every anchor that reuses the map. A context with
/// no rules at all (unconverted repo, no per-path attributes) is the
/// common raw-only case — one shared map for the whole scan.
#[derive(Clone, Debug, PartialEq, Eq)]
struct ConversionContext {
    /// Repo-level `core.autocrlf` / `core.eol` conversion (identical for
    /// every path in the repository).
    repo_converted: bool,
    /// Effective state of each conversion attribute, in canonical order —
    /// `text`, `eol`, `ident`, `working-tree-encoding`. `None` when the
    /// attribute resolves to no rule at the path; `-text` / `-eol` /
    /// `!attr` and unspecified all opt out, so they share the same slot
    /// (and the same raw-only maps).
    attrs: [Option<gix::attrs::State>; 4],
}

impl ConversionContext {
    /// Whether any conversion rules apply at the path — the gate for
    /// computing anchor-rule keys at all.
    fn has_conversion(&self) -> bool {
        self.repo_converted || self.has_path_attrs()
    }

    /// Whether any per-path conversion attribute applies at the path
    /// (repo-level config excluded).
    fn has_path_attrs(&self) -> bool {
        self.attrs.iter().any(Option::is_some)
    }
}

/// Effective conversion rule context at `rel` (see [`ConversionContext`]).
///
/// Walks the per-path conversion attributes — `text`, `eol`, `ident`,
/// `working-tree-encoding` — in a single attribute-stack pass, recording
/// the resolved state of each; the caller folds in repo-level line-ending
/// config ([`repo_has_conversion_config`]), which does not vary per path.
///
/// A failed lookup reports the no-rule context: the anchor then keeps only
/// the raw hash — today's behavior — rather than guessing which blob the
/// pipeline would produce.
fn conversion_context(
    repo: &gix::Repository,
    rel: &str,
    repo_converted: bool,
) -> ConversionContext {
    let no_rules = ConversionContext {
        repo_converted,
        attrs: [None, None, None, None],
    };
    let index = match crate::git::load_index(repo) {
        Ok(i) => i,
        Err(_) => return no_rules,
    };
    let mut stack = match repo.attributes(
        &index,
        gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
        gix::worktree::stack::state::ignore::Source::WorktreeThenIdMappingIfNotSkipped,
        None,
    ) {
        Ok(s) => s,
        Err(_) => return no_rules,
    };
    let mut outcome =
        stack.selected_attribute_matches(["text", "eol", "ident", "working-tree-encoding"]);
    let platform = match stack.at_entry(std::path::Path::new(rel), None) {
        Ok(p) => p,
        Err(_) => return no_rules,
    };
    if !platform.matching_attributes(&mut outcome) {
        return no_rules;
    }
    let mut attrs = [None, None, None, None];
    // `iter_selected()` yields every requested attribute in query order
    // (absent ones as `Unspecified`), so the slots stay canonical. Set
    // (`text`, `ident`) or valued (`eol=crlf`, `working-tree-encoding=…`)
    // attributes convert; `-text` / `-eol` / `!attr` / unspecified opt out
    // and share the no-rule slot.
    for (slot, m) in attrs.iter_mut().zip(outcome.iter_selected()) {
        *slot = match m.assignment.state {
            gix::attrs::StateRef::Set => Some(gix::attrs::State::Set),
            gix::attrs::StateRef::Value(v) => Some(gix::attrs::State::Value(v.to_owned())),
            _ => None,
        };
    }
    ConversionContext {
        repo_converted,
        attrs,
    }
}

/// Whether git would run content conversion on `rel` when committing it, so
/// the raw worktree bytes could differ from the stored blob.
///
/// The per-path half of [`conversion_context`]; repo-level line-ending
/// config ([`repo_has_conversion_config`]) is the other half, which the
/// caller hoists since it does not vary per path.
///
/// A failed lookup reports `false`: the caller then keeps only the raw
/// hash — today's behavior — rather than guessing which blob the pipeline
/// would produce.
fn path_carries_conversion(repo: &gix::Repository, rel: &str) -> bool {
    conversion_context(repo, rel, false).has_path_attrs()
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
        _ => WorktreeMove::Ambiguous {
            candidates: matches,
        },
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
        let set = candidates(&[("b.txt", OID_A), ("a.txt", OID_A), ("c.txt", OID_B)]);
        assert_eq!(
            decide_worktree_move(&set, oid(OID_A)),
            WorktreeMove::Ambiguous {
                candidates: vec![PathBuf::from("a.txt"), PathBuf::from("b.txt")]
            }
        );
    }
}
