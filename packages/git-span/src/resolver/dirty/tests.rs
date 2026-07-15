//! In-process white-box tests for the dirty-overlay path (card main-157
//! Phase 5A).
//!
//! These prove the reuse/affected-set behavior for uncommitted staged/worktree
//! state: a dirty relevant path re-resolves only its span while clean siblings
//! reuse their baseline core; the reconstructed core is byte-equal to a full
//! resolve of the *live dirty state* (the correctness proof); an unrelated
//! dirty path (`.gitignore`) is served by the exact-hit tier because it never
//! changes the canonical key; unreadable/conflict states degrade correctly; and
//! a repeated identical dirty state becomes a plain exact-hit. The full CLI
//! differential matrix (byte-comparison against cache-off) is Phase 5B's job.
//!
//! `cargo nextest` runs each test in its own process, so the `GIT_SPAN_*` and
//! `GIT_CONFIG_*` environment writes below cannot leak across tests.

use super::*;
use crate::resolver::core::capture::capture_state_token;
use crate::resolver::exact::stale_spans_new_store;
use crate::resolver::store::{CacheStore, GetOutcome};
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

/// Run a git command allowing a non-zero exit (e.g. a conflicting `merge`).
fn git_allow_fail(dir: &Path, args: &[&str]) {
    let _ = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("run git");
}

/// Write a span whose anchors carry the *canonical* rk64 fingerprint of their
/// current content, so each anchor is genuinely `Fresh` at HEAD.
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
/// `src/b.txt`) at a single commit — neither drifts nor is widen-marked.
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

/// A clean repo with three FRESH spans (`alpha`/`beta`/`gamma`) — for
/// proportionality: dirty one, reuse the other two.
fn fresh_three_span_repo(tag: &str) -> (tempfile::TempDir, PathBuf) {
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path().to_path_buf();
    init_repo(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    for f in ["a", "b", "c"] {
        std::fs::write(dir.join(format!("src/{f}.txt")), format!("{tag}-{f}1\n{f}2\n{f}3\n"))
            .expect("write src");
    }
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    write_span(&dir, "beta", &[("src/b.txt", 1, 3)], "why beta");
    write_span(&dir, "gamma", &[("src/c.txt", 1, 3)], "why gamma");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "init"]);
    (td, dir)
}

/// Publish a clean baseline generation at the current HEAD via the real seam.
fn publish_baseline(dir: &Path) {
    enable_store();
    let repo = reopen(dir);
    let _ = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("cold publish");
}

/// Full resolve of the live worktree state — the byte-equality ground truth.
fn full_live_core(repo: &gix::Repository) -> ResolutionCore {
    let names = crate::span::read::list_span_names_in(repo, SPAN_ROOT).expect("names");
    capture_resolution_core(repo, SPAN_ROOT, &names).expect("full")
}

fn open_token_store(dir: &Path) -> (gix::Repository, StateToken, CacheStore) {
    let repo = reopen(dir);
    let opts = EngineOptions::full();
    let token = capture_state_token(&repo, SPAN_ROOT, opts).expect("token");
    let store = CacheStore::open(&repo).expect("store");
    (repo, token, store)
}

// ── Byte-equality: one dirty relevant source ─────────────────────────────────

#[test]
fn dirty_source_reconstructs_byte_equal() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("dsrc");
    publish_baseline(&dir);

    // Dirty alpha's anchored file in the worktree only (no commit).
    std::fs::write(dir.join("src/a.txt"), "dsrc-CHANGED\na2x\na3x\n").expect("dirty a");

    let (repo, token, mut store) = open_token_store(&dir);
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("a dirty source with a clean sibling must reuse incrementally");
    assert_eq!(build.reused, 1, "beta is reused");
    assert_eq!(build.resolved, 1, "only alpha is re-resolved");
    assert_eq!(build.anchor_resolutions, 1, "exactly alpha's one anchor");

    assert_eq!(
        build.core,
        full_live_core(&repo),
        "reconstructed core must equal a full resolve of the live dirty state"
    );
}

// ── Byte-equality: staged-only (index changed, worktree matches index) ───────

#[test]
fn staged_only_reconstructs_byte_equal() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("staged");
    publish_baseline(&dir);

    std::fs::write(dir.join("src/a.txt"), "staged-CHANGED\na2s\na3s\n").expect("edit a");
    git(&dir, &["add", "src/a.txt"]);

    let (repo, token, mut store) = open_token_store(&dir);
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("a staged change must reuse the clean sibling");
    assert_eq!(build.reused, 1, "beta is reused");
    assert_eq!(build.resolved, 1, "only alpha is re-resolved");

    assert_eq!(
        build.core,
        full_live_core(&repo),
        "staged reconstruction must equal a full resolve of the live state"
    );
}

// ── Byte-equality: staged + further worktree edit ────────────────────────────

#[test]
fn staged_plus_worktree_reconstructs_byte_equal() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("spw");
    publish_baseline(&dir);

    std::fs::write(dir.join("src/a.txt"), "spw-STAGED\na2\na3\n").expect("edit a");
    git(&dir, &["add", "src/a.txt"]);
    // A further worktree edit on top of the staged content.
    std::fs::write(dir.join("src/a.txt"), "spw-WORKTREE\na2w\na3w\n").expect("re-edit a");

    let (repo, token, mut store) = open_token_store(&dir);
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("a staged+worktree change must reuse the clean sibling");
    assert_eq!(build.reused, 1, "beta is reused");
    assert_eq!(build.resolved, 1, "only alpha is re-resolved");

    assert_eq!(
        build.core,
        full_live_core(&repo),
        "staged+worktree reconstruction must equal a full resolve of the live state"
    );
}

// ── Byte-equality: a dirty span DEFINITION ───────────────────────────────────

#[test]
fn dirty_span_definition_reconstructs_byte_equal() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("dspan");
    publish_baseline(&dir);

    // Modify alpha's committed span file in the worktree (change its message).
    // The span file is a relevant path, so it is dirty and alpha is affected.
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha REVISED");

    let (repo, token, mut store) = open_token_store(&dir);
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("a dirty span definition must reuse the clean sibling");
    assert_eq!(build.reused, 1, "beta is reused");
    assert_eq!(build.resolved, 1, "only alpha is re-resolved");

    assert_eq!(
        build.core,
        full_live_core(&repo),
        "dirty-span reconstruction must equal a full resolve of the live worktree def"
    );
}

// ── Proportionality: one dirty of three, two reused ──────────────────────────

#[test]
fn proportional_one_dirty_of_three() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_three_span_repo("prop");
    publish_baseline(&dir);

    std::fs::write(dir.join("src/b.txt"), "prop-CHANGED\nb2x\nb3x\n").expect("dirty b");

    let (repo, token, mut store) = open_token_store(&dir);
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("one dirty of three must reuse two");
    assert!(build.reused > 0, "clean siblings are reused");
    assert_eq!(build.reused, 2, "alpha and gamma reused");
    assert_eq!(build.resolved, 1, "resolved count equals the dirty-affected count");
    assert_eq!(build.anchor_resolutions, 1, "only beta's one anchor re-resolved");

    assert_eq!(build.core, full_live_core(&repo));
}

// ── Unrelated dirt (.gitignore) is served by the exact-hit tier ──────────────

#[test]
fn unrelated_gitignore_dirt_served_by_exact_hit() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("gitig");
    enable_store();

    // Clean run: publishes and returns the clean discovery set.
    let repo = reopen(&dir);
    let clean_token = capture_state_token(&repo, SPAN_ROOT, EngineOptions::full()).expect("token");
    let clean_key = clean_token.canonical_key_digest();
    let clean_out = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("clean");
    let clean_names = resolved_names(&clean_out);

    // Dirty ONLY an unrelated, uncommitted `.gitignore`.
    std::fs::write(dir.join(".gitignore"), "target/\n*.tmp\n").expect("write .gitignore");

    let repo2 = reopen(&dir);
    let dirty_token =
        capture_state_token(&repo2, SPAN_ROOT, EngineOptions::full()).expect("token");
    // The canonical key is UNCHANGED — `.gitignore` is not a relevant path, so
    // it never enters the token. This is Finding 3's mechanism: the dirty tier
    // is never reached; the exact-hit tier serves the clean summary.
    assert_eq!(
        dirty_token.canonical_key_digest(),
        clean_key,
        "an unrelated .gitignore edit must not change the canonical key"
    );

    let dirty_out =
        stale_spans_new_store(&repo2, SPAN_ROOT, EngineOptions::full()).expect("dirty");
    let dirty_names = resolved_names(&dirty_out);
    assert_eq!(
        dirty_names, clean_names,
        "unrelated .gitignore dirt must render byte-identically to the clean state"
    );
}

// ── Unrelated TRACKED dirt reuses every baseline core proportionally ─────────

#[test]
fn unrelated_tracked_dirt_reuses_all_proportionally() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("untrk");
    // A tracked, committed file that no span anchors.
    std::fs::write(dir.join("UNRELATED.md"), "hello\n").expect("write unrelated");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "add unrelated"]);
    publish_baseline(&dir);

    // Dirty ONLY the unrelated tracked file (worktree, not committed). This
    // moves a whole-index/worktree identity in the token (so the exact key
    // differs and the dirty tier is reached) but is not a RELEVANT path.
    std::fs::write(dir.join("UNRELATED.md"), "hello CHANGED\n").expect("dirty unrelated");

    let (repo, token, mut store) = open_token_store(&dir);
    assert!(
        crate::resolver::incremental::relevant_dirty_paths(&repo, &token)
            .expect("relevant dirt")
            .is_empty(),
        "the unrelated tracked file must not be a relevant dirty path"
    );

    // The fix: rather than bypassing to a full cold rebuild
    // (`dirty-no-relevant-dirt`), a widen-free corpus reuses EVERY baseline core
    // — a fully-proportional C=0 reconstruction.
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("an unrelated tracked dirty file must engage the proportional dirty path");
    assert_eq!(build.reused, 2, "both spans reused");
    assert_eq!(build.resolved, 0, "no span re-resolved");
    assert_eq!(build.anchor_resolutions, 0, "zero anchor resolutions — fully proportional");
    assert_eq!(
        build.core,
        full_live_core(&repo),
        "the all-reused reconstruction must equal a full resolve of the live state"
    );
}

// ── Unreadable anchored file: publish-skip + fail-closed consistency ─────────

#[test]
fn unreadable_file_degrades_fail_closed() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("unread");
    publish_baseline(&dir);

    // Replace alpha's anchored file with a directory: an unreadable worktree
    // state (a typed `Unreadable`, not `Absent`).
    std::fs::remove_file(dir.join("src/a.txt")).expect("rm a");
    std::fs::create_dir(dir.join("src/a.txt")).expect("mkdir a");

    let (repo, token, mut store) = open_token_store(&dir);

    // The dirty state is NOT persistence-eligible (an Unreadable relevant path),
    // so `publish_if_eligible` publish-skips — an unreadable state never
    // pollutes the cache. This is capture.rs's typed `Unreadable` doing its job.
    assert!(
        !token.persistence_eligible(),
        "an unreadable relevant path must be persistence-ineligible (publish-skip)"
    );

    // Resolving over a path that is a directory is a hard resolver error. The
    // dirty tier surfaces it IDENTICALLY to the authoritative full resolve —
    // fail-closed: a resolver error stays an error, never masked as a stale or
    // fresh cache result (`notes/correctness-contract.md` "Fail-Closed").
    let names = crate::span::read::list_span_names_in(&repo, SPAN_ROOT).expect("names");
    let dirty_res = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store);
    let full_res = capture_resolution_core(&repo, SPAN_ROOT, &names);
    assert!(dirty_res.is_err(), "dirty tier surfaces the resolver read error");
    assert!(full_res.is_err(), "the authoritative full resolve errors identically");
}

// ── Merge conflict on an anchored path: affected and re-resolved ─────────────

#[test]
fn conflict_affected_and_reresolved() {
    reset_dirty_test_state();
    let td = tempfile::tempdir().expect("tempdir");
    let dir = td.path().to_path_buf();
    init_repo(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("mkdir src");
    std::fs::write(dir.join("src/a.txt"), "base-a1\na2\na3\n").expect("write a");
    std::fs::write(dir.join("src/b.txt"), "base-b1\nb2\nb3\n").expect("write b");
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    write_span(&dir, "beta", &[("src/b.txt", 1, 3)], "why beta");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "init"]);

    // Diverge a.txt on `other`.
    git(&dir, &["checkout", "-b", "other"]);
    std::fs::write(dir.join("src/a.txt"), "other-a1\nother-a2\nother-a3\n").expect("other a");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "other change"]);

    // On main, change a.txt AND re-anchor alpha so it is Fresh at main HEAD.
    git(&dir, &["checkout", "main"]);
    std::fs::write(dir.join("src/a.txt"), "main-a1\nmain-a2\nmain-a3\n").expect("main a");
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha");
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-m", "main change"]);

    // Baseline at the clean main HEAD, then force a conflicting merge.
    publish_baseline(&dir);
    git_allow_fail(&dir, &["merge", "other"]);

    let (repo, token, mut store) = open_token_store(&dir);
    // src/a.txt is in conflict (index stages 1/2/3) → dirty → alpha affected.
    let build = build_dirty_core(&repo, SPAN_ROOT, &token, &mut store)
        .expect("build")
        .expect("a conflict on an anchored path re-resolves its span, reuses the sibling");
    assert_eq!(build.reused, 1, "beta reused");
    assert_eq!(build.resolved, 1, "only alpha re-resolved over the conflict");
    assert_eq!(
        build.core,
        full_live_core(&repo),
        "conflict reconstruction must equal a full resolve of the conflicted state"
    );
}

// ── A repeated identical dirty state becomes a plain exact-hit ────────────────

#[test]
fn repeated_identical_dirty_state_becomes_exact_hit() {
    reset_dirty_test_state();
    let (_td, dir) = fresh_two_span_repo("repeat");
    publish_baseline(&dir);

    // Dirty a relevant source and run the full seam — the dirty tier builds and
    // publishes a generation under the dirty canonical key.
    std::fs::write(dir.join("src/a.txt"), "repeat-CHANGED\na2r\na3r\n").expect("dirty a");
    enable_store();
    let repo = reopen(&dir);
    let first = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("first");
    assert!(matches!(first, ExactAttempt::Resolved { .. }), "dirty tier resolves");

    // The dirty generation is now cached: a second identical dirty invocation is
    // a plain exact-hit (`persistence_eligible` does not require a clean
    // worktree — a dirty state publishes under its own dirty key).
    let dirty_token =
        capture_state_token(&repo, SPAN_ROOT, EngineOptions::full()).expect("token");
    let dirty_key = dirty_token.canonical_key_digest();
    let store = CacheStore::open(&repo).expect("store");
    assert!(
        matches!(
            store.get_generation(&dirty_key, crate::resolver::exact::SUMMARY_VERSION),
            Ok(GetOutcome::Hit(_))
        ),
        "a repeated identical dirty state must be a cached exact-hit"
    );

    // And the second invocation renders the same discovery set.
    let second = stale_spans_new_store(&repo, SPAN_ROOT, EngineOptions::full()).expect("second");
    assert_eq!(
        resolved_names(&first),
        resolved_names(&second),
        "the repeated dirty invocation must render identically"
    );
}

// ── The batched dirty-path map agrees with the per-path reference ────────────

/// [`relevant_dirty_paths`] sources each relevant path's HEAD blob OID from a
/// single HEAD-tree traversal instead of a per-path `tree_entry_at`; it must
/// stay byte-for-byte equivalent to the [`incremental::relevant_dirty_paths`]
/// it replaces across clean, dirty-worktree, and staged states (including a
/// nested `src/…` path, which exercises the full-path map key).
#[test]
fn batched_relevant_dirty_paths_matches_per_path_reference() {
    let (_td, dir) = fresh_three_span_repo("batch");

    let assert_agrees = |dir: &Path, note: &str| {
        let repo = reopen(dir);
        let token = capture_state_token(&repo, SPAN_ROOT, EngineOptions::full()).expect("token");
        let batched = relevant_dirty_paths(&repo, &token).expect("batched");
        let per_path =
            crate::resolver::incremental::relevant_dirty_paths(&repo, &token).expect("per-path");
        assert_eq!(batched, per_path, "{note}: batched map must match per-path walk");
        batched
    };

    // Clean: neither reports any relevant dirt.
    assert!(assert_agrees(&dir, "clean").is_empty());

    // A dirty worktree source under a subdirectory.
    std::fs::write(dir.join("src/b.txt"), "batch-CHANGED\nb2\nb3\n").expect("dirty b");
    assert!(assert_agrees(&dir, "dirty worktree source").contains("src/b.txt"));

    // A staged span-definition edit (a relevant path dirty in the index).
    write_span(&dir, "alpha", &[("src/a.txt", 1, 3)], "why alpha v2");
    git(&dir, &["add", ".span/alpha"]);
    let both = assert_agrees(&dir, "staged span definition");
    assert!(both.contains("src/b.txt") && both.contains(".span/alpha"));
}

/// The sorted discovery span names of an [`ExactAttempt`], for output-identity
/// assertions that do not depend on `SpanResolved: PartialEq`.
fn resolved_names(attempt: &ExactAttempt) -> Vec<String> {
    match attempt {
        ExactAttempt::Resolved { spans, .. } => {
            let mut names: Vec<String> = spans.iter().map(|s| s.name.clone()).collect();
            names.sort();
            names
        }
        ExactAttempt::Bypass => panic!("expected Resolved, got Bypass"),
    }
}
