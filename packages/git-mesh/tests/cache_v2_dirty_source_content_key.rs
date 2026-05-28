//! Regression for F5 (cache_v2 dirty overlay key omitted dirty source-file
//! content identity).
//!
//! Before the fix the dirty *source* contribution to the overlay key was
//! `fingerprint(path, path)` — the path string, not the file's bytes. A
//! worktree-only edit (no index/commit change) left the committed digest,
//! the all-zero clean-index checksum, and the dirty-source fingerprint all
//! unchanged, so `load_overlay` returned the *previous* run's cached
//! staleness verdict. The normal edit → stale → edit → stale loop then
//! reported the earlier edit's classification, not current worktree
//! content — a silent wrong result persisting in the shared stale-cache DB.
//!
//! Scenario: mesh anchors `file1.txt#L1-L5`.
//!   - Edit A drifts *inside* the anchored range → `stale` reports stale,
//!     verdict cached under the dirty overlay key.
//!   - Edit B reverts lines 1-5 to the committed content but drifts line
//!     10 (outside the anchor) so the file stays worktree-dirty with the
//!     same path set, but the anchored range is now clean.
//!   - The second `stale` must classify against B (NOT stale) and miss the
//!     overlay cache (recompute), not replay A's cached "changed" verdict.
//!
//! The binary is spawned directly so `GIT_MESH_CACHE`/`GIT_MESH_PERF` can
//! be toggled; the env-var path mirrors `cache_warm_perf.rs`.

use std::fs;
use std::path::Path;
use std::process::Command;

const GIT_MESH_BIN: &str = env!("CARGO_BIN_EXE_git-mesh");

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

fn run_mesh(dir: &Path, args: &[&str]) {
    let out = Command::new(GIT_MESH_BIN)
        .current_dir(dir)
        .env("GIT_MESH_CACHE", "1")
        .args(args)
        .output()
        .expect("spawn git-mesh");
    assert!(
        out.status.success(),
        "git-mesh {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Run `git mesh stale --no-exit-code` with the cache + perf enabled.
/// Returns (stdout, `cache_v2.overlay-miss` count).
fn run_stale(repo: &Path) -> (String, u64) {
    let out = Command::new(GIT_MESH_BIN)
        .current_dir(repo)
        .env("GIT_MESH_CACHE", "1")
        .env("GIT_MESH_PERF", "1")
        .args(["stale", "--no-exit-code"])
        .output()
        .expect("spawn git-mesh stale");
    assert!(
        out.status.success(),
        "git mesh stale failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let overlay_miss = parse_perf_counter(&stderr, "cache_v2.overlay-miss");
    (stdout, overlay_miss)
}

fn parse_perf_counter(stderr: &str, label: &str) -> u64 {
    for line in stderr.lines() {
        if let Some(rest) = line.strip_prefix("git-mesh perf: ")
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

    run_mesh(p, &["add", "m", "file1.txt#L1-L5"]);
    run_mesh(p, &["why", "m", "-m", "seed"]);
    run_git(p, &["add", ".mesh"]);
    run_git(p, &["commit", "-m", "mesh"]);

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
    let (out_b, overlay_miss_b) = run_stale(p);

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

    // And it must have been a recompute (cache miss), proving the dirty
    // overlay key folded B's source-file content identity.
    assert_eq!(
        overlay_miss_b, 1,
        "worktree-only edit to an anchored source file must miss the \
         dirty overlay cache and recompute (got overlay-miss={overlay_miss_b})"
    );
}
