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

fn write_span(workdir: &Path, name: &str, anchors: &[(&str, u32, u32)], why: &str) {
    let mut records = Vec::new();
    for (path, start, end) in anchors {
        let bytes = std::fs::read(workdir.join(path)).expect("read anchored file");
        let hashed: Vec<u8> = if *start == 0 && *end == 0 {
            bytes.clone()
        } else {
            let text = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = text.lines().collect();
            let lo = (*start as usize).saturating_sub(1);
            let hi = (*end as usize).min(lines.len());
            let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
            slice.join("\n").into_bytes()
        };
        records.push(crate::span_file::AnchorRecord {
            path: path.to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: "rk64".into(),
            content_hash: format!("sha256:{}", crate::types::sha256_hex(&hashed)),
        });
    }
    let sf = crate::span_file::SpanFile {
        anchors: records,
        why: why.to_string(),
    };
    let span_dir = workdir.join(SPAN_ROOT);
    std::fs::create_dir_all(&span_dir).expect("mkdir .span");
    std::fs::write(span_dir.join(name), sf.serialize()).expect("write span");
}

/// A clean repo with one span whose anchored source has drifted at HEAD, so
/// `stale` reports exactly one finding. `tag` makes the corpus content unique
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
    git(dir, &["commit-graph", "write", "--reachable", "--changed-paths"]);
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
        ExactAttempt::Resolved { spans, whole_result } => {
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
    let out = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("attempt");
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
    let out = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("attempt");
    assert!(
        matches!(out, ExactAttempt::Bypass),
        "GIT_SPAN_CACHE=0 must bypass the store"
    );
    assert_eq!(test_cold_miss_builds(), 0, "a disabled cache must do no build");
}

#[test]
fn ineligible_options_bypass() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("inelig");
    enable_store();
    // committed_only() has a non-full layer set → ineligible.
    let out =
        stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::committed_only()).expect("attempt");
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
    let cold = resolved(stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("cold"));
    assert_eq!(test_cold_miss_builds(), 1, "cold miss must build exactly once");
    assert_eq!(test_exact_hits(), 0);
    assert_eq!(cold.len(), 1, "the drifted span is reportable");
    assert_eq!(cold[0].name, "alpha");

    // Drop the in-process memo so the next call must consult the store.
    clear_memo();
    let warm = resolved(stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("warm"));
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
/// (`stale_spans_new_store`) — the same entry point the CLI drives — not the
/// store's `build_or_get` in isolation.
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
                let attempt = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full())
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
        assert_eq!(out, &outputs[0], "all concurrent callers must agree byte-for-byte");
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

    let first = resolved(stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("first"));
    assert_eq!(test_cold_miss_builds(), 1);

    // Delete the persistent store entirely; the memo must still answer.
    let store_dir = crate::git::common_dir(&repo).join("span");
    let _ = std::fs::remove_dir_all(&store_dir);

    let again = resolved(stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("again"));
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
    assert!(memo.get(&k(1)).is_none(), "oldest entry evicted at capacity");
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

    let out = stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("attempt");
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
    let core = capture_resolution_core(&repo, SPAN_ROOT, &names).expect("core");
    let widen = reuse::compute_widen(&core, false);
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let (rows, path_index) =
        reuse::core_to_reuse_rows(&core, &widen, &token.config_fingerprint());
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
    assert!(token.persistence_eligible(), "clean no-filter repo is eligible");

    let _ = resolved(stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("cold"));
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

/// The byte-ceiling config resolves with the documented precedence:
/// `GIT_SPAN_STORE_MAX_BYTES` env override > `git config git-span.storeMaxBytes`
/// > [`DEFAULT_STORE_MAX_BYTES`]; an unparseable layer falls through.
#[test]
fn store_max_bytes_env_over_config_over_default() {
    let (_td, repo) = drifted_repo("capcfg");
    let workdir = repo.workdir().expect("workdir").to_path_buf();

    unsafe {
        std::env::remove_var("GIT_SPAN_STORE_MAX_BYTES");
    }
    assert_eq!(
        store_max_bytes(&repo),
        DEFAULT_STORE_MAX_BYTES,
        "no env, no config => 256 MiB default"
    );

    // Config alone (re-open so the config snapshot includes the new key).
    git(&workdir, &["config", "git-span.storeMaxBytes", "4096"]);
    let repo = gix::open(&workdir).expect("reopen");
    assert_eq!(store_max_bytes(&repo), 4096, "config value when no env");

    // Env overrides config.
    unsafe {
        std::env::set_var("GIT_SPAN_STORE_MAX_BYTES", "8192");
    }
    assert_eq!(store_max_bytes(&repo), 8192, "env wins over config");

    // Unparseable env falls through to config.
    unsafe {
        std::env::set_var("GIT_SPAN_STORE_MAX_BYTES", "not-a-number");
    }
    assert_eq!(
        store_max_bytes(&repo),
        4096,
        "unparseable env falls through to config"
    );
}

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

/// At the high-water mark the post-publish trigger evicts a non-live
/// generation: with a 1-byte cap, [`maybe_maintain`] runs `maintain` and the
/// non-live generation is gone.
#[test]
fn maybe_maintain_evicts_non_live_over_cap() {
    let (_td, repo) = drifted_repo("capevict");
    let mut store = CacheStore::open(&repo).expect("open");
    let key = [7u8; 32];
    publish_non_live(&mut store, key);
    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "generation must be present before maintenance"
    );

    unsafe {
        std::env::set_var("GIT_SPAN_STORE_MAX_BYTES", "1");
    }
    maybe_maintain(&repo, &mut store, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", &key);

    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Miss
        ),
        "a non-live generation over the cap must be evicted by the trigger"
    );
}

/// Under the cap the trigger is a no-op beyond the cheap size probe: even a
/// non-live generation survives, since nothing is over the high-water mark.
#[test]
fn maybe_maintain_keeps_generation_under_cap() {
    let (_td, repo) = drifted_repo("capkeep");
    let mut store = CacheStore::open(&repo).expect("open");
    let key = [9u8; 32];
    publish_non_live(&mut store, key);

    unsafe {
        // Default 256 MiB — far above a tiny fresh store.
        std::env::remove_var("GIT_SPAN_STORE_MAX_BYTES");
    }
    maybe_maintain(&repo, &mut store, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", &key);

    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "under cap, the trigger must not evict anything"
    );
}

/// A real `stale` run with a 1-byte cap still returns the correct result and
/// leaves the just-published *live* generation intact (a live generation is
/// never evicted, even at the high-water mark) — the trigger's only effect is
/// on the store file, never on the command's output.
#[test]
fn tiny_cap_run_keeps_output_and_live_generation() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("capstale");
    enable_store();
    unsafe {
        std::env::set_var("GIT_SPAN_STORE_MAX_BYTES", "1");
    }
    let opts = EngineOptions::full();
    let key = capture_state_token(&repo, SPAN_ROOT, opts)
        .expect("token")
        .canonical_key_digest();

    let spans = resolved(stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("cold"));
    assert_eq!(spans.len(), 1, "the one drifted span is still reported");

    // The live generation published this run survives the maintenance pass.
    let store = CacheStore::open(&repo).expect("open");
    assert!(
        matches!(
            store.get_generation(&key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "a live generation is never evicted, even under a 1-byte cap"
    );
}

/// End-to-end proof that repeated current-version commits cannot grow the store
/// without bound (card main-157 Phase 6C's measured gap, now fixed), exercising
/// the *real* wiring: [`maybe_maintain`]'s liveness reconciliation resolves the
/// active worktree HEADs from the actual repository. Each iteration commits
/// fresh tracked content — a new HEAD, a new canonical key, a fresh `live`
/// generation, exactly the "sequence of trivial commits each triggering a fresh
/// generation" sub-case the exit gate names — then runs the real `stale` path.
///
/// The store footprint is flat across the whole sequence — bounded by the
/// single live generation the current commit references, not by the commit
/// count — because reconciliation demotes every prior commit's generation (its
/// HEAD is no longer checked out) and the quota pass evicts them. The unfixed
/// behavior grew linearly with the commit count and reclaimed nothing
/// (`store::tests::superseded_generations_reconciled_and_evicted` pins the
/// before/after at the store layer with a realistic cap). Here the first
/// commit's generation is reclaimed while the current one stays findable.
#[test]
fn repeated_commits_cannot_grow_store_unbounded() {
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
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    std::fs::write(dir.join("src/a.txt"), "seed\nl2\nl3\nl4\nl5\n").expect("seed");
    write_span(dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");

    enable_store();
    // A 1-byte cap forces the quota pass to run on every publish: after
    // reconciliation demotes the superseded generations, `maintain` evicts
    // every non-live one, so the store holds only the current live generation —
    // a footprint independent of the commit count. (The current generation is
    // live, so it is never evicted, exactly as `tiny_cap_...` asserts.)
    unsafe {
        std::env::set_var("GIT_SPAN_STORE_MAX_BYTES", "1");
    }

    let iters = 12usize;
    let mut sizes = Vec::with_capacity(iters);
    let mut keys = Vec::with_capacity(iters);
    for n in 0..iters {
        // Distinct tracked content each commit: a new tree => new HEAD and a
        // new canonical key => a fresh generation published `live`.
        let body = format!("commit-{n}\nl2\nl3\nl4\nl5\n");
        std::fs::write(dir.join("src/a.txt"), &body).expect("write src");
        git(dir, &["add", "-A"]);
        git(dir, &["commit", "-m", &format!("c{n}")]);

        let repo = gix::open(dir).expect("gix open");
        let opts = EngineOptions::full();
        let key = capture_state_token(&repo, SPAN_ROOT, opts)
            .expect("token")
            .canonical_key_digest();
        keys.push(key);

        clear_memo();
        let _ = stale_spans_new_store(&repo, SPAN_ROOT, opts).expect("stale");

        let store = CacheStore::open(&repo).expect("open");
        sizes.push(store.database_size_bytes().unwrap());
    }

    let first = sizes[0];
    let last = *sizes.last().unwrap();
    let max = *sizes.iter().max().unwrap();
    eprintln!("GROWTH repeated-commits n={iters} first={first} last={last} max={max}");

    // Flat: the footprint after the last commit is within one generation's
    // slack of the first — it does not grow with the commit count. Under the
    // unfixed all-live semantics this climbed monotonically instead.
    assert!(
        max <= first + 64 * 1024,
        "store grew with commit count: first={first} max={max} (unbounded)",
    );

    let repo = gix::open(dir).expect("gix open");
    let store = CacheStore::open(&repo).expect("open");
    // Every superseded commit's generation was demoted and reclaimed...
    for (n, key) in keys.iter().enumerate().take(iters - 1) {
        assert_eq!(
            store.get_generation(key, SUMMARY_VERSION).expect("get"),
            GetOutcome::Miss,
            "superseded generation from commit {n} must have been reclaimed",
        );
    }
    // ...while the current worktree's active generation stays live and findable.
    assert!(
        matches!(
            store
                .get_generation(keys.last().unwrap(), SUMMARY_VERSION)
                .expect("get"),
            GetOutcome::Hit(_)
        ),
        "the current worktree's active generation must remain findable",
    );
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
    String::from_utf8(out.stdout).expect("utf8").trim().to_string()
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
/// resolve is skipped, not fatal — so reconciliation still demotes stale heads
/// that no *resolvable* worktree sits on.
///
/// Pre-fix, `into_repo()` on the broken worktree returned `Err`, `live_worktree_
/// heads` propagated it, and [`reconcile_liveness`] returned before demoting
/// anything: the stale-head generation stayed permanently live and the quota
/// reclaimed nothing. This asserts both halves — the live set is the resolvable
/// subset (healthy worktree included, broken skipped, no error), and the stale
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
    git(dir, &["worktree", "add", "-b", "healthy", healthy.to_str().unwrap()]);
    std::fs::write(healthy.join("a.txt"), "healthy-change\n").expect("healthy write");
    git(&healthy, &["add", "-A"]);
    git(&healthy, &["commit", "-m", "healthy commit"]);
    let h_healthy = git_out(&healthy, &["rev-parse", "HEAD"]);
    assert_ne!(h_main, h_healthy, "healthy worktree must be at a distinct commit");

    // A broken/prunable linked worktree: created, then its working directory
    // deleted without `git worktree prune`. Its admin dir (and `gitdir` file)
    // remain, so `worktrees()` still enumerates it, but `into_repo()` fails on
    // the missing checkout — the persistent state F3 is about.
    let broken = td.path().join("broken-wt");
    git(dir, &["worktree", "add", "-b", "broken", broken.to_str().unwrap()]);
    std::fs::remove_dir_all(&broken).expect("delete broken worktree checkout");

    let repo = gix::open(dir).expect("gix open");

    // Half 1: the live set is the resolvable subset — main + healthy, broken
    // skipped — and it did NOT error despite the broken worktree.
    let live = crate::git::live_worktree_heads(&repo).expect("partial live set, not an error");
    assert!(live.contains(&h_main), "main worktree HEAD present");
    assert!(live.contains(&h_healthy), "healthy linked worktree HEAD present");

    // Half 2: reconciliation demotes a stale head no resolvable worktree sits
    // on, while both live worktrees' generations survive. A 1-byte cap makes the
    // quota pass evict every demoted (non-live) generation.
    enable_store();
    unsafe {
        std::env::set_var("GIT_SPAN_STORE_MAX_BYTES", "1");
    }
    let mut store = CacheStore::open(&repo).expect("open store");
    let k_main = [1u8; 32];
    let k_healthy = [2u8; 32];
    let k_stale = [3u8; 32];
    let h_stale = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    publish_live_at(&mut store, k_main, &h_main);
    publish_live_at(&mut store, k_healthy, &h_healthy);
    publish_live_at(&mut store, k_stale, h_stale);

    // The production trigger, with the current worktree's (head, key).
    maybe_maintain(&repo, &mut store, &h_main, &k_main);

    assert!(
        matches!(
            store.get_generation(&k_stale, SUMMARY_VERSION).expect("get"),
            GetOutcome::Miss
        ),
        "a generation at a stale head (no resolvable worktree) must be demoted and evicted",
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
            store.get_generation(&k_healthy, SUMMARY_VERSION).expect("get"),
            GetOutcome::Hit(_)
        ),
        "the healthy linked worktree's live generation must survive",
    );
}
