//! Card main-157 regression (F2): a warm generation primed in one worktree must
//! be an *exact hit* from a sibling linked worktree at the identical HEAD and a
//! clean tree.
//!
//! `index_identity` was the last-20-byte trailer checksum of `.git/index` — a
//! SHA over the whole index INCLUDING per-entry stat data (ctime/mtime/ino). Two
//! linked worktrees keep separate index files, each written with its own
//! checkout-time stat, so their trailers never matched even at byte-identical
//! staged content. A differing `index_identity` forced a differing
//! `canonical_key_digest`, making a cross-worktree exact hit structurally
//! impossible — contradicting the card's own acceptance evidence.
//!
//! The fix makes `index_identity` content-based (a digest over each entry's
//! mode/path/blob-oid, excluding stat fields), so two worktrees with
//! byte-identical staged content key identically. This test primes a generation
//! in the primary worktree, then runs `stale` in a second linked worktree at the
//! same HEAD with a clean status, and asserts an exact hit whose output is
//! byte-identical to the cache-off oracle.
//!
//! Global/system git config is isolated to `/dev/null` so an installed
//! `filter.lfs` cannot make the token persistence-ineligible and suppress the
//! priming publish.

use std::path::Path;
use std::process::Command;

const SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");

fn run_git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn run_span(dir: &Path, args: &[&str], cache: bool, perf: bool) -> (String, String) {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_SPAN_CACHE", if cache { "1" } else { "0" })
        .args(args);
    if perf {
        cmd.env("GIT_SPAN_PERF", "1");
    }
    let out = cmd.output().expect("spawn git-span");
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn sibling_worktree_at_identical_head_is_an_exact_hit() {
    let root = tempfile::tempdir().expect("tempdir");
    let main = root.path().join("main");
    let linked = root.path().join("linked");
    std::fs::create_dir_all(&main).expect("mkdir main");

    run_git(&main, &["init", "--initial-branch=main"]);
    run_git(&main, &["config", "user.name", "Test"]);
    run_git(&main, &["config", "user.email", "test@example.com"]);
    run_git(&main, &["config", "commit.gpgsign", "false"]);

    std::fs::write(main.join("src.txt"), "s1\ns2\ns3\ns4\n").expect("write");
    run_git(&main, &["add", "-A"]);
    run_git(&main, &["commit", "-m", "seed"]);

    // A span whose committed source then drifts, so `stale` reports a non-empty
    // finding and the parity check is meaningful (an exact hit serves a drifted
    // committed corpus so long as the worktree is clean).
    run_span(&main, &["add", "m", "src.txt#L1-L3"], false, false);
    run_span(&main, &["why", "m", "seed"], false, false);
    run_git(&main, &["add", ".span"]);
    run_git(&main, &["commit", "-m", "span"]);
    std::fs::write(main.join("src.txt"), "s1CHANGED\ns2\ns3\ns4\n").expect("write drift");
    run_git(&main, &["add", "-A"]);
    run_git(&main, &["commit", "-m", "drift"]);
    run_git(&main, &["commit-graph", "write", "--reachable", "--changed-paths"]);

    // ── Prime a warm generation in the primary worktree. ─────────────────────
    let (_out, prime_perf) = run_span(&main, &["stale", "--no-exit-code"], true, true);
    assert!(
        prime_perf.contains("cache-path.hit-class: miss"),
        "priming run should be a cold build; perf:\n{prime_perf}"
    );

    // ── A sibling linked worktree at the IDENTICAL HEAD (detached), clean. ───
    run_git(&main, &["worktree", "add", "--detach", linked.to_str().unwrap(), "HEAD"]);
    assert_eq!(
        std::fs::read_to_string(main.join("src.txt")).unwrap(),
        std::fs::read_to_string(linked.join("src.txt")).unwrap(),
        "linked worktree must have byte-identical staged content"
    );

    // Cache-off oracle in the linked worktree.
    let (oracle, _) = run_span(&linked, &["stale", "--no-exit-code"], false, false);

    // The new store in the linked worktree: a clean tree at the same HEAD sharing
    // the same on-disk store (common `.git/span`) must serve the primed
    // generation as an EXACT hit.
    let (new_store, perf) = run_span(&linked, &["stale", "--no-exit-code"], true, true);

    assert_eq!(
        new_store, oracle,
        "sibling-worktree output diverged from the cache-off oracle\n\
         --- oracle ---\n{oracle}\n--- new store ---\n{new_store}"
    );
    assert!(
        perf.contains("cache-path.hit-class: exact"),
        "a sibling worktree at the identical HEAD and a clean tree must exact-hit \
         the primed generation, not cold/dirty-rebuild (F2 regression); perf:\n{perf}"
    );
    assert!(
        !perf.contains("cache-path.cold-miss-builds 1"),
        "the sibling worktree performed a cold build instead of an exact hit \
         (F2 regression); perf:\n{perf}"
    );
}
