//! Temporary execution seam wiring the Phase 1 `core` contract and the Phase 2
//! `store` engine into the live `git span stale` path (card main-157 Phase 3,
//! sub-scope 3C).
//!
//! Phases 1/2 and sub-tasks 3A/3B built every piece this module needs but never
//! called them from a real invocation:
//!
//! * 3A's [`capture_resolution_core`](crate::resolver::engine::capture_resolution_core)
//!   resolves a span set *once* into a layer-neutral
//!   [`ResolutionCore`](crate::resolver::core::resolution::ResolutionCore),
//!   closing the `cache_v2` double-resolve (`build_committed_spans` +
//!   `build_clean_whole_result`) traced in `notes/investigation-question-log.md`
//!   Step 4.
//! * 3B's [`capture_state_token`] / [`revalidate`] snapshot and re-read the
//!   complete invocation state.
//! * Phase 2's [`CacheStore`] stores and integrity-verifies one atomic
//!   generation per canonical key.
//!
//! This module is the seam that finally exercises them, behind ONE temporary
//! opt-in development switch (`GIT_SPAN_CACHE_STORE_V3`). It is deliberately
//! thin and disposable: Phase 7 deletes it (and the switch) once the new store
//! is the only path. Its correctness contract:
//!
//! * **Inert by default.** With the switch unset the entry point returns
//!   [`ExactAttempt::Bypass`] before touching any state, and the caller runs
//!   exactly today's `cache_v2`/`cache` path — byte-for-byte unchanged.
//! * **All-off means all-off.** When the two legacy switches together select
//!   the Phase 0 oracle's "every persistent tier disabled" mode
//!   (`GIT_SPAN_CACHE=0` AND `GIT_SPAN_CACHE_V2=0`), the new path is bypassed
//!   too — no cache work of any kind, old or new.
//! * **Exact hit reads only the compact summary.** A verified generation is
//!   decoded and projected in memory (no baseline row regroup, no anchored-blob
//!   availability scan, no full anchored-source resolution). The only git I/O
//!   is the unavoidable `O(N + S)` external state proof
//!   [`capture_state_token`] performs to key the read — reading `.git/index`,
//!   the relevant worktree paths, and the small committed `.span` sidecars,
//!   never resolving anchors.
//! * **Cold miss does exactly one build.** [`capture_resolution_core`] runs
//!   once; the result is projected, revalidated, and (only if the snapshot
//!   still holds) published in one transaction. A publish failure fails closed
//!   on the *cache*, never on the command — the already-computed result is
//!   rendered regardless.
//!
//! ## Revalidate-mismatch decision
//!
//! When [`revalidate`] reports the snapshot moved between capture and publish:
//!
//! * a **`head`-only** move leaves the canonical key (which excludes HEAD while
//!   output is content-only — see `notes/correctness-contract.md` "Explicit
//!   Decisions") and every resolution input unchanged, so the single-pass core
//!   is still a consistent, correct result. We render it and simply skip the
//!   publish (the stored HEAD *hint* would be stale).
//! * any **other** field moving means a resolution input changed mid-build, so
//!   the single-pass core may be a torn read. We discard it and return
//!   [`ExactAttempt::Bypass`], falling back to the authoritative path rather
//!   than rendering a possibly-inconsistent snapshot. This matches Snapshot
//!   Rule 4 ("If any token changed, the candidate is discarded").

use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::Result;
use crate::resolver::WholeResult;
use crate::resolver::cache_v2::dto::SpanResolvedDto;
use crate::resolver::core::capture::{Revalidation, capture_state_token, revalidate};
use crate::resolver::core::project::project_effective;
use crate::resolver::core::resolution::ResolutionCore;
use crate::resolver::engine::{
    capture_resolution_core, sort_spans_by_anchor_path, span_is_reportable_in_stale_discovery,
};
use crate::resolver::store::{CacheStore, GenerationInput, GetOutcome};
use crate::types::{EngineOptions, LayerSet, SpanResolved};
use std::sync::Arc;

#[cfg(test)]
mod tests;

/// Payload/schema version for every generation this seam publishes. The stored
/// summary is a bincode-encoded [`StaleSummary`] — the compact, render-ready
/// projection, NOT the full [`ResolutionCore`]. Bump on any change to that
/// encoding so an old-shape row is rejected (a miss + rebuild) rather than
/// misdecoded.
///
/// Version 1 stored `bincode(ResolutionCore)` (four per-layer observations per
/// anchor); version 2 stores the single projected effective view plus the
/// committed anchor totals, ~2.4x smaller and render-ready with no per-hit
/// re-projection of layer observations.
const SUMMARY_VERSION: u32 = 2;

/// Max entries in the bounded in-process memo. Small and explicit: this is a
/// per-process working-set cache for repeated same-key `stale` calls within one
/// library run (e.g. tests, or a long-lived embedding), not a persistence tier.
const MEMO_CAP: usize = 32;

/// Outcome of the new-store attempt.
pub(crate) enum ExactAttempt {
    /// The new path produced the reportable span set. The caller renders this
    /// directly and does not touch the legacy caches.
    ///
    /// `whole_result` carries the render-ready full command result (every
    /// committed span with every anchor in stored order, plus per-span anchor
    /// totals) — the exact `cache_v2` warm-clean shape. Handing it back lets
    /// [`run_stale`](crate::cli::stale_output) skip the per-invocation corpus
    /// reload (`load_all_spans_in` for count-totals, the Fresh-anchor backfill,
    /// and the interior-anchor scan) that the legacy warm path also skips. It is
    /// `Some` whenever the summary is available (exact hit, memo hit, or the
    /// one-build cold miss) — the warm read is then a single compact-summary
    /// decode with no anchored-blob or `.span` corpus work.
    Resolved {
        spans: Vec<SpanResolved>,
        whole_result: Option<WholeResult>,
    },
    /// The new path did not engage (switch unset, all-off, ineligible options,
    /// a store fault, or a torn-read fallback). The caller runs the existing
    /// `cache_v2`/`cache` path exactly as before.
    Bypass,
}

/// The compact, render-ready generation summary this seam persists (schema
/// [`SUMMARY_VERSION`]). It carries exactly what `run_stale` renders from — the
/// projected effective view — and nothing the cold path needs but a warm render
/// does not (no per-layer `head`/`index`/`worktree` observations, no ordinal
/// digests, no anchored-source scan input).
///
/// `spans` is the full effective set (every committed span, every anchor in
/// stored order, Fresh siblings included) so an exact hit reconstructs both the
/// reportable discovery set (`reportable` filter) and the whole-result the CLI
/// short-circuits on, without re-reading the `.span` corpus. Shape-compatible
/// with the legacy `cache_v2` whole-result blob it replaces, so the size
/// comparison in this card's report is apples-to-apples.
///
/// Forward-compatibility (Phase 4/5, out of scope here): the incremental and
/// dirty paths will additionally need the per-layer `ResolutionCore` detail
/// persisted (as normalized reuse rows + the reverse path index — already
/// carried by `GenerationInput::rows`/`path_index`, empty in Phase 3). The
/// compact summary is additive to those, not a replacement, so those phases add
/// rows without reshaping this summary. It reuses `cache_v2::dto::SpanResolvedDto`
/// today; Phase 7 (which deletes `cache_v2`) must relocate that DTO into the
/// store/core layer alongside this type.
#[derive(Serialize, Deserialize)]
struct StaleSummary {
    /// Full effective set: every committed span with every anchor in stored
    /// order (Fresh + non-Fresh), render-ready.
    spans: Vec<SpanResolvedDto>,
    /// `(committed span name, anchor count)` — the count-totals input the CLI
    /// otherwise recomputes from a corpus reload.
    span_anchor_totals: Vec<(String, usize)>,
}

/// Decoded, in-memory render-ready form: the full effective set plus committed
/// totals. Held in the bounded memo and produced once per cold build; every hit
/// renders straight from it with no re-projection and no corpus read.
struct RenderReady {
    /// Full effective set (whole-result spans).
    full: Vec<SpanResolved>,
    span_anchor_totals: Vec<(String, usize)>,
}

impl RenderReady {
    /// Project the layer-neutral core into the render-ready form: the full
    /// effective view plus per-span committed anchor totals derived from it.
    ///
    /// On the clean, persistence-eligible state that publishes a generation the
    /// worktree equals HEAD, so the projected effective set's span/anchor
    /// membership is exactly the committed corpus — the same set (and the same
    /// per-span anchor counts) `run_stale`'s `count-totals` derives from
    /// `load_all_spans_in`. Deriving totals here (rather than reloading the
    /// corpus on the warm hit) is what removes the duplicate read.
    fn from_core(core: &ResolutionCore, layers: LayerSet) -> Self {
        let full = project_effective(core, layers);
        let span_anchor_totals = full
            .iter()
            .map(|s| (s.name.clone(), s.anchors.len()))
            .collect();
        Self {
            full,
            span_anchor_totals,
        }
    }

    /// Build the caller-facing outcome: the reportable, sorted discovery set
    /// plus the whole-result the CLI short-circuits on. Both derive from the one
    /// full set, so cold miss, memo hit, and store hit are identical by
    /// construction — the same invariant [`render`]-through-one-function gave
    /// before, now extended to the whole-result.
    fn to_attempt(&self) -> ExactAttempt {
        let mut spans: Vec<SpanResolved> = self
            .full
            .iter()
            .filter(|s| span_is_reportable_in_stale_discovery(s))
            .cloned()
            .collect();
        if spans.len() > 1 {
            sort_spans_by_anchor_path(&mut spans);
        }
        let whole_result = WholeResult {
            spans: self.full.clone(),
            span_anchor_totals: self.span_anchor_totals.clone(),
        };
        ExactAttempt::Resolved {
            spans,
            whole_result: Some(whole_result),
        }
    }
}

/// Whether the two legacy switches together select the Phase 0 oracle's
/// "every persistent tier disabled" ground-truth mode. In that mode the new
/// path must also be fully bypassed.
fn env_all_off() -> bool {
    std::env::var("GIT_SPAN_CACHE").as_deref() == Ok("0")
        && std::env::var("GIT_SPAN_CACHE_V2").as_deref() == Ok("0")
}

/// Whether the temporary development switch explicitly selects the new store.
fn v3_selected() -> bool {
    matches!(
        std::env::var("GIT_SPAN_CACHE_STORE_V3")
            .as_deref()
            .map(str::trim),
        Ok("1") | Ok("true") | Ok("on") | Ok("yes")
    )
}

/// Eligibility gate. Mirrors `cache_v2::ineligible_reason` (full layer set, no
/// `--since`) and additionally requires the default fuzzy threshold, because
/// [`capture_resolution_core`] resolves with a fixed `0.95` threshold; any
/// other value must fall back so the projected result cannot silently diverge.
fn eligible(options: &EngineOptions) -> bool {
    options.since.is_none()
        && options.layers == LayerSet::full()
        && (options.fuzzy_threshold - 0.95).abs() < 1e-9
}

/// The temporary new-store execution path for `git span stale` discovery.
///
/// Returns [`ExactAttempt::Resolved`] with the reportable span set on an exact
/// hit or a one-build cold miss, or [`ExactAttempt::Bypass`] when the new path
/// is not selected / not eligible / faulted, in which case the caller runs the
/// legacy path unchanged.
pub(crate) fn stale_spans_new_store(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<ExactAttempt> {
    if !v3_selected() || env_all_off() || !eligible(&options) {
        return Ok(ExactAttempt::Bypass);
    }
    let _perf = crate::perf::span("resolver.store_v3");

    // Snapshot the complete invocation state up front: this is both the exact
    // read key and the baseline `revalidate` diffs against after a cold build.
    // A capture failure is a fail-closed bypass to the authoritative path.
    let token = match capture_state_token(repo, span_root, options) {
        Ok(t) => t,
        Err(e) => {
            crate::perf::note(&format!("cache-path.bypass-reason: capture-token: {e}"));
            return Ok(ExactAttempt::Bypass);
        }
    };
    let key = token.canonical_key_digest();

    // In-process memo: a repeated same-key call within this process renders
    // straight from the working-set summary with no SQLite read at all.
    if let Some(rr) = memo_get(&key) {
        emit_hit_class("exact-memo");
        return Ok(rr.to_attempt());
    }

    let mut store = match CacheStore::open(repo) {
        Ok(s) => s,
        Err(e) => {
            crate::perf::note(&format!("cache-path.bypass-reason: store-open: {e}"));
            return Ok(ExactAttempt::Bypass);
        }
    };

    // ── Exact hit ──────────────────────────────────────────────────────────
    //
    // The whole warm cost is this branch: capture the state token (above), read
    // and integrity-verify the one compact summary, decode it, render. No
    // baseline row regroup, no `.span` corpus reload, no anchored-blob scan.
    match store.get_generation(&key, SUMMARY_VERSION) {
        Ok(GetOutcome::Hit(g)) => match decode_summary(&g.summary) {
            Ok(rr) => {
                let _ = store.touch(&key);
                let rr = Arc::new(rr);
                memo_put(key, Arc::clone(&rr));
                emit_hit_class("exact");
                incr_exact_hits();
                crate::perf::counter("cache-path.exact-hit", 1);
                return Ok(rr.to_attempt());
            }
            // A verified-but-undecodable summary is a corrupt hit: treat as a
            // miss and rebuild (fail closed on trust, not on the command).
            Err(()) => {
                crate::perf::note("cache-path.bypass-reason: summary-decode");
            }
        },
        Ok(GetOutcome::Miss) => {}
        Ok(GetOutcome::Rejected(reason)) => {
            crate::perf::note(&format!("cache-path.bypass-reason: rejected-{reason:?}"));
        }
        Err(e) => {
            crate::perf::note(&format!("cache-path.bypass-reason: get: {e}"));
            return Ok(ExactAttempt::Bypass);
        }
    }

    // ── Cold miss: exactly one build ────────────────────────────────────────
    cold_miss(repo, span_root, options, &token, &key, &mut store)
}

/// The one-build cold-miss path. Resolves a single [`ResolutionCore`], projects
/// it, revalidates the snapshot, and publishes only if it still holds.
fn cold_miss(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &crate::resolver::core::token::StateToken,
    key: &[u8; 32],
    store: &mut CacheStore,
) -> Result<ExactAttempt> {
    let names = crate::span::read::list_span_names_in(repo, span_root)?;

    // THE single resolver build. Every path below renders from this one core;
    // nothing re-resolves.
    let core = capture_resolution_core(repo, span_root, &names)?;
    incr_cold_miss_builds();
    crate::perf::counter("cache-path.cold-miss-builds", 1);
    emit_hit_class("miss");

    // Test seam: simulate a state mutation *during* the build (i.e. between the
    // original capture and the pre-publish re-read) so the revalidate-discards
    // path is exercisable in-process.
    #[cfg(test)]
    fire_after_build_hook();

    // Project ONCE into the compact render-ready form. Both the cold return and
    // the persisted summary derive from this; there is no second projection or
    // re-resolve.
    let rr = Arc::new(RenderReady::from_core(&core, options.layers));

    match revalidate(repo, span_root, options, token)? {
        Revalidation::Unchanged => {
            publish_if_eligible(store, token, key, &rr);
            let attempt = rr.to_attempt();
            memo_put(*key, rr);
            Ok(attempt)
        }
        Revalidation::Changed { field } => {
            incr_revalidate_discards();
            crate::perf::counter("cache-path.revalidate-discarded", 1);
            crate::perf::note(&format!("cache-path.revalidate-discarded: {field}"));
            if field == "head" {
                // Content-only key and every resolution input unchanged: the
                // computed core is still correct. Render it; skip the publish
                // (the HEAD hint moved) and skip the memo (state is moving).
                Ok(rr.to_attempt())
            } else {
                // A resolution input moved mid-build — possible torn read.
                // Discard and fall back to the authoritative path.
                crate::perf::note("cache-path.bypass-reason: revalidate-torn-read");
                Ok(ExactAttempt::Bypass)
            }
        }
    }
}

/// Publish the computed generation, but only when the snapshot is persistence
/// eligible. A publish failure is recorded and swallowed: fail closed on the
/// cache, never on the command.
fn publish_if_eligible(
    store: &mut CacheStore,
    token: &crate::resolver::core::token::StateToken,
    key: &[u8; 32],
    rr: &RenderReady,
) {
    if !token.persistence_eligible() {
        crate::perf::note("cache-path.publish-skipped: ineligible");
        return;
    }
    let input = GenerationInput {
        key_digest: *key,
        head: token.head.clone(),
        payload_version: SUMMARY_VERSION,
        summary: encode_summary(rr),
        // Exact-hit rendering reads only the summary; normalized reuse rows and
        // the reverse path index are populated by Phase 4's incremental path.
        rows: Vec::new(),
        path_index: Vec::new(),
        // The current worktree references this generation at publish time.
        live: true,
    };
    match store.publish_generation(&input) {
        Ok(()) => {
            crate::perf::counter("cache-path.publish-ok", 1);
        }
        Err(e) => {
            incr_publish_failures();
            crate::perf::counter("cache-path.publish-failed", 1);
            crate::perf::note(&format!("cache-path.publish-failed: {e}"));
        }
    }
}

/// Encode the compact, render-ready summary for persistence: the projected
/// effective spans (via the render DTO) plus committed totals. This is the
/// bytes wrapped in the integrity envelope by `publish_generation` — the
/// compact replacement for the former `bincode(ResolutionCore)`.
fn encode_summary(rr: &RenderReady) -> Vec<u8> {
    let dto = StaleSummary {
        spans: rr.full.iter().map(SpanResolvedDto::from).collect(),
        span_anchor_totals: rr.span_anchor_totals.clone(),
    };
    bincode::serialize(&dto).expect("serialize StaleSummary for generation summary")
}

/// Decode a verified summary back into the render-ready form. `Err(())` on any
/// decode/convert failure — the caller treats a verified-but-undecodable
/// summary as a miss and rebuilds (fail closed on trust, not on the command).
fn decode_summary(bytes: &[u8]) -> std::result::Result<RenderReady, ()> {
    let dto: StaleSummary = bincode::deserialize(bytes).map_err(|_| ())?;
    let mut full = Vec::with_capacity(dto.spans.len());
    for s in dto.spans {
        full.push(SpanResolved::try_from(s).map_err(|_| ())?);
    }
    Ok(RenderReady {
        full,
        span_anchor_totals: dto.span_anchor_totals,
    })
}

/// Emit the Phase 0 normalized cache-path hit-class label (stderr only under
/// `--perf`/`GIT_SPAN_PERF`), matching the labels `stale_spans` emits so a
/// single legend covers both the legacy and new paths.
fn emit_hit_class(class: &str) {
    crate::perf::note(&format!("cache-path.hit-class: {class}"));
}

// ── Bounded in-process memo ──────────────────────────────────────────────────

struct BoundedMemo {
    map: HashMap<[u8; 32], Arc<RenderReady>>,
    order: VecDeque<[u8; 32]>,
    cap: usize,
}

impl BoundedMemo {
    fn new(cap: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            cap,
        }
    }

    fn get(&self, key: &[u8; 32]) -> Option<Arc<RenderReady>> {
        self.map.get(key).map(Arc::clone)
    }

    fn put(&mut self, key: [u8; 32], value: Arc<RenderReady>) {
        if self.map.insert(key, value).is_some() {
            // Already present: value refreshed, insertion order unchanged.
            return;
        }
        self.order.push_back(key);
        while self.order.len() > self.cap {
            if let Some(evicted) = self.order.pop_front() {
                self.map.remove(&evicted);
            }
        }
    }
}

static MEMO: LazyLock<Mutex<BoundedMemo>> =
    LazyLock::new(|| Mutex::new(BoundedMemo::new(MEMO_CAP)));

fn memo_get(key: &[u8; 32]) -> Option<Arc<RenderReady>> {
    MEMO.lock().ok().and_then(|m| m.get(key))
}

fn memo_put(key: [u8; 32], value: Arc<RenderReady>) {
    if let Ok(mut m) = MEMO.lock() {
        m.put(key, value);
    }
}

/// Drop every memoized core so a test can force a real store read/build.
#[cfg(test)]
fn clear_memo() {
    if let Ok(mut m) = MEMO.lock() {
        m.map.clear();
        m.order.clear();
    }
}

// ── Test observability ───────────────────────────────────────────────────────
//
// Thread-local counters (one call graph per `cargo test` thread) let an
// in-process test assert the one-build / revalidate-discard / publish-failure
// properties without parsing subprocess stderr or racing a process-global. In
// a non-test build every `incr_*` is a no-op the optimizer removes.

#[cfg(not(test))]
#[inline]
fn incr_cold_miss_builds() {}
#[cfg(not(test))]
#[inline]
fn incr_exact_hits() {}
#[cfg(not(test))]
#[inline]
fn incr_revalidate_discards() {}
#[cfg(not(test))]
#[inline]
fn incr_publish_failures() {}

#[cfg(test)]
thread_local! {
    static TEST_COLD_MISS_BUILDS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static TEST_EXACT_HITS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static TEST_REVALIDATE_DISCARDS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static TEST_PUBLISH_FAILURES: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static AFTER_BUILD_HOOK: std::cell::RefCell<Option<Box<dyn FnMut()>>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn incr_cold_miss_builds() {
    TEST_COLD_MISS_BUILDS.with(|c| c.set(c.get() + 1));
}
#[cfg(test)]
fn incr_exact_hits() {
    TEST_EXACT_HITS.with(|c| c.set(c.get() + 1));
}
#[cfg(test)]
fn incr_revalidate_discards() {
    TEST_REVALIDATE_DISCARDS.with(|c| c.set(c.get() + 1));
}
#[cfg(test)]
fn incr_publish_failures() {
    TEST_PUBLISH_FAILURES.with(|c| c.set(c.get() + 1));
}

/// Reset every thread-local test counter and clear any installed after-build
/// hook. Call at the top of each in-process test so a prior test on the same
/// thread cannot leak state.
#[cfg(test)]
fn reset_test_state() {
    TEST_COLD_MISS_BUILDS.with(|c| c.set(0));
    TEST_EXACT_HITS.with(|c| c.set(0));
    TEST_REVALIDATE_DISCARDS.with(|c| c.set(0));
    TEST_PUBLISH_FAILURES.with(|c| c.set(0));
    AFTER_BUILD_HOOK.with(|h| *h.borrow_mut() = None);
}

#[cfg(test)]
fn test_cold_miss_builds() -> u64 {
    TEST_COLD_MISS_BUILDS.with(std::cell::Cell::get)
}
#[cfg(test)]
fn test_exact_hits() -> u64 {
    TEST_EXACT_HITS.with(std::cell::Cell::get)
}
#[cfg(test)]
fn test_revalidate_discards() -> u64 {
    TEST_REVALIDATE_DISCARDS.with(std::cell::Cell::get)
}
#[cfg(test)]
fn test_publish_failures() -> u64 {
    TEST_PUBLISH_FAILURES.with(std::cell::Cell::get)
}

/// Install a callback fired once, in-process, right after the single cold-miss
/// build completes (i.e. between the original state capture and the pre-publish
/// re-read). Lets a test mutate the worktree/index/HEAD to drive the
/// revalidate-discard path deterministically.
#[cfg(test)]
fn set_after_build_hook<F: FnMut() + 'static>(f: F) {
    AFTER_BUILD_HOOK.with(|h| *h.borrow_mut() = Some(Box::new(f)));
}

#[cfg(test)]
fn fire_after_build_hook() {
    // Take the hook out so it fires at most once per build.
    let hook = AFTER_BUILD_HOOK.with(|h| h.borrow_mut().take());
    if let Some(mut f) = hook {
        f();
    }
}
