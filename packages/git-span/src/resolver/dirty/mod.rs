//! Dirty (uncommitted staged/worktree overlay) execution path (card main-157
//! Phase 5A).
//!
//! When the exact-hit read misses and no committed ancestor is reusable, the
//! difference is often not a new commit at all but a *dirty overlay* on a
//! committed state we already resolved: a source file edited in the worktree,
//! a change staged in the index, or a `.span` definition modified but not
//! committed. The committed tree is byte-identical to a generation published at
//! the SAME HEAD; only the worktree/index differs. Re-resolving the whole
//! corpus for one dirty path is exactly the disproportion this card exists to
//! close — and the `.gitignore`-only-dirty divergence
//! (`notes/investigation-question-log.md` Step 3) is the correctness bug the
//! whole investigation first found: today's `cache_v2` drops "in the working
//! tree" from findings when an unrelated file is dirtied.
//!
//! ## Global layer MODE vs. per-path CONTENT IDENTITY
//!
//! `notes/correctness-contract.md` "Explicit Decisions": *"One unrelated dirty
//! path still changes the global worktree-layer projection, but its bytes are
//! not part of dependency content identity."* This module keeps those two
//! notions strictly apart:
//!
//! * **Content identity (local).** Which *relevant* paths (committed span files
//!   and anchored source paths) are dirty NOW — derived from the
//!   already-captured [`StateToken`](crate::resolver::core::token::StateToken)
//!   via [`incremental::relevant_dirty_paths`]. A span is re-resolved only if
//!   one of its own paths is dirty (or it is widen-marked — see below).
//! * **Layer mode (global).** A dirty path that is *not* one of a span's anchors
//!   cannot change that span's per-anchor observations, so a span whose paths
//!   are all clean reuses its baseline core verbatim. An UNRELATED dirty path
//!   (e.g. `.gitignore`) is not in the token's relevant set at all, so it does
//!   not change the canonical key and never reaches this module — it is served
//!   by the exact-hit tier from the clean baseline's summary, rendering the
//!   correct output.
//!
//! ## Shape (mirrors [`incremental`])
//!
//! 1. **Baseline.** Look up a generation published at the current HEAD
//!    ([`CacheStore::load_head_baseline`] — the HEAD-*inclusive* lookup the
//!    ancestor walk deliberately excludes). No baseline ⇒ degrade to cold.
//! 2. **Dirty relevant paths.** [`incremental::relevant_dirty_paths`] from the
//!    captured token (conservative: a filter-normalized path is over-reported
//!    dirty, never under-reported). Empty ⇒ the key differs for a non-relevant
//!    reason (e.g. an existing tracked but unanchored file edited but not
//!    committed, moving a whole-index/worktree identity in the token). No span
//!    can be affected unless it is widen-marked (its relocation/copy scan reads
//!    every tracked path), so a widen-free corpus reuses **every** baseline core
//!    verbatim — a proportional C=0 reconstruction — and only a widen-marked
//!    corpus degrades to cold.
//! 3. **Affected set.** A span is re-resolved if its span file or any anchored
//!    path is dirty, if it is new (absent from the baseline), OR — the
//!    correctness landmine — if it carries the global-widen marker and anything
//!    is dirty. Everything else reuses its baseline `SpanCore` verbatim.
//! 4. **Reconstruct → project → revalidate → publish** via the exact path's
//!    shared [`project_revalidate_publish`](crate::resolver::exact::project_revalidate_publish),
//!    so a dirty-reconstructed core and a cold-built core render and persist
//!    through exactly one function. Dirty states are persistence-eligible
//!    ([`StateToken::persistence_eligible`] does not require a clean worktree),
//!    so a repeated identical dirty state becomes a plain exact-hit next call.
//!
//! ## Why reuse is sound
//!
//! For an unaffected span S at HEAD, reused from a baseline B published at the
//! same HEAD:
//! * **Committed part** — identical HEAD tree, so S's head observation is
//!   identical (config is carried in the canonical key both generations share).
//! * **Worktree/index part** — S is unaffected only if none of its paths are
//!   dirty NOW (step 2) and S was not widen-marked in B. `span_needs_widen`
//!   flags any span drifted at ANY layer (head/index/worktree/full), so a span
//!   B made dirty (to a non-`Fresh` state) is already widen-marked and excluded;
//!   both clean committed part + clean-now paths ⇒ equal observations.
//! * **Relocation/copy** — a drifted / `follow_moves` / global-copy span scans
//!   every tracked path, so newly-dirty content anywhere can change its result;
//!   such a span is widen-marked and re-resolved whenever anything is dirty
//!   (step 3), so it is never reused across a dirty state. Only spans that scan
//!   nothing beyond their own (clean-now) paths are ever reused.
//!
//! Worst case (no baseline, everything dirty/affected, any global-widen state)
//! degrades to a full cold resolve — byte-identical to cache-off, just not
//! proportional. Correctness over proportionality in every ambiguous case.

use std::collections::{HashMap, HashSet};

use crate::Result;
use crate::resolver::core::resolution::{ResolutionCore, SpanCore};
use crate::resolver::core::token::StateToken;
use crate::resolver::engine::capture_resolution_core;
use crate::resolver::exact::{self, ExactAttempt, reuse};
use crate::resolver::incremental;
use crate::resolver::store::CacheStore;
use crate::types::EngineOptions;

#[cfg(test)]
mod tests;

/// The reconstructed generation and the counters describing how much work the
/// dirty path saved (and did).
struct DirtyBuild {
    core: ResolutionCore,
    /// Anchors actually re-resolved. Usually ≥ 1 (a dirty relevant path forces
    /// its span's re-resolution), but 0 when a non-relevant dirty file over a
    /// widen-free corpus reuses every baseline core verbatim (step 3).
    anchor_resolutions: u64,
    /// Spans reused from the baseline generation.
    reused: usize,
    /// Spans freshly re-resolved (the dirty-affected subset).
    resolved: usize,
}

/// Attempt a dirty-overlay reconstruction. Returns `Some(attempt)` when a
/// same-HEAD baseline was reused (the caller renders it and does not run the
/// cold path), or `None` to degrade to the authoritative cold build. Any store
/// fault or unusable baseline is a `None`, never an error — fail closed on the
/// cache, never on the command.
pub(crate) fn attempt(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &StateToken,
    key: &[u8; 32],
    store: &mut CacheStore,
) -> Result<Option<ExactAttempt>> {
    let _perf = crate::perf::span("resolver.dirty");

    let build = match build_dirty_core(repo, span_root, token, store)? {
        Some(b) => b,
        None => return Ok(None),
    };

    incr_dirty_anchor_resolutions(build.anchor_resolutions);
    crate::perf::counter("cache-path.dirty-anchor-resolutions", build.anchor_resolutions);
    crate::perf::counter("cache-path.dirty-reused-spans", build.reused as u64);
    crate::perf::counter("cache-path.dirty-resolved-spans", build.resolved as u64);
    crate::perf::note("cache-path.hit-class: dirty");

    // Publish summary-only: a dirty-overlay generation is never a
    // reconstruction baseline (the clean same-HEAD baseline it reused from
    // already is), so persisting its whole-corpus reuse rows on every dirty
    // call is the O(corpus) publish cost 5C measured. Rendering is unchanged;
    // an identical repeat dirty state still becomes a plain exact-hit from the
    // summary alone.
    let attempt = exact::project_revalidate_publish_summary_only(
        repo,
        span_root,
        options,
        token,
        key,
        store,
        &build.core,
    )?;
    Ok(Some(attempt))
}

/// The relevant paths whose current index/worktree content differs from HEAD,
/// computed against a HEAD blob-path map read **once** rather than one HEAD tree
/// walk per relevant path.
///
/// This is behaviourally identical to
/// [`incremental::relevant_dirty_paths`] — same per-path
/// [`incremental::staged_clean`]/[`incremental::worktree_clean`] predicates,
/// same conservative over-reporting — but sources each path's HEAD blob OID
/// from a single [`head_blob_path_map`] traversal of the HEAD tree instead of a
/// per-path [`crate::git::tree_entry_at`] (which re-peels HEAD and re-navigates
/// the tree on every call).
///
/// The dirty path holds a same-HEAD baseline whose relevant set scales with the
/// whole corpus, so `incremental::relevant_dirty_paths`'s per-path HEAD lookup
/// is O(R) HEAD peels — and, for a flat corpus (every anchored file in one root
/// tree), O(R) linear entry scans per lookup, i.e. O(R²) overall. Reading the
/// HEAD tree once makes the whole computation O(HEAD-tree-size + R) map lookups.
/// (5C's exit gate is a corpus-growth bound; the per-path walk was ~93% of the
/// measured dirty-path time at 10,000 spans.)
///
/// The map covers the *whole* HEAD tree; a relevant path absent from it (a
/// newly-staged/untracked file with no HEAD blob) resolves to `None`, exactly
/// as `incremental::head_blob_oid` returns `None` for a path absent at HEAD.
///
/// `pub(crate)` (card main-157 F4): the exact path's warm-hit dirty-tree
/// withhold guard ([`exact::withhold_whole_result_for_dirty_tree`]) reuses this
/// function too — it runs on EVERY `Resolved{whole_result: Some}` attempt
/// (exact hit, memo hit, or a fresh build), so the same O(R) → O(1)-traversal
/// fix this module made for the dirty-reconstruction path applies there, not
/// just here.
pub(crate) fn relevant_dirty_paths(
    repo: &gix::Repository,
    token: &StateToken,
) -> Result<HashSet<String>> {
    use crate::resolver::core::token::PathState;
    use std::collections::HashMap;

    let head_blobs = head_blob_path_map(repo)?;

    let staged: HashMap<&str, &PathState> = token
        .staged_state
        .iter()
        .map(|e| (e.path.as_str(), &e.state))
        .collect();
    let worktree: HashMap<&str, &PathState> = token
        .worktree_state
        .iter()
        .map(|e| (e.path.as_str(), &e.state))
        .collect();
    let mut all: HashSet<&str> = HashSet::new();
    all.extend(staged.keys().copied());
    all.extend(worktree.keys().copied());

    let mut dirty: HashSet<String> = HashSet::new();
    for path in all {
        let head_oid = head_blobs.get(path).map(String::as_str);
        let staged_clean = incremental::staged_clean(staged.get(path).copied(), head_oid);
        let worktree_clean =
            incremental::worktree_clean(repo, worktree.get(path).copied(), head_oid);
        if !(staged_clean && worktree_clean) {
            dirty.insert(path.to_string());
        }
    }
    Ok(dirty)
}

/// The `path -> blob-OID (hex)` map of every **blob** in the HEAD tree, built in
/// one breadth-first traversal.
///
/// The `mode.is_blob()` filter matches [`incremental::head_blob_oid`]
/// (`tree_entry_at` + `mode.is_blob()`) exactly, so a lookup here returns
/// `Some(oid)` for precisely the paths that function returns `Some` for and
/// `None` for the rest — a symlink, submodule, or tree entry is excluded here
/// just as `is_blob()` excludes it there. This equality is what keeps the dirty
/// affected-set byte-identical to the per-path implementation it replaces.
///
/// Returns an empty map when HEAD (or its tree) cannot be read — the caller then
/// treats every relevant path as absent at HEAD, which the per-path predicates
/// classify conservatively (never a stale reuse).
fn head_blob_path_map(
    repo: &gix::Repository,
) -> Result<std::collections::HashMap<String, String>> {
    use crate::Error;
    let Ok(commit) = repo.head_commit() else {
        return Ok(std::collections::HashMap::new());
    };
    let Ok(tree) = commit.tree() else {
        return Ok(std::collections::HashMap::new());
    };
    let records = tree
        .traverse()
        .breadthfirst
        .files()
        .map_err(|e| Error::Git(format!("HEAD tree traverse: {e}")))?;
    let mut map = std::collections::HashMap::with_capacity(records.len());
    for e in records {
        if e.mode.is_blob() {
            map.insert(e.filepath.to_string(), e.oid.to_string());
        }
    }
    Ok(map)
}

/// The whole affected-set + reconstruction computation, factored out of
/// [`attempt`] so a test can assert the reconstructed core byte-for-byte
/// against a full resolve of the live dirty state without publishing.
fn build_dirty_core(
    repo: &gix::Repository,
    span_root: &str,
    token: &StateToken,
    store: &mut CacheStore,
) -> Result<Option<DirtyBuild>> {
    // ── 1. Same-HEAD baseline generation ────────────────────────────────────
    let baseline = match store.load_head_baseline(&token.head, exact::SUMMARY_VERSION) {
        Ok(Some(b)) => b,
        Ok(None) => {
            crate::perf::note("cache-path.bypass-reason: dirty-no-baseline");
            return Ok(None);
        }
        Err(e) => {
            // A store fault degrades to the cold path (which reads nothing).
            crate::perf::note(&format!("cache-path.bypass-reason: dirty-store: {e}"));
            return Ok(None);
        }
    };

    // ── 2. Reconstruct the baseline cores + widen markers ───────────────────
    let baseline_core = reuse::reuse_rows_to_core(&baseline.generation.rows);
    if baseline_core.spans.is_empty() {
        // A legacy (rows-empty Phase-3) generation, or a genuinely empty
        // corpus: nothing to reuse.
        crate::perf::note("cache-path.bypass-reason: dirty-empty-baseline");
        return Ok(None);
    }
    // Config-sensitive canonical-key guard. The baseline was located by HEAD
    // alone, which the canonical key excludes; a same-HEAD baseline can carry a
    // different config than the current invocation (a changed `core.autocrlf`,
    // filter binary, replace-ref, rename budget, sparse-checkout, ...). Reusing
    // its resolved cores under the new config would silently re-serve — and
    // re-publish under the new key — a stale result. A widen-free clean corpus
    // is the exact case that otherwise reuses every baseline core verbatim, so
    // this guard must precede that reuse. Mismatch ⇒ degrade to cold.
    if !reuse::config_matches(&baseline.generation.rows, token) {
        crate::perf::note("cache-path.bypass-reason: dirty-config-drift");
        return Ok(None);
    }

    let widen_names = reuse::reuse_rows_widen(&baseline.generation.rows);
    let baseline_by_name: HashMap<&str, &SpanCore> = baseline_core
        .spans
        .iter()
        .map(|s| (s.name.as_str(), s))
        .collect();

    // ── 3. Dirty relevant paths (from the already-captured token) ───────────
    let dirty_paths = relevant_dirty_paths(repo, token)?;
    if dirty_paths.is_empty() {
        // The exact key differs but no RELEVANT path is dirty — a non-relevant
        // tracked file moved a whole-index/worktree identity in the token (e.g.
        // an existing tracked, unanchored file edited but not committed). No
        // span's per-anchor observation can change from such an edit UNLESS the
        // span's relocation/copy scan enumerates every tracked path: a
        // newly-dirty file anywhere could become that span's relocation/copy
        // target. `span_needs_widen` marks exactly those spans.
        //
        // * No widen-marked span ⇒ every span reuses its baseline core verbatim
        //   (the affected set below is empty), a fully-proportional C=0
        //   reconstruction byte-identical to the clean baseline's render. This
        //   is the "one unrelated dirty file stays cheap" case Phase 5 exists to
        //   make proportional — 5C measured it falling through to a full cold
        //   rebuild instead.
        // * Any widen-marked span ⇒ we cannot prove its reuse safe against an
        //   unknown non-relevant dirty path, so degrade to the authoritative
        //   cold path (the established conservative worst-case fallback).
        if !widen_names.is_empty() {
            crate::perf::note("cache-path.bypass-reason: dirty-no-relevant-dirt-widen");
            return Ok(None);
        }
        // else: fall through with an empty affected-path set — nothing relevant
        // is dirty and no span scans beyond its own now-clean paths.
    }
    let affected_paths: HashSet<&str> = dirty_paths.iter().map(String::as_str).collect();

    // ── 4. Current corpus and the affected set ──────────────────────────────
    let current_names = crate::span::read::list_span_names_in(repo, span_root)?;
    let mut affected: HashSet<String> = HashSet::new();
    for name in &current_names {
        let span_file = format!("{span_root}/{name}");
        let is_affected = match baseline_by_name.get(name.as_str()) {
            // New (or renamed) span: no baseline core to reuse.
            None => true,
            Some(sc) => {
                // Its span definition is dirty…
                affected_paths.contains(span_file.as_str())
                    // …or one of its anchored source paths is dirty…
                    || sc
                        .anchors
                        .iter()
                        .any(|(_, a)| affected_paths.contains(a.anchored.path.as_str()))
                    // …or it is relocation/copy/move-sensitive and ANYTHING is
                    // dirty (the correctness landmine — conservative
                    // over-widening: newly-dirty content anywhere can become a
                    // relocation/copy target for a drifted span). `dirty_paths`
                    // is non-empty here, so a widen-marked span is always
                    // re-resolved.
                    || (widen_names.contains(name) && !affected_paths.is_empty())
            }
        };
        if is_affected {
            affected.insert(name.clone());
        }
    }

    // How many current spans actually reuse a baseline core.
    let reused_count = current_names
        .iter()
        .filter(|n| !affected.contains(n.as_str()) && baseline_by_name.contains_key(n.as_str()))
        .count();
    if reused_count == 0 {
        // Nothing to reuse (every span dirty/affected, or a fully widen-marked
        // corpus): let the cold path handle it uniformly. This is the "degrade
        // to full resolution" case.
        crate::perf::note("cache-path.bypass-reason: dirty-no-reuse");
        return Ok(None);
    }

    // ── 5. Re-resolve only the affected subset (live dirty state) ───────────
    let affected_names: Vec<String> = current_names
        .iter()
        .filter(|n| affected.contains(n.as_str()))
        .cloned()
        .collect();
    // An empty affected set (a non-relevant dirty file over a widen-free corpus,
    // step 3) reuses every baseline core verbatim: skip the resolver's source
    // scan entirely rather than resolve nothing over it.
    let fresh_core = if affected_names.is_empty() {
        ResolutionCore { spans: Vec::new() }
    } else {
        capture_resolution_core(repo, span_root, &affected_names)?
    };
    let anchor_resolutions: u64 = fresh_core
        .spans
        .iter()
        .map(|s| s.anchors.len() as u64)
        .sum();
    let resolved_count = fresh_core.spans.len();
    let mut fresh_by_name: HashMap<String, SpanCore> = fresh_core
        .spans
        .into_iter()
        .map(|s| (s.name.clone(), s))
        .collect();

    // ── 6. Combine in canonical (list) order ────────────────────────────────
    //
    // Iterating `current_names` (the sorted list a full resolve also iterates)
    // and dropping any span neither freshly resolved nor reusable reproduces a
    // full resolve's span order and membership exactly: a reused span's
    // definition is unchanged (so a full resolve would include it), and a
    // freshly-resolved span is present iff `capture_resolution_core` could read
    // it (same readability filter a full resolve applies).
    let mut spans = Vec::with_capacity(current_names.len());
    for name in &current_names {
        if affected.contains(name.as_str()) {
            if let Some(sc) = fresh_by_name.remove(name.as_str()) {
                spans.push(sc);
            }
        } else if let Some(sc) = baseline_by_name.get(name.as_str()) {
            spans.push((*sc).clone());
        }
    }

    Ok(Some(DirtyBuild {
        core: ResolutionCore { spans },
        anchor_resolutions,
        reused: reused_count,
        resolved: resolved_count,
    }))
}

// ── Test observability ───────────────────────────────────────────────────────
//
// A thread-local dirty-resolution counter (nextest runs each test in its own
// process, one call graph per thread) so a test can assert proportionality
// directly. In a non-test build `incr_*` is a no-op the optimizer removes.

#[cfg(not(test))]
#[inline]
fn incr_dirty_anchor_resolutions(_n: u64) {}

#[cfg(test)]
thread_local! {
    static TEST_DIRTY_ANCHOR_RESOLUTIONS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn incr_dirty_anchor_resolutions(n: u64) {
    TEST_DIRTY_ANCHOR_RESOLUTIONS.with(|c| c.set(c.get() + n));
}

#[cfg(test)]
fn reset_dirty_test_state() {
    TEST_DIRTY_ANCHOR_RESOLUTIONS.with(|c| c.set(0));
}

#[cfg(test)]
fn test_dirty_anchor_resolutions() -> u64 {
    TEST_DIRTY_ANCHOR_RESOLUTIONS.with(std::cell::Cell::get)
}
