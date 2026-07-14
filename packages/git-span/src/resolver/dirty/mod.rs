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
//!    reason (e.g. a staged UNRELATED file moved the whole-index checksum);
//!    nothing is proportionally reusable, so degrade to cold.
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
    /// Anchors actually re-resolved (0 is impossible here — the dirty path only
    /// engages when a relevant path is dirty and its span is re-resolved).
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
    let widen_names = reuse::reuse_rows_widen(&baseline.generation.rows);
    let baseline_by_name: HashMap<&str, &SpanCore> = baseline_core
        .spans
        .iter()
        .map(|s| (s.name.as_str(), s))
        .collect();

    // ── 3. Dirty relevant paths (from the already-captured token) ───────────
    let dirty_paths = incremental::relevant_dirty_paths(repo, token)?;
    if dirty_paths.is_empty() {
        // The exact key differs but no relevant path is dirty — the difference
        // is a non-content signal (e.g. a staged UNRELATED file that moved the
        // whole-index checksum). Nothing is proportionally reusable without
        // risking a stale reuse; degrade to the authoritative cold path.
        crate::perf::note("cache-path.bypass-reason: dirty-no-relevant-dirt");
        return Ok(None);
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
