//! In-process behavior tests for the temporary new-store execution seam
//! (card main-157 Phase 3, sub-scope 3C).
//!
//! These prove the properties that need white-box access — the one-build
//! cold-miss, the store exact hit, the bounded in-process memo, and the
//! revalidate-discards-publish decision — using the thread-local counters and
//! the after-build mutation hook this module exposes under `cfg(test)`. The
//! cross-format differential parity (old-path == new-path == disabled) is a
//! black-box concern and lives in `tests/cases/store_v3_differential.rs`.
//!
//! `cargo nextest` runs each test in its own process, so the `GIT_SPAN_*`
//! environment writes below cannot leak across tests.

use super::*;
use crate::resolver::core::capture::capture_state_token;
use crate::types::EngineOptions;
use std::path::Path;
use std::process::Command;

const SPAN_ROOT: &str = ".span";

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

/// The recorded hash is deliberately the *wrong* rk64 fingerprint (a flipped
/// bit), so every written anchor reads as drifted — this harness's spans are
/// never meant to resolve fresh (see `drifted_repo` below).
fn write_span(workdir: &Path, name: &str, anchors: &[(&str, u32, u32)], why: &str) {
    use git_span_core::{RK64_ALGORITHM, cheap_fingerprint_with_extent, rk64_to_hex};

    let mut records = Vec::new();
    for (path, start, end) in anchors {
        let bytes = std::fs::read(workdir.join(path)).expect("read anchored file");
        let extent = if *start == 0 && *end == 0 {
            crate::types::AnchorExtent::WholeFile
        } else {
            crate::types::AnchorExtent::LineRange {
                start: *start,
                end: *end,
            }
        };
        let fp = cheap_fingerprint_with_extent(&bytes, &extent) ^ 1;
        records.push(crate::span_file::AnchorRecord {
            path: (*path).into(),
            start_line: *start,
            end_line: *end,
            algorithm: RK64_ALGORITHM.into(),
            content_hash: rk64_to_hex(fp).into(),
        });
    }
    let sf = crate::span_file::SpanFile {
        anchors: records,
        why: why.to_string(),
        config: git_span_core::SpanConfig::default(),
        resolved: Vec::new(),
    };
    let span_dir = workdir.join(SPAN_ROOT);
    std::fs::create_dir_all(&span_dir).expect("mkdir .span");
    std::fs::write(span_dir.join(name), sf.serialize()).expect("write span");
}

/// A clean repo with one span whose anchored source has drifted at HEAD, so
/// `drift` reports exactly one finding. `tag` makes the corpus content unique
/// per test, so the content-derived canonical key never collides in the
/// process-global memo.
fn drifted_repo(tag: &str) -> (tempfile::TempDir, gix::Repository) {
    // Isolate from any global/system git config (e.g. a globally configured
    // `filter.lfs` from an installed git-lfs), which would otherwise make every
    // token persistence-ineligible by design — see `StateToken::persistence_
    // eligible` and `notes/investigation-question-log.md` Step 6. Both git and
    // gix honor these env vars for config discovery. Safe under nextest's
    // process-per-test isolation.
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
    }
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path();
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    std::fs::write(dir.join("src/a.txt"), format!("{tag}-l1\nl2\nl3\nl4\nl5\n"))
        .expect("write src");
    // Anchor lines 1-3 of the ORIGINAL content.
    write_span(dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", "init"]);
    // Drift the committed content out from under the anchor.
    std::fs::write(
        dir.join("src/a.txt"),
        format!("{tag}-CHANGED\nl2-CHANGED\nl3\nl4\nl5\n"),
    )
    .expect("drift src");
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", "drift"]);
    git(
        dir,
        &["commit-graph", "write", "--reachable", "--changed-paths"],
    );
    let repo = gix::open(dir).expect("gix open");
    (td, repo)
}

fn enable_store() {
    // The SQLite store is unconditional; `GIT_SPAN_CACHE=0` is the only
    // disable switch. Clear it so this run engages the store.
    // Safe under nextest's process-per-test isolation.
    unsafe {
        std::env::remove_var("GIT_SPAN_CACHE");
    }
}

fn resolved(attempt: ExactAttempt) -> Vec<SpanResolved> {
    match attempt {
        ExactAttempt::Resolved {
            spans,
            whole_result,
        } => {
            // Every `Resolved` outcome (cold miss, memo hit, store hit)
            // carries the render-ready whole-result so the CLI skips its
            // corpus reload. Its `spans` (full effective set) must always
            // contain at least the returned reportable set.
            assert!(
                whole_result.is_some(),
                "a Resolved outcome must carry the render-ready whole-result"
            );
            let wr = whole_result.unwrap();
            assert!(
                wr.spans.len() >= spans.len(),
                "whole-result full set must include the reportable set"
            );
            spans
        }
        ExactAttempt::Bypass => panic!("expected Resolved, got Bypass"),
    }
}

// ── Cache-disable switch ─────────────────────────────────────────────────────

#[test]
fn store_engages_by_default() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("default");
    // Default env (cache enabled): the store is unconditional and engages.
    enable_store();
    let out = drift_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("attempt");
    assert!(
        matches!(out, ExactAttempt::Resolved { .. }),
        "with the cache enabled the store must engage"
    );
    assert_eq!(
        test_cold_miss_builds(),
        1,
        "the default engaged path performs the one cold build"
    );
}

#[test]
fn cache_disabled_bypasses_store() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("disabled");
    // `GIT_SPAN_CACHE=0` is the single disable switch: it bypasses every tier.
    unsafe {
        std::env::set_var("GIT_SPAN_CACHE", "0");
    }
    let out = drift_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("attempt");
    assert!(
        matches!(out, ExactAttempt::Bypass),
        "GIT_SPAN_CACHE=0 must bypass the store"
    );
    assert_eq!(
        test_cold_miss_builds(),
        0,
        "a disabled cache must do no build"
    );
}

#[test]
fn ineligible_options_bypass() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("inelig");
    enable_store();
    // committed_only() has a non-full layer set → ineligible.
    let out =
        drift_spans_new_store(&repo, SPAN_ROOT, EngineOptions::committed_only()).expect("attempt");
    assert!(matches!(out, ExactAttempt::Bypass));
    assert_eq!(test_cold_miss_builds(), 0);
}

// ── One-build cold miss, then store exact hit ────────────────────────────────

#[test]
fn cold_miss_builds_exactly_once_then_store_hit() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("coldone");
    enable_store();
    let opts = EngineOptions::full();

    // Cold miss: exactly one resolver build, no exact hit, and a finding.
    let cold = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("cold"));
    assert_eq!(
        test_cold_miss_builds(),
        1,
        "cold miss must build exactly once"
    );
    assert_eq!(test_exact_hits(), 0);
    assert_eq!(cold.len(), 1, "the drifted span is reportable");
    assert_eq!(cold[0].name, "alpha");

    // Drop the in-process memo so the next call must consult the store.
    clear_memo();
    let warm = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("warm"));
    assert_eq!(test_exact_hits(), 1, "second call is a store exact hit");
    assert_eq!(
        test_cold_miss_builds(),
        1,
        "an exact hit must NOT trigger a second build"
    );
    assert_eq!(warm, cold, "exact-hit output equals the cold-miss output");
}

// ── Singleflight: N concurrent cold callers build once ───────────────────────

/// Card main-157 finding F5: concurrent cold callers for one missing key must
/// perform EXACTLY ONE build, not N. This exercises the real production seam
/// (`drift_spans_new_store`) — the same entry point the CLI drives.
///
/// N threads each open their own repo handle and race, released together by a
/// barrier, into the miss path for the same (content-derived) canonical key.
/// The first to win the key's build-lock shard runs the one resolve+publish;
/// the rest block on the shard, then find the winner's published generation in
/// the recheck-under-lock and render straight from it. The `cold-miss-build`
/// counter is thread-local, so the total across all callers is the sum of each
/// thread's count — and that total must be 1.
#[test]
fn concurrent_cold_callers_build_exactly_once() {
    reset_test_state();
    clear_memo();
    let (td, _repo) = drifted_repo("concurrent");
    enable_store();
    let repo_path = td.path().to_path_buf();

    const CALLERS: usize = 4;
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(CALLERS));

    let handles: Vec<_> = (0..CALLERS)
        .map(|_| {
            let repo_path = repo_path.clone();
            let barrier = std::sync::Arc::clone(&barrier);
            std::thread::spawn(move || {
                // A fresh repo handle per caller, exactly as N independent CLI
                // invocations would each open the repo.
                let repo = gix::open(&repo_path).expect("gix open");
                // Release all callers into the miss path at the same instant so
                // they genuinely contend on the shard.
                barrier.wait();
                let attempt = drift_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full())
                    .expect("attempt");
                // The build counter is thread-local; report this thread's count
                // so the caller can sum the true total across all threads.
                (test_cold_miss_builds(), resolved(attempt))
            })
        })
        .collect();

    let mut total_builds = 0u64;
    let mut outputs: Vec<Vec<SpanResolved>> = Vec::new();
    for h in handles {
        let (builds, spans) = h.join().expect("caller thread panicked");
        total_builds += builds;
        outputs.push(spans);
    }

    assert_eq!(
        total_builds, 1,
        "N simultaneous cold callers for one missing key must build exactly once, not N times"
    );
    // Every caller renders an identical reportable set: the winner built it, the
    // losers read the winner's published generation.
    for out in &outputs {
        assert_eq!(
            out, &outputs[0],
            "all concurrent callers must agree byte-for-byte"
        );
        assert_eq!(out.len(), 1, "the drifted span is reportable");
        assert_eq!(out[0].name, "alpha");
    }
}

// ── Bounded in-process memo ──────────────────────────────────────────────────

#[test]
fn memo_serves_repeat_without_store_read() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("memo");
    enable_store();
    let opts = EngineOptions::full();

    let first = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("first"));
    assert_eq!(test_cold_miss_builds(), 1);

    // Delete the persistent store entirely; the memo must still answer.
    let store_dir = crate::git::common_dir(&repo).join("span");
    let _ = std::fs::remove_dir_all(&store_dir);

    let again = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("again"));
    assert_eq!(test_cold_miss_builds(), 1, "memo hit does not rebuild");
    assert_eq!(test_exact_hits(), 0, "memo hit does not read the store");
    assert_eq!(again, first);
}

#[test]
fn memo_is_bounded() {
    let mut memo = BoundedMemo::new(2);
    let rr = Arc::new(RenderReady {
        full: Vec::new(),
        span_anchor_totals: Vec::new(),
    });
    let k = |b: u8| [b; 32];
    memo.put(k(1), Arc::clone(&rr));
    memo.put(k(2), Arc::clone(&rr));
    memo.put(k(3), Arc::clone(&rr)); // evicts k(1)
    assert!(
        memo.get(&k(1)).is_none(),
        "oldest entry evicted at capacity"
    );
    assert!(memo.get(&k(2)).is_some());
    assert!(memo.get(&k(3)).is_some());
    assert_eq!(memo.map.len(), 2, "never exceeds the bound");
    assert_eq!(memo.order.len(), 2);
}

// ── Revalidate discards publish ──────────────────────────────────────────────

#[test]
fn revalidate_discard_publishes_nothing_and_falls_back() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("reval");
    enable_store();
    let opts = EngineOptions::full();
    let dir = repo.workdir().expect("workdir").to_path_buf();

    // Capture the key the clean state would publish under.
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let key = token.canonical_key_digest();

    // Mutate a relevant SOURCE file mid-build (between capture and the
    // pre-publish re-read). Worktree content is re-read from disk on the same
    // handle, so revalidation reliably sees it.
    let mutate_path = dir.join("src/a.txt");
    set_after_build_hook(move || {
        std::fs::write(&mutate_path, "torn\nread\nmutation\n").expect("mutate worktree");
    });

    let out = drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("attempt");
    assert!(
        matches!(out, ExactAttempt::Bypass),
        "a resolution-input change mid-build must fall back, not render a torn read"
    );
    assert_eq!(test_cold_miss_builds(), 1, "one build happened");
    assert_eq!(test_revalidate_discards(), 1, "the candidate was discarded");
    assert_eq!(test_publish_failures(), 0, "publish was never attempted");

    // No cache entry was published under the captured key.
    let store = CacheStore::open(&repo).expect("open store");
    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Miss
        ),
        "a discarded candidate must leave the store empty for that key"
    );
}

// ── Warm-hit dirty-tree withhold check (card main-157 F4) ───────────────────

/// A clean repo with `n` spans, each anchoring its own file in one flat
/// directory (`flat/`) — the corpus shape that makes a per-relevant-path HEAD
/// walk visibly O(R): every anchored path and every span file lives in the
/// same root tree, so a per-path `tree_entry_at` re-peel/re-navigate is not
/// masked by directory fan-out. The tree is fully clean (worktree == index ==
/// HEAD), so the withhold check must find nothing dirty.
fn flat_repo(tag: &str, n: usize) -> (tempfile::TempDir, gix::Repository) {
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
    }
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path();
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    std::fs::create_dir_all(dir.join("flat")).expect("mkdir flat");
    for i in 0..n {
        let path = format!("flat/f{i}.txt");
        std::fs::write(dir.join(&path), format!("{tag}-{i}-l1\nl2\nl3\n")).expect("write file");
        write_span(dir, &format!("s{i}"), &[(path.as_str(), 1, 2)], "why");
    }
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", "init"]);
    git(
        dir,
        &["commit-graph", "write", "--reachable", "--changed-paths"],
    );
    let repo = gix::open(dir).expect("gix open");
    (td, repo)
}

/// Card main-157 F4: [`withhold_whole_result_for_dirty_tree`] runs on EVERY
/// `Resolved{whole_result: Some}` attempt — including a plain warm exact/memo
/// hit, where it is the entire per-call cost. Pre-fix it called
/// `incremental::relevant_dirty_paths`, which re-walks the HEAD tree
/// (`crate::git::tree_entry_at`: `rev_parse_single` + `.object()` +
/// `.peel_to_tree()` + `lookup_entry_by_path`) once per relevant path — O(R)
/// HEAD re-walks on a corpus with R relevant (span-file + anchored) paths, on
/// EVERY clean warm hit. This asserts the fixed check performs ZERO
/// `tree_entry_at` calls on a 40-span flat corpus (80 relevant paths), proving
/// it now reads the HEAD tree via the batched
/// [`crate::resolver::dirty::relevant_dirty_paths`] /
/// [`crate::resolver::dirty::head_blob_path_map`] traversal instead.
#[test]
fn withhold_check_does_not_walk_head_tree_per_relevant_path() {
    let (_td, repo) = flat_repo("flatwithhold", 40);
    let opts = EngineOptions::full();

    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    assert!(
        token.staged_state.len() + token.worktree_state.len() >= 80,
        "flat corpus must actually produce a large relevant-path set: {} staged + {} worktree",
        token.staged_state.len(),
        token.worktree_state.len()
    );

    let attempt = ExactAttempt::Resolved {
        spans: Vec::new(),
        whole_result: Some(WholeResult {
            spans: Vec::new(),
            span_anchor_totals: Vec::new(),
        }),
    };

    crate::git::reset_tree_entry_at_call_count();
    let out = withhold_whole_result_for_dirty_tree(&repo, &token, attempt).expect("withhold");
    let calls = crate::git::tree_entry_at_call_count();

    assert!(
        matches!(
            out,
            ExactAttempt::Resolved {
                whole_result: Some(_),
                ..
            }
        ),
        "a genuinely clean flat corpus must not withhold the whole-result"
    );
    assert_eq!(
        calls, 0,
        "the withhold check must not re-walk the HEAD tree once per relevant path \
         (got {calls} tree_entry_at calls on an 80-relevant-path corpus)"
    );
}

// ── Phase 4A: per-span reuse rows round-trip ─────────────────────────────────

#[test]
fn reuse_rows_round_trip_core_through_store() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("reusert");
    let opts = EngineOptions::full();

    // Resolve a real core, normalize it to reuse rows, and publish those rows
    // in a generation (summary content is irrelevant here).
    let names = crate::span::read::list_span_names_in(&repo, SPAN_ROOT).expect("names");
    let core = capture_resolution_core(
        &repo,
        SPAN_ROOT,
        &names,
        crate::resolver::engine::COLD_DRIFT_MIN_ANCHORS_PER_TASK,
    )
    .expect("core");
    let widen = reuse::compute_widen(&core, false);
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let (rows, path_index) = reuse::core_to_reuse_rows(&core, &widen, &token.config_fingerprint());
    assert!(!rows.is_empty(), "a non-empty corpus yields reuse rows");

    let key = token.canonical_key_digest();
    let mut store = CacheStore::open(&repo).expect("store");
    let input = GenerationInput {
        key_digest: key,
        head: token.head.clone(),
        payload_version: SUMMARY_VERSION,
        summary: vec![0xAB, 0xCD],
        rows,
        path_index,
        live: true,
    };
    store.publish_generation(&input).expect("publish");

    let stored = match store.get_generation(&key, SUMMARY_VERSION).expect("get") {
        GetOutcome::Hit(g) => g,
        other => panic!("expected Hit, got {other:?}"),
    };
    let reconstructed = reuse::reuse_rows_to_core(&stored.rows);
    assert_eq!(
        reconstructed, core,
        "reuse rows must round-trip the ResolutionCore byte-identically"
    );
    // The drifted span is widen-marked and survives the round trip.
    let widen_back = reuse::reuse_rows_widen(&stored.rows);
    assert_eq!(widen_back, widen, "widen markers must round-trip");
}

#[test]
fn clean_run_publishes_and_is_eligible() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("cleanpub");
    enable_store();
    let opts = EngineOptions::full();

    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let key = token.canonical_key_digest();
    assert!(
        token.persistence_eligible(),
        "clean no-filter repo is eligible"
    );

    let _ = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("cold"));
    assert_eq!(test_revalidate_discards(), 0, "clean run must not discard");

    let store = CacheStore::open(&repo).expect("open store");
    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "a clean, unchanged run must publish a verified generation"
    );
}

// ── Quota-maintenance trigger (sub-scope 6B) ─────────────────────────────────

/// Publish one non-live generation to a store, then craft the input directly.
fn publish_non_live(store: &mut CacheStore, key: [u8; 32]) {
    let input = GenerationInput {
        key_digest: key,
        head: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef".into(),
        payload_version: SUMMARY_VERSION,
        summary: vec![1, 2, 3, 4, 5],
        rows: Vec::new(),
        path_index: Vec::new(),
        live: false,
    };
    store.publish_generation(&input).expect("publish");
}

/// A first-open due entry evicts a non-live
/// generation: with 17 non-live generations (one past the 16-generation reuse
/// buffer), [`maybe_maintain`] runs `maintain` and the targeted generation is
/// gone.
#[test]
fn maybe_maintain_evicts_non_live_beyond_reuse_buffer() {
    let (_td, repo) = drifted_repo("capevict");
    let mut store = CacheStore::open(&repo).expect("open");
    let key = [7u8; 32];
    // 17 non-live generations — one past the reuse buffer — so the count leg
    // alone forces the pass. The targeted generation is published first and
    // aged so eviction order deterministically picks it. The loop publishes
    // sixteen more (1..=17 minus the targeted key): publish replaces by key,
    // so re-publishing [7; 32] would collapse the corpus back to 16.
    publish_non_live(&mut store, key);
    for n in 1..18u8 {
        if n == 7 {
            continue;
        }
        publish_non_live(&mut store, [n; 32]);
    }
    crate::resolver::store::set_bucket(&store, &key, crate::resolver::store::now_bucket() - 100);
    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "generation must be present before maintenance"
    );

    maybe_maintain(
        &repo,
        &mut store,
        Some(("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", &key)),
    );

    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Miss
        ),
        "a non-live generation beyond the reuse buffer must be evicted by the trigger"
    );
}

/// Within the reuse buffer a due entry reconciles without eviction: even a non-live generation survives, since nothing is over the
/// high-water mark.
#[test]
fn maybe_maintain_keeps_generation_within_reuse_buffer() {
    let (_td, repo) = drifted_repo("capkeep");
    let mut store = CacheStore::open(&repo).expect("open");
    let key = [9u8; 32];
    publish_non_live(&mut store, key);

    maybe_maintain(
        &repo,
        &mut store,
        Some(("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", &key)),
    );

    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "within the reuse buffer, the trigger must not evict anything"
    );
}

/// Card main-224: the production trigger's cheap probe is the non-live
/// generation count, so a store holding more than the reuse buffer keeps its
/// stale non-live generations until the trigger sweeps them — shrinking the
/// on-disk footprint.
#[test]
fn maybe_maintain_sweeps_stale_non_live_under_cap() {
    let (_td, repo) = drifted_repo("capsweep");
    let mut store = CacheStore::open(&repo).expect("open");
    // One tiny record beyond the reuse buffer.
    for n in 0..17u8 {
        publish_non_live(&mut store, [n; 32]);
    }

    let before = store.database_size_bytes().unwrap();
    maybe_maintain(
        &repo,
        &mut store,
        Some(("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", &[1u8; 32])),
    );
    let after = store.database_size_bytes().unwrap();

    assert!(
        after < before,
        "the trigger must reclaim stale generations: {before} -> {after}"
    );
}

/// A real `drift` run against a store holding more non-live generations than
/// the reuse buffer still returns the correct result and leaves the just-
/// published *live* generation intact (a live generation is never evicted,
/// even at the high-water mark) — the trigger's only effect is on the store
/// file, never on the command's output.
#[test]
fn count_forced_run_keeps_output_and_live_generation() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("capdrift");
    enable_store();
    // Seed a stale store: 17 non-live generations (one past the 16-generation
    // reuse buffer) so the run's open-time maintenance trigger fires and
    // sweeps them.
    {
        let mut store = CacheStore::open(&repo).expect("open");
        for n in 0..17u8 {
            publish_non_live(&mut store, [n; 32]);
        }
    }
    let opts = EngineOptions::full();
    let key = capture_state_token(&repo, SPAN_ROOT, opts)
        .expect("token")
        .canonical_key_digest();

    let spans = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).expect("cold"));
    assert_eq!(spans.len(), 1, "the one drifted span is still reported");

    // The live generation published this run survives the maintenance pass.
    let store = CacheStore::open(&repo).expect("open");
    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "a live generation is never evicted, even with the trigger forced"
    );
}

/// Card main-224 acceptance signal: on a store holding more non-live
/// generations than the reuse buffer without a recent publish, running the
/// repository's normal `git span` workflow brings the non-live generation
/// count and on-disk size down WITHOUT a new snapshot being published first.
/// The maintenance opportunity must be the drift invocation itself — a warm,
/// hit-only run — not just the publish that follows a cold build.
#[test]
fn drift_run_sweeps_stale_generations_without_publish() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("capsweeprun");
    enable_store();
    let opts = EngineOptions::full();
    assert_eq!(
        resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap()).len(),
        1
    );
    let mut store = CacheStore::open(&repo).unwrap();
    for n in 0..17u8 {
        publish_non_live(&mut store, [n; 32]);
    }
    let discoveries = TEST_MAINTENANCE_DISCOVERIES.with(std::cell::Cell::get);
    let hits = test_exact_hits();
    clear_memo();
    assert_eq!(
        resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap()).len(),
        1
    );
    assert_eq!(test_exact_hits(), hits + 1);
    assert_eq!(
        TEST_MAINTENANCE_DISCOVERIES.with(std::cell::Cell::get),
        discoveries
    );
    assert_eq!(store.non_live_generation_count().unwrap(), 17);
    // Advance only the durable scheduling counter using tiny store operations.
    // The next ordinary exact-hit read is the sixteenth admitted opportunity.
    for _ in 2..16 {
        assert!(matches!(
            store.admit_maintenance().unwrap(),
            crate::resolver::store::maintenance::MaintenanceDecision::Deferred(_)
        ));
    }
    clear_memo();
    assert_eq!(
        resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap()).len(),
        1
    );
    assert_eq!(test_exact_hits(), hits + 2);
    assert_eq!(
        TEST_MAINTENANCE_DISCOVERIES.with(std::cell::Cell::get),
        discoveries + 1
    );
    assert_eq!(store.non_live_generation_count().unwrap(), 16);
    assert!(!store.maintenance_state().unwrap().due);
}

#[test]
fn maintenance_discovery_failure_skips_gc_and_keeps_due() {
    reset_test_state();
    let (td, repo) = drifted_repo("discoveryfail");
    let mut store = CacheStore::open(&repo).unwrap();
    for n in 0..17u8 {
        publish_non_live(&mut store, [n; 32]);
    }
    let head_path = td.path().join(".git/HEAD");
    let head = std::fs::read(&head_path).unwrap();
    std::fs::write(&head_path, "ref: refs/heads/missing-maintenance-head\n").unwrap();
    maybe_maintain(&repo, &mut store, None);
    assert_eq!(store.non_live_generation_count().unwrap(), 17);
    assert!(store.maintenance_state().unwrap().due);
    std::fs::write(&head_path, head).unwrap();
    maybe_maintain(&repo, &mut store, None);
    assert_eq!(store.non_live_generation_count().unwrap(), 16);
    assert!(!store.maintenance_state().unwrap().due);
}

/// Capture a git command's trimmed stdout (for reading resolved OIDs).
fn git_out(dir: &Path, args: &[&str]) -> String {
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
    String::from_utf8(out.stdout)
        .expect("utf8")
        .trim()
        .to_string()
}

/// Publish a `live` generation at an arbitrary head hint (empty rows, so
/// row_count = 0 keeps the same-head rule from touching it unless it is the
/// current head+key). Models a generation an active — or superseded — worktree
/// left behind.
fn publish_live_at(store: &mut CacheStore, key: [u8; 32], head: &str) {
    let input = GenerationInput {
        key_digest: key,
        head: head.to_string(),
        payload_version: SUMMARY_VERSION,
        summary: vec![9, 9, 9, 9, 9],
        rows: Vec::new(),
        path_index: Vec::new(),
        live: true,
    };
    store.publish_generation(&input).expect("publish");
}

/// Card main-157 F3: one broken/prunable linked worktree (its working directory
/// deleted without `git worktree prune`) must not permanently disable quota
/// reclamation. [`crate::git::live_worktree_heads`] fails closed only on
/// *blindness* (enumeration failing) — a single worktree whose HEAD will not
/// resolve is skipped, not fatal — so reconciliation still demotes drifted heads
/// that no *resolvable* worktree sits on.
///
/// Pre-fix, `into_repo()` on the broken worktree returned `Err`, `live_worktree_
/// heads` propagated it, and [`reconcile_liveness`] returned before demoting
/// anything: the drift-head generation stayed permanently live and the quota
/// reclaimed nothing. This asserts both halves — the live set is the resolvable
/// subset (healthy worktree included, broken skipped, no error), and the drift
/// generation is demoted and evicted while the live worktrees' generations
/// survive.
#[test]
fn broken_worktree_does_not_disable_reconciliation() {
    reset_test_state();
    clear_memo();
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
    }
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path();
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.join("a.txt"), "seed\n").expect("seed");
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", "init"]);
    let h_main = git_out(dir, &["rev-parse", "HEAD"]);

    // A healthy linked worktree on its own branch, advanced to a distinct commit
    // so its HEAD differs from main's — proving it is actually resolved (not
    // merely equal to main by coincidence).
    let healthy = td.path().join("healthy-wt");
    git(
        dir,
        &[
            "worktree",
            "add",
            "-b",
            "healthy",
            healthy.to_str().unwrap(),
        ],
    );
    std::fs::write(healthy.join("a.txt"), "healthy-change\n").expect("healthy write");
    git(&healthy, &["add", "-A"]);
    git(&healthy, &["commit", "-m", "healthy commit"]);
    let h_healthy = git_out(&healthy, &["rev-parse", "HEAD"]);
    assert_ne!(
        h_main, h_healthy,
        "healthy worktree must be at a distinct commit"
    );

    git(&healthy, &["checkout", "--detach"]);

    // A broken/prunable linked worktree: created, then its working directory
    // deleted without `git worktree prune`. Its admin dir (and `gitdir` file)
    // remain, so `worktrees()` still enumerates it, but `into_repo()` fails on
    // the missing checkout — the persistent state F3 is about.
    let broken = td.path().join("broken-wt");
    git(
        dir,
        &["worktree", "add", "-b", "broken", broken.to_str().unwrap()],
    );
    git(&broken, &["commit", "--allow-empty", "-m", "broken commit"]);
    let h_broken = git_out(&broken, &["rev-parse", "HEAD"]);
    assert_ne!(h_broken, h_main);
    assert_ne!(h_broken, h_healthy);
    std::fs::remove_dir_all(&broken).expect("delete broken worktree checkout");

    let repo = gix::open(dir).expect("gix open");

    // Half 1: the live set is the resolvable subset — main + healthy, broken
    // skipped — and it did NOT error despite the broken worktree.
    let live = crate::git::live_worktree_heads(&repo).expect("partial live set, not an error");
    assert!(live.contains(&h_main), "main worktree HEAD present");
    assert!(
        live.contains(&h_healthy),
        "healthy linked worktree HEAD present"
    );

    assert!(!live.contains(&h_broken), "deleted checkout HEAD excluded");

    // Half 2: reconciliation demotes a drifted head no resolvable worktree sits
    // on, while both live worktrees' generations survive. Seventeen filler
    // non-live generations seed the count leg — one past the 16-generation
    // reuse buffer even before the drift generation is demoted — so the pass's
    // count probe fires; reconciliation then demotes the drift generation,
    // crossing the buffer by one more, and the quota pass evicts it (aged the
    // oldest candidate).
    enable_store();
    let mut store = CacheStore::open(&repo).expect("open store");
    let k_main = [1u8; 32];
    let k_healthy = [2u8; 32];
    let k_drift = [3u8; 32];
    let h_drift = h_broken.as_str();
    publish_live_at(&mut store, k_main, &h_main);
    publish_live_at(&mut store, k_healthy, &h_healthy);
    publish_live_at(&mut store, k_drift, h_drift);
    for n in 0..17u8 {
        publish_non_live(&mut store, [100 + n; 32]);
    }
    // Age the drift generation so eviction order deterministically reclaims it
    // (every candidate is a fresh summary-only generation at the current
    // access bucket, so without this the victim is a tie).
    crate::resolver::store::set_bucket(
        &store,
        &k_drift,
        crate::resolver::store::now_bucket() - 100,
    );

    // The production trigger, with the current worktree's (head, key).
    maybe_maintain(&repo, &mut store, Some((&h_main, &k_main)));

    assert!(
        matches!(
            store
                .get_generation(&k_drift, SUMMARY_VERSION)
                .expect("get"),
            GetOutcome::Miss
        ),
        "a generation at a drifted head (no resolvable worktree) must be demoted and evicted",
    );
    assert!(
        matches!(
            store.get_generation(&k_main, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "the main worktree's live generation must survive",
    );
    assert!(
        matches!(
            store
                .get_generation(&k_healthy, SUMMARY_VERSION)
                .expect("get"),
            GetOutcome::Hit(_)
        ),
        "the healthy linked worktree's live generation must survive",
    );
}

/// A private-ref sibling retains its own generation through an ordinary exact
/// hit. Enumeration blindness must leave even an absent head generation live.
#[test]
fn scoped_sibling_retention_and_enumeration_blindness() {
    reset_test_state();
    clear_memo();
    let (td, repo) = drifted_repo("scoped-live");
    enable_store();
    let sibling = td.path().join("sibling");
    git(
        td.path(),
        &[
            "worktree",
            "add",
            "--detach",
            sibling.to_str().unwrap(),
            "HEAD^",
        ],
    );
    let sibling_head = git_out(&sibling, &["rev-parse", "HEAD"]);
    let admin = repo.common_dir().join("worktrees/sibling");
    std::fs::create_dir_all(admin.join("refs/worktree")).unwrap();
    std::fs::write(
        admin.join("refs/worktree/live"),
        format!("{sibling_head}\n"),
    )
    .unwrap();
    std::fs::write(admin.join("HEAD"), "ref: refs/worktree/live\n").unwrap();
    let mut store = CacheStore::open(&repo).unwrap();
    let sibling_key = [42; 32];
    publish_live_at(&mut store, sibling_key, &sibling_head);
    let opts = EngineOptions::full();
    let cold = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap());
    clear_memo();
    let warm = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap());
    assert_eq!(test_exact_hits(), 1);
    assert_eq!(warm, cold);
    assert!(matches!(
        store.get_generation(&sibling_key, SUMMARY_VERSION).unwrap(),
        GetOutcome::Hit(_)
    ));
    assert_eq!(store.non_live_generation_count().unwrap(), 0);

    let absent_key = [43; 32];
    publish_live_at(
        &mut store,
        absent_key,
        "1111111111111111111111111111111111111111",
    );
    let worktrees = repo.common_dir().join("worktrees");
    let hidden = repo.common_dir().join("hidden-worktrees");
    std::fs::rename(&worktrees, &hidden).unwrap();
    std::fs::write(&worktrees, "not a directory").unwrap();
    reconcile_liveness(&repo, &mut store, None);
    assert_eq!(
        store.non_live_generation_count().unwrap(),
        0,
        "enumeration blindness cannot demote any generation"
    );
    std::fs::remove_file(&worktrees).unwrap();
    std::fs::rename(&hidden, &worktrees).unwrap();
    reconcile_liveness(&repo, &mut store, None);
    assert_eq!(
        store.non_live_generation_count().unwrap(),
        1,
        "the absent generation is demoted once enumeration recovers"
    );
    assert!(matches!(
        store.get_generation(&sibling_key, SUMMARY_VERSION).unwrap(),
        GetOutcome::Hit(_)
    ));
}

/// Atomic packed-ref replacements with equal or regressed timestamps must
/// retain the newly observed sibling generation through reconciliation.
#[test]
fn packed_timestamp_replacements_keep_sibling_generation_live() {
    reset_test_state();
    clear_memo();
    let (td, repo) = drifted_repo("packed-fresh-live");
    enable_store();
    let current = git_out(td.path(), &["rev-parse", "HEAD"]);
    let previous = git_out(td.path(), &["rev-parse", "HEAD^"]);
    let sibling = td.path().join("sibling");
    git(
        td.path(),
        &[
            "worktree",
            "add",
            "-b",
            "packed-sibling",
            sibling.to_str().unwrap(),
            &current,
        ],
    );
    let mut store = CacheStore::open(&repo).unwrap();
    let control_key = [44; 32];
    publish_live_at(&mut store, control_key, &current);
    for (regress, key) in [(false, [45; 32]), (true, [46; 32])] {
        std::fs::write(
            repo.common_dir().join("refs/heads/packed-sibling"),
            format!("{current}\n"),
        )
        .unwrap();
        git(td.path(), &["pack-refs", "--all", "--prune"]);
        if !regress {
            reconcile_liveness(&repo, &mut store, None);
            assert_eq!(store.non_live_generation_count().unwrap(), 0);
        }
        repo.refs.cached_packed_buffer().unwrap();
        let path = repo.common_dir().join("packed-refs");
        let timestamp = std::fs::metadata(&path).unwrap().modified().unwrap();
        let packed = std::fs::read_to_string(&path).unwrap();
        let replacement = packed.replace(
            &format!("{current} refs/heads/packed-sibling"),
            &format!("{previous} refs/heads/packed-sibling"),
        );
        assert_ne!(packed, replacement);
        let next = repo.common_dir().join("packed-refs.next");
        std::fs::write(&next, replacement).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&next)
            .unwrap()
            .set_modified(if regress {
                timestamp - std::time::Duration::from_secs(1)
            } else {
                timestamp
            })
            .unwrap();
        std::fs::rename(next, path).unwrap();
        assert_eq!(
            crate::git::head_oid(&gix::open(&sibling).unwrap()).unwrap(),
            previous
        );
        publish_live_at(&mut store, key, &previous);
        reconcile_liveness(&repo, &mut store, None);
        assert!(matches!(
            store.get_generation(&key, SUMMARY_VERSION).unwrap(),
            GetOutcome::Hit(_)
        ));
        assert_eq!(
            store.non_live_generation_count().unwrap(),
            0,
            "new packed sibling generation must remain live, regressed: {regress}"
        );
    }
}

#[test]
fn maintenance_deferred_entry_observes_dirty_state_and_verifies_lookup() {
    reset_test_state();
    clear_memo();
    let (td, repo) = drifted_repo("deferredguards");
    enable_store();
    let opts = EngineOptions::full();
    let _ = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap());
    let discoveries = TEST_MAINTENANCE_DISCOVERIES.with(std::cell::Cell::get);
    let clean_key = capture_state_token(&repo, SPAN_ROOT, opts)
        .unwrap()
        .canonical_key_digest();
    // A wrong-version generation at the exact canonical key must be rejected,
    // even though this entry defers maintenance and has unchanged worktree state.
    let mut store = CacheStore::open(&repo).unwrap();
    store
        .publish_generation(&GenerationInput {
            key_digest: clean_key,
            head: repo.head_commit().unwrap().id.to_string(),
            payload_version: SUMMARY_VERSION + 1,
            summary: vec![0],
            rows: Vec::new(),
            path_index: Vec::new(),
            live: true,
        })
        .unwrap();
    clear_memo();
    let _ = resolved(drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap());
    assert_eq!(test_exact_hits(), 0, "wrong-version lookup is rejected");
    assert!(matches!(
        store.get_generation(&clean_key, SUMMARY_VERSION).unwrap(),
        GetOutcome::Hit(_)
    ));
    std::fs::write(
        td.path().join("src/a.txt"),
        "new dirty state\nl2\nl3\nl4\nl5\n",
    )
    .unwrap();
    let dirty_key = capture_state_token(&repo, SPAN_ROOT, opts)
        .unwrap()
        .canonical_key_digest();
    assert_ne!(dirty_key, clean_key);
    clear_memo();
    assert!(matches!(
        drift_spans_new_store(&repo, SPAN_ROOT, opts).unwrap(),
        ExactAttempt::Resolved {
            whole_result: None,
            ..
        }
    ));
    assert_eq!(
        test_exact_hits(),
        0,
        "dirty observation cannot reuse the clean exact key"
    );
    assert!(matches!(
        store.get_generation(&dirty_key, SUMMARY_VERSION).unwrap(),
        GetOutcome::Hit(_)
    ));
    assert_eq!(
        TEST_MAINTENANCE_DISCOVERIES.with(std::cell::Cell::get),
        discoveries
    );
    assert_eq!(
        store.maintenance_state().unwrap().admitted_count,
        2,
        "publications do not admit another opportunity"
    );
}

#[test]
fn immutable_prepublication_missing_declaration_never_publishes() {
    reset_test_state();
    clear_memo();
    let (_td, mut repo) = drifted_repo("immutable-prepublish");
    repo.object_cache_size_if_unset(1024 * 1024);
    enable_store();
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).unwrap();
    let key = token.canonical_key_digest();
    let oid: gix::ObjectId = token.span_blobs[0].blob.parse().unwrap();
    repo.find_object(oid).unwrap();
    let hex = oid.to_string();
    let path = crate::git::common_dir(&repo)
        .join("objects")
        .join(&hex[..2])
        .join(&hex[2..]);
    set_after_build_hook(move || {
        std::fs::remove_file(&path).unwrap();
    });
    assert!(drift_spans_new_store(&repo, SPAN_ROOT, opts).is_err());
    let store = CacheStore::open(&repo).unwrap();
    assert!(matches!(
        store.get_generation(&key, SUMMARY_VERSION).unwrap(),
        GetOutcome::Miss
    ));
}
