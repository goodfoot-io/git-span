//! Regression (originally F5): a worktree-only edit to an anchored source
//! file must re-resolve against the *current* worktree bytes, never replay a
//! prior dirty run's cached staleness verdict.
//!
//! The historical bug lived in the deleted `cache_v2` dirty overlay: its key
//! folded the dirty *source* contribution as `fingerprint(path, path)` — the
//! path string, not the file's bytes — so a worktree-only edit (no index or
//! commit change) left every keyed component unchanged and the overlay
//! replayed the previous run's verdict, a silent wrong result. The new
//! store's `StateToken` folds each relevant path's typed worktree content
//! identity, so a distinct dirty state yields a distinct key and cannot
//! exact-hit a stale generation. This test pins that guarantee against the
//! new (and only) store.
//!
//! Scenario: span anchors `file1.txt#L1-L5`.
//!   - Edit A drifts *inside* the anchored range → `stale` reports stale and
//!     publishes a dirty generation for A's state.
//!   - Edit B reverts lines 1-5 to the committed content but drifts line
//!     10 (outside the anchor) so the file stays worktree-dirty with the
//!     same path set, but the anchored range is now clean.
//!   - The second `stale` must classify against B (NOT stale) and re-resolve
//!     (a cold-miss build), not exact-hit A's published "changed" verdict.
//!
//! The binary is spawned directly so `GIT_SPAN_CACHE`/`GIT_SPAN_PERF` can be
//! toggled. `GIT_SPAN_CACHE=0` is the single remaining disable switch.

use std::fs;
use std::path::Path;
use std::process::Command;

const GIT_SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");

fn run_git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

fn run_span(dir: &Path, args: &[&str]) {
    let out = Command::new(GIT_SPAN_BIN)
        .current_dir(dir)
        .env("GIT_SPAN_CACHE", "1")
        .args(args)
        .output()
        .expect("spawn git-span");
    assert!(
        out.status.success(),
        "git-span {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Run `git span stale --no-exit-code` with the cache + perf enabled.
/// Returns (stdout, `cache-path.cold-miss-builds` count) — the count of
/// authoritative resolver builds this run performed (the new store's
/// signal that the run re-resolved rather than replaying a cached verdict).
fn run_stale(repo: &Path) -> (String, u64) {
    let out = Command::new(GIT_SPAN_BIN)
        .current_dir(repo)
        .env("GIT_SPAN_CACHE", "1")
        .env("GIT_SPAN_PERF", "1")
        .args(["stale", "--no-exit-code"])
        .output()
        .expect("spawn git-span stale");
    assert!(
        out.status.success(),
        "git span stale failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr);
    // The new store must NOT serve edit B as an exact hit of edit A's
    // published dirty generation — that would replay A's stale verdict
    // (the F5 bug). A re-resolve shows up as a cold-miss build.
    assert!(
        !stderr.contains("cache-path.hit-class: exact"),
        "run replayed a cached exact verdict instead of re-resolving:\n{stderr}"
    );
    let cold_miss_builds = parse_perf_counter(&stderr, "cache-path.cold-miss-builds");
    (stdout, cold_miss_builds)
}

fn parse_perf_counter(stderr: &str, label: &str) -> u64 {
    for line in stderr.lines() {
        if let Some(rest) = line.strip_prefix("git-span perf: ")
            && let Some(val) = rest.strip_prefix(&format!("{label} "))
            && let Ok(v) = val.trim().parse::<u64>()
        {
            return v;
        }
    }
    0
}

#[test]
fn worktree_only_edit_to_anchored_source_misses_overlay_cache() {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path();

    run_git(p, &["init", "--initial-branch=main"]);
    run_git(p, &["config", "user.name", "Test"]);
    run_git(p, &["config", "user.email", "test@example.com"]);
    run_git(p, &["config", "commit.gpgsign", "false"]);

    fs::write(
        p.join("file1.txt"),
        "a1\na2\na3\na4\na5\nb6\nb7\nb8\nb9\nb10\n",
    )
    .expect("write seed");
    run_git(p, &["add", "-A"]);
    run_git(p, &["commit", "-m", "seed"]);

    run_span(p, &["add", "m", "file1.txt#L1-L5"]);
    run_span(p, &["why", "m", "-m", "seed"]);
    run_git(p, &["add", ".span"]);
    run_git(p, &["commit", "-m", "span"]);

    // ── Edit A: drift *inside* the anchored range (worktree-only). ────────
    fs::write(
        p.join("file1.txt"),
        "AAA1\na2\na3\na4\na5\nb6\nb7\nb8\nb9\nb10\n",
    )
    .expect("write A");
    let (out_a, _) = run_stale(p);
    assert!(
        out_a.contains("file1.txt#L1-L5"),
        "edit A must report the anchored range stale; stdout=\n{out_a}"
    );

    // ── Edit B: restore lines 1-5 to committed content; drift line 10
    //    (outside the anchor) so the file stays worktree-dirty with the
    //    same dirty path set, but the anchored range is now clean. ────────
    fs::write(
        p.join("file1.txt"),
        "a1\na2\na3\na4\na5\nb6\nb7\nb8\nb9\nBBB10\n",
    )
    .expect("write B");
    let (out_b, cold_miss_builds_b) = run_stale(p);

    // The verdict must reflect B (anchored range clean → not stale), not
    // A's cached "changed" classification.
    assert!(
        !out_b.contains("file1.txt#L1-L5 — changed"),
        "edit B replayed edit A's cached stale verdict (F5 regression); \
         stdout=\n{out_b}"
    );
    assert!(
        out_b.contains("0 stale"),
        "edit B must classify the anchored range as not stale; stdout=\n{out_b}"
    );

    // And it must have been a recompute (an authoritative resolver build),
    // proving the new store's state token folded B's source-file content
    // identity rather than exact-hitting A's published dirty generation.
    assert_eq!(
        cold_miss_builds_b, 1,
        "worktree-only edit to an anchored source file must re-resolve \
         (one cold-miss build), not replay a cached verdict (got \
         cold-miss-builds={cold_miss_builds_b})"
    );
}
