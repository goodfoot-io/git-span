//! Execution seam wiring the `core` resolution contract and the `store` engine
//! into the live `git span stale` path (card main-157).
//!
//! This is THE cache path for `git span stale`: the greenfield cutover
//! (Phase 7) deleted both legacy caches (`resolver::cache`, `resolver::cache_v2`),
//! so an [`ExactAttempt::Bypass`] falls straight through to the uncached
//! authoritative resolver ([`stale_spans_inner`](crate::resolver::engine)) with
//! no intervening legacy tier. The pieces this seam drives:
//!
//! * [`capture_resolution_core`](crate::resolver::engine::capture_resolution_core)
//!   resolves a span set *once* into a layer-neutral
//!   [`ResolutionCore`](crate::resolver::core::resolution::ResolutionCore).
//! * [`capture_state_token`] / [`revalidate`] snapshot and re-read the
//!   complete invocation state.
//! * [`CacheStore`] stores and integrity-verifies one atomic generation per
//!   canonical key.
//!
//! Its correctness contract:
//!
//! * **Unconditional by default.** The store engages on every eligible run.
//!   There is no opt-in switch to enable it.
//! * **One disable control.** `GIT_SPAN_CACHE=0` bypasses every cache tier;
//!   the entry point returns [`ExactAttempt::Bypass`] before touching any
//!   state, and the caller runs the uncached authoritative resolver — no cache
//!   work of any kind. This is the single "disable all caching" switch
//!   (`notes/correctness-contract.md`); the pre-cutover `GIT_SPAN_CACHE_V2` /
//!   `GIT_SPAN_CACHE_STORE_V3` switches no longer exist.
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
//!   rendered regardless. The "exactly one build" guarantee holds *across
//!   concurrent callers too*: after the unlocked exact read misses, the miss
//!   tail ([`stale_spans_new_store_inner`]) serializes same-key rebuilders on
//!   the key's build-lock shard and rechecks the store under it, so N
//!   simultaneous cold callers for one missing key collapse to a single build
//!   and the losers render the winner's published generation.
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
use crate::resolver::core::capture::{Revalidation, capture_state_token, revalidate};
use crate::resolver::core::project::project_effective;
use crate::resolver::core::resolution::ResolutionCore;
use crate::resolver::engine::{
    capture_resolution_core, sort_spans_by_anchor_path, span_is_reportable_in_stale_discovery,
};
use crate::resolver::store::dto::SpanResolvedDto;
use crate::resolver::store::lock::{acquire_build_shard, shard_index};
use crate::resolver::store::{CacheStore, GcStats, GenerationInput, GetOutcome};
use crate::types::{CopyDetection, EngineOptions, LayerSet, SpanResolved};
use std::sync::Arc;

pub(crate) mod reuse;

use crate::resolver::dirty;
use crate::resolver::incremental;

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
///
/// Card main-157 Phase 4 additionally populates the generation's normalized
/// reuse rows (`reuse::core_to_reuse_rows`) under this same version: the rows
/// carry `bincode(ReuseSpanRow)`, so a change to either the summary encoding or
/// the reuse-row encoding must bump this constant (a version mismatch rejects
/// the whole generation — a miss + rebuild — rather than misdecoding either).
pub(crate) const SUMMARY_VERSION: u32 = 2;

/// Max entries in the bounded in-process memo. Small and explicit: this is a
/// per-process working-set cache for repeated same-key `stale` calls within one
/// library run (e.g. tests, or a long-lived embedding), not a persistence tier.
const MEMO_CAP: usize = 32;

/// Outcome of the store attempt.
pub(crate) enum ExactAttempt {
    /// The store produced the reportable span set. The caller renders this
    /// directly.
    ///
    /// `whole_result` carries the render-ready full command result (every
    /// committed span with every anchor in stored order, plus per-span anchor
    /// totals) — the warm-clean shape. Handing it back lets
    /// [`run_stale`](crate::cli::stale_output) skip the per-invocation corpus
    /// reload (`load_all_spans_in` for count-totals, the Fresh-anchor backfill,
    /// and the interior-anchor scan). It is
    /// `Some` whenever the summary is available (exact hit, memo hit, or the
    /// one-build cold miss) — the warm read is then a single compact-summary
    /// decode with no anchored-blob or `.span` corpus work.
    Resolved {
        spans: Vec<SpanResolved>,
        whole_result: Option<WholeResult>,
    },
    /// The store did not engage (cache disabled, ineligible options, a store
    /// fault, or a torn-read fallback). The caller runs the uncached
    /// authoritative resolver directly.
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
/// short-circuits on, without re-reading the `.span` corpus.
///
/// The incremental and dirty paths additionally persist the per-layer
/// `ResolutionCore` detail (as normalized reuse rows + the reverse path index,
/// carried by `GenerationInput::rows`/`path_index`). The compact summary is
/// additive to those, not a replacement, so those paths add rows without
/// reshaping this summary. It serializes through
/// [`SpanResolvedDto`](crate::resolver::store::dto::SpanResolvedDto).
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

/// Whether the single cache-disable switch is set. `GIT_SPAN_CACHE=0` disables
/// every cache tier: the store is bypassed and the caller runs the uncached
/// authoritative resolver directly.
///
/// Note the semantic shift from the pre-cutover world: `GIT_SPAN_CACHE=0` once
/// meant "disable the filesystem drift-locus tier only, leave SQLite on". After
/// the greenfield cutover there is exactly ONE cache (this store) and exactly
/// one disable control, so `GIT_SPAN_CACHE=0` now means "disable everything"
/// (`notes/correctness-contract.md`: "one cache-disable control bypasses every
/// memory and disk tier").
fn cache_disabled() -> bool {
    std::env::var("GIT_SPAN_CACHE").as_deref() == Ok("0")
}

/// Eligibility gate: full layer set, no `--since`, and additionally the default
/// fuzzy threshold, because
/// [`capture_resolution_core`] resolves with a fixed `0.95` threshold; any
/// other value must fall back so the projected result cannot silently diverge.
fn eligible(options: &EngineOptions) -> bool {
    options.since.is_none()
        && options.layers == LayerSet::full()
        && (options.fuzzy_threshold - 0.95).abs() < 1e-9
}

/// Default store byte ceiling: 256 MiB (`notes/architecture-and-complexity.md`
/// GC section). The bounded quota [`CacheStore::maintain`] enforces after a
/// publish; overridable per-repo (see [`store_max_bytes`]).
pub(crate) const DEFAULT_STORE_MAX_BYTES: u64 = 268_435_456;

/// Resolve the configured store byte ceiling for `repo`.
///
/// Precedence mirrors the span-dir chain (`GIT_SPAN_DIR` env > `git config
/// git-span.dir` > default) in [`crate::cli::dispatch`]: the
/// `GIT_SPAN_STORE_MAX_BYTES` environment override wins over `git config
/// git-span.storeMaxBytes`, which wins over [`DEFAULT_STORE_MAX_BYTES`]. An
/// absent or unparseable value at either layer falls through to the next — a
/// bad override degrades to the bounded default, never to unbounded growth
/// (fail closed on the quota).
pub(crate) fn store_max_bytes(repo: &gix::Repository) -> u64 {
    if let Ok(raw) = std::env::var("GIT_SPAN_STORE_MAX_BYTES")
        && let Some(n) = parse_byte_ceiling(&raw)
    {
        return n;
    }
    if let Some(raw) = crate::git::config_string(repo, "git-span.storeMaxBytes")
        && let Some(n) = parse_byte_ceiling(&raw)
    {
        return n;
    }
    DEFAULT_STORE_MAX_BYTES
}

/// Parse a byte-ceiling config/env value: a plain non-negative integer count of
/// bytes. `None` on any non-numeric input so the caller falls through to the
/// next precedence layer.
fn parse_byte_ceiling(raw: &str) -> Option<u64> {
    raw.trim().parse::<u64>().ok()
}

/// Whether the whole invocation's effective copy-detection mode is a genuinely
/// global one (a repo/commit-wide copy pool), in which case EVERY span is
/// widened to "any tracked path changed" sensitivity (`reuse`). `SameCommit`
/// (the only mode the file-backed span model expresses today) is local and does
/// not force a global widen; see `reuse`'s module docs.
pub(crate) fn global_copy_widen(token: &crate::resolver::core::token::StateToken) -> bool {
    matches!(
        token.copy_detection,
        CopyDetection::AnyFileInCommit | CopyDetection::AnyFileInRepo
    )
}

/// The store execution path for `git span stale` discovery.
///
/// Returns [`ExactAttempt::Resolved`] with the reportable span set on an exact
/// hit or a one-build cold miss, or [`ExactAttempt::Bypass`] when the cache is
/// disabled / the run is ineligible / a store fault occurs, in which case the
/// caller runs the uncached authoritative resolver.
pub(crate) fn stale_spans_new_store(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
) -> Result<ExactAttempt> {
    if cache_disabled() || !eligible(&options) {
        return Ok(ExactAttempt::Bypass);
    }

    // Uncommitted (worktree-only) span files are NOT part of the canonical key
    // — the token keys only committed span identities (`span_blobs`). Their
    // creation or deletion is therefore invisible to the store, so a deleted
    // untracked/gitignored span could be replayed from a stale generation. Fail
    // closed: bypass to the authoritative resolver whenever any span file exists
    // only in the worktree, exactly the state the pre-cutover cache routed
    // through its dirty overlay.
    match has_uncommitted_span_files(repo, span_root) {
        Ok(false) => {}
        Ok(true) => {
            crate::perf::note("cache-path.bypass-reason: uncommitted-span-files");
            return Ok(ExactAttempt::Bypass);
        }
        Err(e) => {
            crate::perf::note(&format!(
                "cache-path.bypass-reason: uncommitted-span-scan: {e}"
            ));
            return Ok(ExactAttempt::Bypass);
        }
    }

    let _perf = crate::perf::span("resolver.store");

    // Snapshot the complete invocation state up front: this is both the exact
    // read key and the baseline `revalidate` diffs against after a cold build.
    // A capture failure is a fail-closed bypass to the authoritative path.
    let t_observe = crate::perf::enabled().then(std::time::Instant::now);
    let token = match capture_state_token(repo, span_root, options) {
        Ok(t) => t,
        Err(e) => {
            crate::perf::note(&format!("cache-path.bypass-reason: capture-token: {e}"));
            return Ok(ExactAttempt::Bypass);
        }
    };
    if let Some(t) = t_observe {
        crate::perf::counter("cache-path.state-observe-us", t.elapsed().as_micros() as u64);
    }

    let attempt = stale_spans_new_store_inner(repo, span_root, options, &token)?;
    // Two whole-result short-circuit guards `run_stale` depends on. Both keep
    // the reportable `spans` intact; only the whole-result (which lets the CLI
    // skip its per-invocation corpus scans) is withheld.
    let attempt = withhold_whole_result_for_interior_anchor(span_root, attempt);
    withhold_whole_result_for_dirty_tree(repo, &token, attempt)
}

/// Whether any span file exists in the worktree but not at `HEAD` — an
/// untracked or gitignored span the canonical key cannot observe.
fn has_uncommitted_span_files(repo: &gix::Repository, span_root: &str) -> Result<bool> {
    let reader = crate::span_file_reader::SpanFileReader::new(repo, span_root.to_string());
    let committed: std::collections::HashSet<String> =
        reader.committed_span_names()?.into_iter().collect();
    Ok(reader
        .worktree_span_names()?
        .into_iter()
        .any(|name| !committed.contains(&name)))
}

/// Whether any anchor in the resolved full set points inside the span root — a
/// poisoned "interior anchor" that `run_stale` must surface as a loud,
/// fail-closed violation report.
fn full_set_has_interior_anchor(span_root: &str, spans: &[SpanResolved]) -> bool {
    spans.iter().any(|m| {
        m.anchors.iter().any(|a| {
            let path = a.anchored.path.to_string_lossy();
            crate::span_root::classify_interior_anchor(span_root, &path).is_some()
        })
    })
}

/// Drop the render-ready whole-result when the corpus carries a span-root
/// interior anchor.
///
/// `run_stale` skips its interior-anchor scan whenever the store hands back a
/// whole-result (`use_whole_result`), trusting that a persisted result was
/// interior-clean. The store makes no such guarantee, so — exactly as the
/// pre-cutover path did by withholding the whole-result for a poisoned corpus —
/// we return `whole_result: None` here. The reportable `spans` are unaffected;
/// only the short-circuit is suppressed, so the CLI re-scans the live corpus
/// and emits the interior-anchor report (and drives its fail-closed exit).
fn withhold_whole_result_for_interior_anchor(
    span_root: &str,
    attempt: ExactAttempt,
) -> ExactAttempt {
    match attempt {
        ExactAttempt::Resolved {
            spans,
            whole_result: Some(wr),
        } if full_set_has_interior_anchor(span_root, &wr.spans) => ExactAttempt::Resolved {
            spans,
            whole_result: None,
        },
        other => other,
    }
}

/// Drop the render-ready whole-result when the tree is dirty.
///
/// `run_stale` skips its conflict detection and interior-anchor scans on a
/// whole-result hit, trusting (as the pre-cutover cache guaranteed by only
/// returning a whole-result on the warm-CLEAN path) that a dirty or conflicted
/// span could not be hidden behind one. The store's dirty and incremental tiers
/// return correct reportable `spans` for a dirty tree, but they still hand back
/// a whole-result — so a conflicted span file would silently short-circuit the
/// CLI's conflict report. Withhold the whole-result whenever any relevant path
/// (committed span file or anchored source) differs from HEAD, forcing the CLI
/// to run its full corpus scans exactly as it did against the old dirty path.
fn withhold_whole_result_for_dirty_tree(
    repo: &gix::Repository,
    token: &crate::resolver::core::token::StateToken,
    attempt: ExactAttempt,
) -> Result<ExactAttempt> {
    match attempt {
        ExactAttempt::Resolved {
            spans,
            whole_result: Some(wr),
        } => {
            let dirty = incremental::relevant_dirty_paths(repo, token)?;
            let whole_result = if dirty.is_empty() { Some(wr) } else { None };
            Ok(ExactAttempt::Resolved {
                spans,
                whole_result,
            })
        }
        other => Ok(other),
    }
}

fn stale_spans_new_store_inner(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &crate::resolver::core::token::StateToken,
) -> Result<ExactAttempt> {
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

    // Surface a corruption/schema-mismatch recovery this open performed as a
    // diagnostics event regardless of whether a later quota pass runs (6A's
    // `maintain` only folds it into `GcStats` when the store is over cap).
    if let Some(reason) = store.recovered_on_open() {
        crate::perf::note(&format!("cache-path.corruption-recovered: {reason:?}"));
    }

    // ── Exact hit (unlocked fast path) ───────────────────────────────────────
    //
    // The whole warm cost is this branch: capture the state token (above), read
    // and integrity-verify the one compact summary, decode it, render. No
    // baseline row regroup, no `.span` corpus reload, no anchored-blob scan. A
    // verified hit here returns without ever touching the build-lock shard, so a
    // warm read never contends with (or blocks behind) a concurrent cold builder.
    if let Some(attempt) = exact_hit_read(&mut store, &key)? {
        return Ok(attempt);
    }

    // ── Singleflight the miss tail on the key's build-lock shard ─────────────
    //
    // The exact read missed, so this call is a (potentially expensive) rebuild.
    // Serialize every same-key rebuilder on the key's shard so exactly ONE runs
    // the resolve + publish while the rest block, then recheck below and read the
    // sibling's published result — the singleflight discipline the store already
    // encapsulates in `build_or_get`, replicated inline here because the miss
    // tail is a tiered flow (incremental → dirty → cold), not a single builder
    // closure. Distinct keys hash to distinct shards and rebuild concurrently.
    //
    // A shard-acquire fault is a fail-closed bypass to the authoritative
    // resolver, never a command failure — exactly like every other store fault
    // on this path.
    let shard = shard_index(&key, store.shard_count());
    let _build_guard = match acquire_build_shard(store.dir(), shard) {
        Ok(g) => g,
        Err(e) => {
            crate::perf::note(&format!("cache-path.bypass-reason: build-shard: {e}"));
            return Ok(ExactAttempt::Bypass);
        }
    };

    // Recheck the exact generation under the lock: a sibling rebuilder may have
    // published it while we waited for the shard. This is what collapses N
    // simultaneous cold callers to one build — the losers of the lock race find
    // the winner's published generation here and render straight from it.
    if let Some(attempt) = exact_hit_read(&mut store, &key)? {
        return Ok(attempt);
    }

    // ── Incremental miss: reuse an ancestor generation ──────────────────────
    //
    // Between the exact-miss above and the full cold build below, try to
    // reconstruct this generation from a cached ancestor: reuse every unchanged
    // span's stored `SpanCore`, re-resolving only the spans a committed/dirty
    // path change (or the global-widen union) can affect. A `None` means no
    // usable ancestor / nothing reusable — fall through to the authoritative
    // one-build cold path unchanged. Re-attempted under the shard lock, so a
    // sibling's just-published baseline is visible to it.
    if let Some(attempt) =
        incremental::attempt(repo, span_root, options, token, &key, &mut store)?
    {
        return Ok(attempt);
    }

    // ── Dirty miss: reuse a same-HEAD baseline ──────────────────────────────
    //
    // The exact key missed and no committed ancestor was reusable, but the
    // difference may be a dirty (uncommitted staged/worktree) overlay on a
    // committed state we DID resolve before. Reuse every span whose relevant
    // paths are clean now (and the global-widen union is untouched), re-resolving
    // only the spans a dirty relevant path can affect. A `None` means no
    // same-HEAD baseline / nothing reusable — fall through to the authoritative
    // cold path, which resolves the live dirty state correctly (just not
    // proportionally).
    if let Some(attempt) = dirty::attempt(repo, span_root, options, token, &key, &mut store)? {
        return Ok(attempt);
    }

    // ── Cold miss: exactly one build ────────────────────────────────────────
    cold_miss(repo, span_root, options, token, &key, &mut store)
}

/// The exact-generation read, shared by the unlocked fast path and the
/// under-lock recheck in [`stale_spans_new_store_inner`].
///
/// On a verified, decodable hit it touches, memoizes, and returns the rendered
/// [`ExactAttempt::Resolved`]. A store fault (a `get` error) returns
/// [`ExactAttempt::Bypass`] — fail closed to the authoritative resolver. `None`
/// means a plain miss / integrity rejection / undecodable summary, so the caller
/// continues down the reconstruction tiers to the one cold build.
fn exact_hit_read(store: &mut CacheStore, key: &[u8; 32]) -> Result<Option<ExactAttempt>> {
    match store.get_generation(key, SUMMARY_VERSION) {
        Ok(GetOutcome::Hit(g)) => match decode_summary(&g.summary) {
            Ok(rr) => {
                let _ = store.touch(key);
                let rr = Arc::new(rr);
                memo_put(*key, Arc::clone(&rr));
                emit_hit_class("exact");
                incr_exact_hits();
                crate::perf::counter("cache-path.exact-hit", 1);
                Ok(Some(rr.to_attempt()))
            }
            // A verified-but-undecodable summary is a corrupt hit: treat as a
            // miss and rebuild (fail closed on trust, not on the command).
            Err(()) => {
                crate::perf::note("cache-path.bypass-reason: summary-decode");
                Ok(None)
            }
        },
        Ok(GetOutcome::Miss) => Ok(None),
        Ok(GetOutcome::Rejected(reason)) => {
            crate::perf::note(&format!("cache-path.bypass-reason: rejected-{reason:?}"));
            Ok(None)
        }
        Err(e) => {
            crate::perf::note(&format!("cache-path.bypass-reason: get: {e}"));
            Ok(Some(ExactAttempt::Bypass))
        }
    }
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

    // Project ONCE, revalidate, and (only if the snapshot still holds) publish.
    // Shared with the Phase 4 incremental path so a reconstructed core and a
    // cold-built core render/publish through exactly one function.
    project_revalidate_publish(repo, span_root, options, token, key, store, &core)
}

/// Project a resolved (or reconstructed) [`ResolutionCore`] into the render-
/// ready form, revalidate the snapshot, and publish only if it still holds.
/// The single tail shared by [`cold_miss`] and the Phase 4 incremental path.
///
/// * `Unchanged` → publish (populating reuse rows), memoize, render.
/// * `Changed{head}` → render (the content-only key and every resolution input
///   are unchanged, so the core is still correct), skip publish (stale HEAD
///   hint) and memo (state is moving).
/// * `Changed{other}` → a resolution input moved mid-build (possible torn
///   read); discard and fall back to the authoritative path.
pub(crate) fn project_revalidate_publish(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &crate::resolver::core::token::StateToken,
    key: &[u8; 32],
    store: &mut CacheStore,
    core: &ResolutionCore,
) -> Result<ExactAttempt> {
    project_revalidate_publish_impl(repo, span_root, options, token, key, store, core, true)
}

/// Like [`project_revalidate_publish`], but persists only the compact summary,
/// not the per-span reuse rows (card main-157 Phase 5C). The dirty path uses
/// this: a dirty-overlay generation is never a reconstruction baseline (the
/// clean same-HEAD baseline it reused from already is), so storing its
/// whole-corpus reuse-row set on every dirty call is exactly the O(corpus)
/// publish cost 5C measured. Rendering is identical (both derive from the one
/// projected core); only what is persisted differs, and an exact-hit repeat of
/// the identical dirty state still resolves from the summary alone via
/// [`CacheStore::publish_generation_summary_only`].
pub(crate) fn project_revalidate_publish_summary_only(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &crate::resolver::core::token::StateToken,
    key: &[u8; 32],
    store: &mut CacheStore,
    core: &ResolutionCore,
) -> Result<ExactAttempt> {
    project_revalidate_publish_impl(repo, span_root, options, token, key, store, core, false)
}

// The two public wrappers above share this body verbatim; the extra `store_rows`
// flag over their 7 context params is what makes it one arg past the lint's
// threshold, so allow it here rather than duplicate the revalidate match.
#[allow(clippy::too_many_arguments)]
fn project_revalidate_publish_impl(
    repo: &gix::Repository,
    span_root: &str,
    options: EngineOptions,
    token: &crate::resolver::core::token::StateToken,
    key: &[u8; 32],
    store: &mut CacheStore,
    core: &ResolutionCore,
    store_rows: bool,
) -> Result<ExactAttempt> {
    let rr = Arc::new(RenderReady::from_core(core, options.layers));

    match revalidate(repo, span_root, options, token)? {
        Revalidation::Unchanged => {
            publish_if_eligible(repo, store, token, key, &rr, core, store_rows);
            let attempt = rr.to_attempt();
            memo_put(*key, rr);
            Ok(attempt)
        }
        Revalidation::Changed { field } => {
            incr_revalidate_discards();
            crate::perf::counter("cache-path.revalidate-discarded", 1);
            crate::perf::note(&format!("cache-path.revalidate-discarded: {field}"));
            if field == "head" {
                Ok(rr.to_attempt())
            } else {
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
    repo: &gix::Repository,
    store: &mut CacheStore,
    token: &crate::resolver::core::token::StateToken,
    key: &[u8; 32],
    rr: &RenderReady,
    core: &ResolutionCore,
    store_rows: bool,
) {
    if !token.persistence_eligible() {
        crate::perf::note("cache-path.publish-skipped: ineligible");
        return;
    }
    // Card main-157 Phase 4A: a reconstruction baseline populates the normalized
    // per-span reuse rows and the reverse path index from the resolved core, so
    // a later commit's incremental path (or a later dirty overlay) can reuse
    // every unchanged span (see `reuse`). Exact-hit rendering still reads only
    // the compact `summary`; the rows are additive.
    //
    // Phase 5C: a dirty-overlay generation (`store_rows == false`) persists the
    // summary only. It is never itself a baseline — the clean same-HEAD baseline
    // it reused from already is — so writing its whole-corpus reuse-row set on
    // every dirty call is pure O(corpus) waste.
    let (rows, path_index) = if store_rows {
        let widen = reuse::compute_widen(core, global_copy_widen(token));
        reuse::core_to_reuse_rows(core, &widen, &token.config_fingerprint())
    } else {
        (Vec::new(), Vec::new())
    };
    let summary = encode_summary(rr);

    // Diagnostics: what this generation costs the store. `publish-rows` and
    // `publish-summary-bytes` are the row/byte counts; `publish-dependency-
    // fanout` is the number of reverse-index `(source_path -> row_key)` bindings
    // — the set of source paths a later incremental/dirty reuse can pivot on.
    crate::perf::counter("cache-path.publish-rows", rows.len() as u64);
    crate::perf::counter("cache-path.publish-summary-bytes", summary.len() as u64);
    crate::perf::counter(
        "cache-path.publish-dependency-fanout",
        path_index.len() as u64,
    );

    let input = GenerationInput {
        key_digest: *key,
        head: token.head.clone(),
        payload_version: SUMMARY_VERSION,
        summary,
        rows,
        path_index,
        // The current worktree references this generation at publish time.
        live: true,
    };
    let t_publish = crate::perf::enabled().then(std::time::Instant::now);
    let published = if store_rows {
        store.publish_generation(&input)
    } else {
        store.publish_generation_summary_only(&input)
    };
    if let Some(t) = t_publish {
        crate::perf::counter("cache-path.publish-us", t.elapsed().as_micros() as u64);
    }
    match published {
        Ok(()) => {
            crate::perf::counter("cache-path.publish-ok", 1);
            // The one production trigger for 6A's quota maintenance: bounded
            // foreground work, gated by a cheap high-water check (see
            // [`maybe_maintain`]), right after a generation lands.
            maybe_maintain(repo, store);
        }
        Err(e) => {
            incr_publish_failures();
            crate::perf::counter("cache-path.publish-failed", 1);
            crate::perf::note(&format!("cache-path.publish-failed: {e}"));
        }
    }
}

/// Run bounded quota maintenance after a successful publish, but only at the
/// high-water mark. A cheap [`CacheStore::database_size_bytes`] probe
/// (`PRAGMA page_count`/`page_size` + a WAL stat) gates the expensive pass:
/// when the store is under `cap`, this returns after the probe and never runs
/// the eviction loop, page reclaim, or WAL checkpoint. When over `cap`,
/// [`CacheStore::maintain`] evicts non-live generations and truncates the WAL
/// as bounded foreground work — no background thread, no deferral, so
/// maintenance can never be perpetually not-run.
///
/// This is the sole production caller of `maintain`: 6A landed the mechanism
/// inert (a callable API nobody called); 6B wires it here.
fn maybe_maintain(repo: &gix::Repository, store: &mut CacheStore) {
    let cap = store_max_bytes(repo);
    let size = match store.database_size_bytes() {
        Ok(n) => n,
        Err(e) => {
            crate::perf::note(&format!("cache-path.maintain-skipped: size: {e}"));
            return;
        }
    };
    if size <= cap {
        return;
    }
    // Over the high-water mark: first reconcile liveness so superseded
    // generations become evictable, then run the bounded quota pass. Publish
    // always marks the new generation `live`; without this step nothing ever
    // demotes a superseded one, every generation stays permanently live, and
    // `maintain`'s `WHERE live = 0` candidate filter reclaims nothing — the
    // measured quota defeat this fixes (card main-157 Phase 6C). This runs only
    // above the cap, so its worktree enumeration is off the hot read path.
    reconcile_liveness(repo, store);
    match store.maintain(cap) {
        Ok(stats) => emit_gc_stats(cap, &stats),
        Err(e) => crate::perf::note(&format!("cache-path.maintain-failed: {e}")),
    }
}

/// Recompute the genuinely-live HEAD set from the repository's active worktrees
/// and demote every stored generation whose publish-time HEAD is no longer
/// checked out anywhere, making superseded generations eligible for quota
/// eviction.
///
/// Fails closed on any uncertainty: if the live-HEAD set cannot be computed in
/// full (a linked worktree is inaccessible, a HEAD will not resolve), or the
/// demotion query itself faults, nothing is demoted. That preserves
/// correctness — a genuinely-live generation is never demoted on a partial set,
/// so the current worktree's active state, and every sibling worktree's, stays
/// findable — at the cost of deferring reclamation to a later, cleaner pass.
/// `maintain` (called next) still runs regardless; it simply finds fewer (or
/// no) candidates when reconciliation was skipped.
fn reconcile_liveness(repo: &gix::Repository, store: &mut CacheStore) {
    let live_heads = match crate::git::live_worktree_heads(repo) {
        Ok(h) => h,
        Err(e) => {
            crate::perf::note(&format!("cache-path.reconcile-skipped: live-heads: {e}"));
            return;
        }
    };
    match store.reconcile_live_heads(&live_heads) {
        Ok(demoted) => crate::perf::counter("cache-path.reconcile-demoted", demoted),
        Err(e) => crate::perf::note(&format!("cache-path.reconcile-failed: {e}")),
    }
}

/// Emit the GC/maintenance-effect diagnostics for one quota pass, following the
/// existing `cache-path.*` counter/note convention.
fn emit_gc_stats(cap: u64, stats: &GcStats) {
    crate::perf::counter("cache-path.store-cap-bytes", cap);
    crate::perf::counter("cache-path.gc-bytes-before", stats.bytes_before);
    crate::perf::counter("cache-path.gc-bytes-after", stats.bytes_after);
    crate::perf::counter(
        "cache-path.gc-generations-removed",
        stats.generations_removed,
    );
    crate::perf::counter("cache-path.gc-rows-removed", stats.rows_removed);
    if stats.corruption_recovered {
        crate::perf::note("cache-path.gc-corruption-recovered: true");
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
