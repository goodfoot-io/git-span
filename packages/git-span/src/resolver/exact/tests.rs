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

fn enable_v3() {
    // Safe under nextest's process-per-test isolation.
    unsafe {
        std::env::set_var("GIT_SPAN_CACHE_STORE_V3", "1");
        std::env::remove_var("GIT_SPAN_CACHE");
        std::env::remove_var("GIT_SPAN_CACHE_V2");
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

// ── Switch inertness ─────────────────────────────────────────────────────────

#[test]
fn switch_unset_is_bypass() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("unset");
    unsafe {
        std::env::remove_var("GIT_SPAN_CACHE_STORE_V3");
    }
    let out = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("attempt");
    assert!(
        matches!(out, ExactAttempt::Bypass),
        "with the switch unset the new path must be fully inert"
    );
    assert_eq!(test_cold_miss_builds(), 0, "no build when switch is unset");
}

#[test]
fn all_off_bypasses_new_path() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("alloff");
    unsafe {
        std::env::set_var("GIT_SPAN_CACHE_STORE_V3", "1");
        std::env::set_var("GIT_SPAN_CACHE", "0");
        std::env::set_var("GIT_SPAN_CACHE_V2", "0");
    }
    let out = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("attempt");
    assert!(
        matches!(out, ExactAttempt::Bypass),
        "both legacy switches off must bypass the new path too"
    );
    assert_eq!(test_cold_miss_builds(), 0, "all-off must do no build");
}

#[test]
fn ineligible_options_bypass() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("inelig");
    enable_v3();
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
    enable_v3();
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

// ── Bounded in-process memo ──────────────────────────────────────────────────

#[test]
fn memo_serves_repeat_without_store_read() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("memo");
    enable_v3();
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
    enable_v3();
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

#[test]
fn clean_run_publishes_and_is_eligible() {
    reset_test_state();
    clear_memo();
    let (_td, repo) = drifted_repo("cleanpub");
    enable_v3();
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
