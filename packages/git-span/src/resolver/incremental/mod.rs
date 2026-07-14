//! Incremental-miss execution path (card main-157 Phase 4B).
//!
//! When the exact-hit read misses (`resolver/exact`), most misses are still
//! "mostly the same, slightly different": one commit landed, or one file
//! changed, but the vast majority of spans resolve exactly as they did in a
//! recent generation. This module reconstructs the new generation from a cached
//! ancestor instead of re-resolving the whole corpus — the fix for the single
//! biggest measured defect the card exists to close: an unrelated commit at
//! 1,000 spans forcing a ~4.02 s full rebuild (`notes/investigation-question-
//! log.md` Step 4), because the exact key is the whole source tree with no
//! incremental reuse.
//!
//! ## Shape
//!
//! 1. **Ancestor.** Walk HEAD's ancestry ([`crate::git::head_ancestors`], bounded
//!    by [`MAX_ANCESTOR_WALK`]) for a commit with a stored generation. Because
//!    every candidate is reachable from HEAD, HEAD is a *descendant* of it — the
//!    soundness precondition (see below). No ancestor ⇒ degrade to the cold
//!    path.
//! 2. **Committed diff.** [`crate::git::changed_paths_between`] the ancestor
//!    commit and HEAD (rename tracking off, matching the resolver's relocation
//!    semantics). An *empty* diff means only the dirty worktree/index differs —
//!    that is Phase 5's job — so we degrade.
//! 3. **Dirty relevant paths.** Any relevant path whose worktree/index content
//!    differs from HEAD (derived from the already-captured
//!    [`StateToken`](crate::resolver::core::token::StateToken); a filter-affected
//!    path is conservatively over-reported dirty, never under-reported).
//! 4. **Affected set.** A span is re-resolved if its span file or any anchored
//!    path is in `changed ∪ dirty`, if its ancestor `SpanCore` was resolved over
//!    a non-committed-clean state, if it is new, OR — the correctness landmine —
//!    if it carries the global-widen marker and *any* tracked path changed.
//!    Everything else reuses its ancestor `SpanCore` verbatim.
//! 5. **Reconstruct → project → revalidate → publish** via the exact path's
//!    shared [`project_revalidate_publish`](crate::resolver::exact::project_revalidate_publish),
//!    so a reconstructed core and a cold-built core render and persist through
//!    exactly one function.
//!
//! ## Why reuse is sound
//!
//! For an unaffected span S at HEAD (a descendant of the ancestor A):
//! * **Committed part** — none of S's anchored paths, and no intervening commit
//!   on `A..HEAD`, touched S's blobs, so each anchor's history walk classifies
//!   identically at HEAD and at A.
//! * **Worktree/index part** — S is unaffected only if none of its paths are
//!   dirty *now* (step 3) and S was not widen-marked (so no anchor was non-
//!   `Fresh` at the ancestor, i.e. no index/worktree layer had made it dirty
//!   *then*); both clean + equal committed part ⇒ equal observations.
//! * **Relocation/copy** — a drifted / `follow_moves` / global-copy span scans
//!   *every* tracked path, so a new file anywhere can change its result; such a
//!   span is marked widen and re-resolved whenever anything changed (step 4), so
//!   it is never reused across a change. Only spans that scan nothing beyond
//!   their own paths are ever reused.
//!
//! Worst case (no ancestor, everything affected, any dirty-only or global-widen
//! state) degrades to a full cold resolve — a hard, frequently-exercised
//! fallback (first run, rebase, branch switch, reset), not a rare edge.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::Result;
use crate::resolver::core::resolution::{ResolutionCore, SpanCore};
use crate::resolver::core::token::{PathState, StateToken};
use crate::resolver::engine::capture_resolution_core;
use crate::resolver::exact::{self, ExactAttempt, reuse};
use crate::resolver::store::CacheStore;
use crate::types::EngineOptions;

#[cfg(test)]
mod tests;

/// How far back to walk HEAD's ancestry looking for a cached generation. The
/// ancestor search reads at most this many commit ids and one tree diff; past
/// it, the incremental path degrades to a full resolve, which republishes a
/// generation near HEAD so the next nearby commit reuses again. 100 keeps the
/// walk cheap while covering ordinary "a few commits since the last `stale`"
/// gaps.
const MAX_ANCESTOR_WALK: usize = 100;

/// The reconstructed generation and the counters describing how much work the
/// incremental path saved (and did).
struct IncrementalBuild {
    core: ResolutionCore,
    /// Anchors actually re-resolved (0 for a fully-reused unrelated commit).
    anchor_resolutions: u64,
    /// Spans reused from the ancestor generation.
    reused: usize,
    /// Spans freshly re-resolved.
    resolved: usize,
}

/// Attempt an incremental reconstruction. Returns `Some(attempt)` when an
/// ancestor was reused (the caller renders it and does not run the cold path),
/// or `None` to degrade to the authoritative cold build. Any store fault or
/// unusable ancestor is a `None`, never an error — fail closed on the cache,
/// never on the command.
pub(crate) fn attempt(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &StateToken,
    key: &[u8; 32],
    store: &mut CacheStore,
) -> Result<Option<ExactAttempt>> {
    let _perf = crate::perf::span("resolver.incremental");

    let build = match build_incremental_core(repo, span_root, token, store)? {
        Some(b) => b,
        None => return Ok(None),
    };

    incr_incremental_anchor_resolutions(build.anchor_resolutions);
    crate::perf::counter(
        "cache-path.incremental-anchor-resolutions",
        build.anchor_resolutions,
    );
    crate::perf::counter("cache-path.incremental-reused-spans", build.reused as u64);
    crate::perf::counter("cache-path.incremental-resolved-spans", build.resolved as u64);
    crate::perf::note("cache-path.hit-class: incremental");

    let attempt = exact::project_revalidate_publish(
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

/// The whole affected-set + reconstruction computation, factored out of
/// [`attempt`] so a test can assert the reconstructed core byte-for-byte
/// against a full resolve without publishing.
fn build_incremental_core(
    repo: &gix::Repository,
    span_root: &str,
    token: &StateToken,
    store: &mut CacheStore,
) -> Result<Option<IncrementalBuild>> {
    // ── 1. Locate a cached ancestor generation ──────────────────────────────
    let candidates = crate::git::head_ancestors(repo, MAX_ANCESTOR_WALK)?;
    if candidates.is_empty() {
        crate::perf::note("cache-path.bypass-reason: incremental-no-ancestor-candidates");
        return Ok(None);
    }
    let ancestor = match store.load_ancestor_generation(&candidates, exact::SUMMARY_VERSION) {
        Ok(Some(a)) => a,
        Ok(None) => {
            crate::perf::note("cache-path.bypass-reason: incremental-no-ancestor");
            return Ok(None);
        }
        Err(e) => {
            // A store fault degrades to the cold path (which reads nothing).
            crate::perf::note(&format!("cache-path.bypass-reason: incremental-store: {e}"));
            return Ok(None);
        }
    };
    let ancestor_head = ancestor.generation.head.clone();

    // ── 2. Reconstruct the ancestor cores + widen markers ───────────────────
    let ancestor_core = reuse::reuse_rows_to_core(&ancestor.generation.rows);
    if ancestor_core.spans.is_empty() {
        // A legacy (rows-empty Phase-3) generation, or a genuinely empty
        // corpus: nothing to reuse.
        crate::perf::note("cache-path.bypass-reason: incremental-empty-ancestor");
        return Ok(None);
    }
    let widen_names = reuse::reuse_rows_widen(&ancestor.generation.rows);
    let ancestor_by_name: HashMap<&str, &SpanCore> = ancestor_core
        .spans
        .iter()
        .map(|s| (s.name.as_str(), s))
        .collect();

    // ── 3. Committed tree diff (ancestor commit → HEAD) ─────────────────────
    let changed_committed = crate::git::changed_paths_between(repo, &ancestor_head, &token.head)?;
    if changed_committed.is_empty() {
        // The trees are identical; only the dirty worktree/index differs. That
        // is the Phase 5 dirty path, not an incremental committed generation.
        crate::perf::note("cache-path.bypass-reason: incremental-no-committed-diff");
        return Ok(None);
    }

    // ── 4. Dirty relevant paths (from the already-captured token) ───────────
    let dirty_relevant = relevant_dirty_paths(repo, token)?;

    let mut affected_paths: HashSet<&str> =
        changed_committed.iter().map(String::as_str).collect();
    affected_paths.extend(dirty_relevant.iter().map(String::as_str));

    // ── 5. Current corpus and the affected set ──────────────────────────────
    let current_names = crate::span::read::list_span_names_in(repo, span_root)?;
    let mut affected: HashSet<String> = HashSet::new();
    for name in &current_names {
        let span_file = format!("{span_root}/{name}");
        let is_affected = match ancestor_by_name.get(name.as_str()) {
            // New (or renamed) span: no ancestor to reuse.
            None => true,
            Some(sc) => {
                // The span definition changed (or is dirty)…
                affected_paths.contains(span_file.as_str())
                    // …or one of its anchored source paths changed / is dirty…
                    || sc
                        .anchors
                        .iter()
                        .any(|(_, a)| affected_paths.contains(a.anchored.path.as_str()))
                    // …or it is relocation/copy/move-sensitive and ANY tracked
                    // path changed (the correctness landmine — conservative
                    // over-widening). A span the ancestor's index/worktree made
                    // dirty is *already* widen-marked here: any dirt that alters
                    // an anchor makes its observation non-`Fresh`, and any dirt
                    // that does not alter an anchor cannot change its reused
                    // core — so no separate "ancestor was clean" gate is needed.
                    || (widen_names.contains(name) && !affected_paths.is_empty())
            }
        };
        if is_affected {
            affected.insert(name.clone());
        }
    }

    // How many current spans actually reuse an ancestor core.
    let reused_count = current_names
        .iter()
        .filter(|n| !affected.contains(n.as_str()) && ancestor_by_name.contains_key(n.as_str()))
        .count();
    if reused_count == 0 {
        // Nothing to reuse (everything affected / global-widen forced full
        // re-resolution): let the cold path handle it uniformly. This is the
        // "degrade to full resolution" case the plan's exit gate names.
        crate::perf::note("cache-path.bypass-reason: incremental-no-reuse");
        return Ok(None);
    }

    // ── 6. Re-resolve only the affected subset ──────────────────────────────
    let affected_names: Vec<String> = current_names
        .iter()
        .filter(|n| affected.contains(n.as_str()))
        .cloned()
        .collect();
    let fresh_core = capture_resolution_core(repo, span_root, &affected_names)?;
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

    // ── 7. Combine in canonical (list) order ────────────────────────────────
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
        } else if let Some(sc) = ancestor_by_name.get(name.as_str()) {
            spans.push((*sc).clone());
        }
    }

    Ok(Some(IncrementalBuild {
        core: ResolutionCore { spans },
        anchor_resolutions,
        reused: reused_count,
        resolved: resolved_count,
    }))
}

/// The set of relevant paths whose current index/worktree content differs from
/// HEAD. Derived from the already-captured [`StateToken`] (its per-path staged
/// and worktree identities) compared against each path's HEAD blob. Conservative
/// by construction: a filter-normalized path (whose raw worktree bytes differ
/// from its raw HEAD blob bytes) is reported dirty even if git would call it
/// clean — over-reporting only costs an extra re-resolve, never a stale reuse.
fn relevant_dirty_paths(repo: &gix::Repository, token: &StateToken) -> Result<HashSet<String>> {
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
        let head_oid = head_blob_oid(repo, path)?;
        let staged_clean = staged_clean(staged.get(path).copied(), head_oid.as_deref());
        let worktree_clean =
            worktree_clean(repo, worktree.get(path).copied(), head_oid.as_deref());
        if !(staged_clean && worktree_clean) {
            dirty.insert(path.to_string());
        }
    }
    Ok(dirty)
}

/// HEAD blob OID (hex) for `path`, or `None` when the path is absent at HEAD or
/// is not a blob.
fn head_blob_oid(repo: &gix::Repository, path: &str) -> Result<Option<String>> {
    Ok(
        match crate::git::tree_entry_at(repo, "HEAD", Path::new(path))? {
            Some((mode, oid)) if mode.is_blob() => Some(oid.to_string()),
            _ => None,
        },
    )
}

/// Whether the staged (index) content of a path matches HEAD.
fn staged_clean(state: Option<&PathState>, head_oid: Option<&str>) -> bool {
    match state {
        None | Some(PathState::Absent) => head_oid.is_none(),
        Some(PathState::Tracked { blob }) => head_oid == Some(blob.as_str()),
        // Conflict / Unreadable / (unexpected) worktree content are all "not
        // provably clean" → dirty.
        _ => false,
    }
}

/// Whether the worktree content of a path matches HEAD (compared as a BLAKE3
/// digest of raw bytes — the same digest the token stores for worktree state).
fn worktree_clean(repo: &gix::Repository, state: Option<&PathState>, head_oid: Option<&str>) -> bool {
    match state {
        None | Some(PathState::Absent) => head_oid.is_none(),
        Some(PathState::WorktreeContent { content_digest }) => match head_oid {
            Some(oid) => head_blob_content_digest(repo, oid).as_deref() == Some(content_digest),
            None => false,
        },
        // Tracked (unexpected for worktree) / Conflict / Unreadable → dirty.
        _ => false,
    }
}

/// BLAKE3 digest (lowercase hex) of a HEAD blob's raw bytes, matching the
/// worktree `content_digest` the token captures. `None` when the blob cannot be
/// read (treated as "not provably equal" → dirty by the caller).
fn head_blob_content_digest(repo: &gix::Repository, oid_hex: &str) -> Option<String> {
    let bytes = crate::git::read_blob_bytes(repo, oid_hex).ok()?;
    Some(hex_bytes(blake3::hash(&bytes).as_bytes()))
}

fn hex_bytes(b: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(b.len() * 2);
    for byte in b {
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

// ── Test observability ───────────────────────────────────────────────────────
//
// A thread-local anchor-resolution counter (nextest runs each test in its own
// process, one call graph per thread) so a test can assert the "zero anchor
// resolutions for an unrelated commit" property directly. In a non-test build
// `incr_*` is a no-op the optimizer removes.

#[cfg(not(test))]
#[inline]
fn incr_incremental_anchor_resolutions(_n: u64) {}

#[cfg(test)]
thread_local! {
    static TEST_INCR_ANCHOR_RESOLUTIONS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn incr_incremental_anchor_resolutions(n: u64) {
    TEST_INCR_ANCHOR_RESOLUTIONS.with(|c| c.set(c.get() + n));
}

#[cfg(test)]
fn reset_incremental_test_state() {
    TEST_INCR_ANCHOR_RESOLUTIONS.with(|c| c.set(0));
}

#[cfg(test)]
fn test_incremental_anchor_resolutions() -> u64 {
    TEST_INCR_ANCHOR_RESOLUTIONS.with(std::cell::Cell::get)
}
