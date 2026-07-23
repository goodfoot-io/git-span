//! In-process tests for the incremental-miss path (card main-157 Phase 4B).
//!
//! These prove the reuse/affected-set behavior white-box: an unrelated commit
//! reuses every span with zero anchor resolutions; a changed anchored path
//! re-resolves only its span; no-ancestor and global-widen cases degrade to a
//! full resolve; and — the correctness proof — a reconstructed core is
//! byte-equal to a full resolve of the same state. The full CLI differential
//! matrix (rename/copy/branch-switch/reset/rebase) is Phase 4C's job.
//!
//! `cargo nextest` runs each test in its own process, so the `GIT_SPAN_*` and
//! `GIT_CONFIG_*` environment writes below cannot leak across tests.

use super::*;
use crate::resolver::core::capture::capture_state_token;
use crate::resolver::exact::stale_spans_new_store;
use crate::resolver::store::CacheStore;
use crate::types::EngineOptions;
use std::path::{Path, PathBuf};
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

/// Write a span whose anchors carry the *canonical* rk64 fingerprint of their
/// current content, so each anchor is genuinely `Fresh` (matches at HEAD) —
/// unlike the exact-path test harness, whose deliberately-wrong rk64
/// fingerprints never match the resolver's freshness check and so always
/// read as drifted.
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
        let fp = cheap_fingerprint_with_extent(&bytes, &extent);
        records.push(crate::span_file::AnchorRecord {
            path: path.to_string(),
            start_line: *start,
            end_line: *end,
            algorithm: RK64_ALGORITHM.to_string(),
            content_hash: rk64_to_hex(fp),
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

fn init_repo(dir: &Path) {
    // Isolate from any global/system git config (e.g. a globally installed
    // git-lfs filter) so the clean-repo token stays persistence-eligible.
    unsafe {
        std::env::set_var("GIT_CONFIG_GLOBAL", "/dev/null");
        std::env::set_var("GIT_CONFIG_SYSTEM", "/dev/null");
    }
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.name", "Test User"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn enable_store() {
    // The SQLite store is unconditional; `GIT_SPAN_CACHE=0` is the only
    // disable switch. Clear it so this run engages the store.
    unsafe {
        std::env::remove_var("GIT_SPAN_CACHE");
    }
}

fn reopen(dir: &Path) -> gix::Repository {
    gix::open(dir).expect("gix open")
}

/// A clean repo with two FRESH spans (`alpha` on `src/a.txt`, `beta` on
/// `src/b.txt`) — each anchor's committed content matches its stored hash, so
/// neither drifts and neither is widen-marked.
fn fresh_two_span_repo(tag: &str) -> (tempfile::TempDir, PathBuf) {
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path().to_path_buf();
    init_repo(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    std::fs::write(dir.join("src/a.txt"), format!("{tag}-a1\na2\na3\n")).expect("write a");
    std::fs::write(dir.join("src/b.txt"), format!("{tag}-b1\nb2\nb3\n")).expect("write b");
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    write_span(&dir, "beta", &[("src/b.txt", 1, 3)], "why beta");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "init"]);
    (td, dir)
}

/// A clean repo with one DRIFTED span (its committed content changed out from
/// under the anchor) — so its ancestor generation is widen-marked.
fn drifted_one_span_repo(tag: &str) -> (tempfile::TempDir, PathBuf) {
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path().to_path_buf();
    init_repo(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    std::fs::write(dir.join("src/a.txt"), format!("{tag}-l1\nl2\nl3\n")).expect("write a");
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "init"]);
    // Drift the committed content under the anchor.
    std::fs::write(dir.join("src/a.txt"), format!("{tag}-CHANGED\nl2c\nl3c\n")).expect("drift a");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "drift"]);
    (td, dir)
}

fn commit_unrelated(dir: &Path) {
    std::fs::write(dir.join("README.md"), "unrelated change\n").expect("write readme");
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-m", "unrelated"]);
}

/// Publish an ancestor generation at the current HEAD via the real seam.
fn publish_ancestor(dir: &Path) {
    enable_store();
    let repo = reopen(dir);
    let _ = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("cold publish");
}

// ── No ancestor degrades ─────────────────────────────────────────────────────

#[test]
fn no_ancestor_degrades_to_full() {
    reset_incremental_test_state();
    let (_td, dir) = fresh_two_span_repo("noanc");
    enable_store();
    let repo = reopen(&dir);
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let key = token.canonical_key_digest();
    let mut store = CacheStore::open(&repo).expect("store");

    // Single commit: HEAD has no ancestors, so there is nothing to reuse.
    let out = attempt(&repo, SPAN_ROOT, opts, &token, &key, &mut store).expect("attempt");
    assert!(out.is_none(), "no ancestor must degrade to the cold path");
}

// ── Unrelated commit reuses with zero anchor resolutions ─────────────────────

#[test]
fn unrelated_commit_reuses_with_zero_anchor_resolutions() {
    reset_incremental_test_state();
    let (_td, dir) = fresh_two_span_repo("unrel");
    publish_ancestor(&dir);
    commit_unrelated(&dir);

    let repo = reopen(&dir);
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let key = token.canonical_key_digest();
    let mut store = CacheStore::open(&repo).expect("store");

    let out = attempt(&repo, SPAN_ROOT, opts, &token, &key, &mut store)
        .expect("attempt")
        .expect("an unrelated commit must reuse the ancestor generation");
    match out {
        ExactAttempt::Resolved { whole_result, .. } => {
            let wr = whole_result.expect("whole result present");
            assert_eq!(wr.spans.len(), 2, "both fresh spans reconstructed");
        }
        ExactAttempt::Bypass => panic!("expected Resolved, got Bypass"),
    }
    assert_eq!(
        test_incremental_anchor_resolutions(),
        0,
        "an unrelated commit must re-resolve zero anchors"
    );
}

// ── A changed anchored path re-resolves only the affected span ───────────────

#[test]
fn changed_anchored_path_reresolves_only_affected() {
    reset_incremental_test_state();
    let (_td, dir) = fresh_two_span_repo("changed");
    publish_ancestor(&dir);

    // Commit a change to alpha's anchored file only; beta is untouched.
    std::fs::write(dir.join("src/a.txt"), "changed-a1\na2x\na3x\n").expect("change a");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "touch a"]);

    let repo = reopen(&dir);
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let mut store = CacheStore::open(&repo).expect("store");

    let build = build_incremental_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("a changed path with an unaffected sibling must reuse incrementally");
    assert_eq!(build.reused, 1, "beta is reused");
    assert_eq!(build.resolved, 1, "only alpha is re-resolved");
    assert_eq!(
        build.anchor_resolutions, 1,
        "exactly alpha's one anchor is re-resolved"
    );

    // Byte-equal to a full resolve of the same state.
    let names = crate::span::read::list_span_names_in(&repo, SPAN_ROOT).expect("names");
    let full = capture_resolution_core(
        &repo,
        SPAN_ROOT,
        &names,
        crate::resolver::engine::COLD_STALE_MIN_ANCHORS_PER_TASK,
    )
    .expect("full");
    assert_eq!(
        build.core, full,
        "reconstructed core must equal a full resolve after a changed anchored path"
    );
}

// ── Global-widen (a drifted span) degrades to full resolution ────────────────

#[test]
fn all_widen_degrades_to_full() {
    reset_incremental_test_state();
    let (_td, dir) = drifted_one_span_repo("widen");
    publish_ancestor(&dir);
    commit_unrelated(&dir);

    let repo = reopen(&dir);
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let mut store = CacheStore::open(&repo).expect("store");

    // The lone span is drifted → widen-marked → affected by ANY tracked change,
    // so nothing is reusable and the path degrades to a full resolve.
    let build = build_incremental_core(&repo, SPAN_ROOT, &token, &mut store).expect("build");
    assert!(
        build.is_none(),
        "a fully widen-marked corpus must degrade to full resolution"
    );
}

// ── Reconstructed core is byte-equal to a full resolve (unrelated commit) ────

#[test]
fn reconstructed_core_byte_equal_to_full_unrelated() {
    reset_incremental_test_state();
    let (_td, dir) = fresh_two_span_repo("byteq");
    publish_ancestor(&dir);
    commit_unrelated(&dir);

    let repo = reopen(&dir);
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let mut store = CacheStore::open(&repo).expect("store");

    let build = build_incremental_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("some");
    assert_eq!(build.reused, 2, "both spans reused across an unrelated commit");
    assert_eq!(build.anchor_resolutions, 0);

    let names = crate::span::read::list_span_names_in(&repo, SPAN_ROOT).expect("names");
    let full = capture_resolution_core(
        &repo,
        SPAN_ROOT,
        &names,
        crate::resolver::engine::COLD_STALE_MIN_ANCHORS_PER_TASK,
    )
    .expect("full");
    assert_eq!(
        build.core, full,
        "a fully-reused reconstruction must equal a full resolve byte-for-byte"
    );
}
