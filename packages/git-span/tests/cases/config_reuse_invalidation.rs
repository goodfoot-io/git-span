//! Card main-157 regression (F1): a reuse tier must never serve — or
//! re-publish — a baseline generation whose *config-sensitive* inputs no longer
//! match the current invocation.
//!
//! The incremental and dirty tiers locate a baseline generation by HEAD alone
//! (`find_ancestor` / `find_generation_by_head`), and HEAD is excluded from the
//! canonical key. Nothing forced the located generation's config-sensitive
//! canonical-key inputs (`core.autocrlf`/`core.eol` normalization, filter
//! identity, replace-refs, rename budget, copy detection, sparse-checkout, ...)
//! to still match the current run. So: publish a generation at HEAD, then change
//! `core.autocrlf` with no commit and no worktree edit, and the dirty tier would
//! find the same-HEAD baseline, see nothing dirty, and reuse every stored core
//! verbatim — silently re-serving (and re-publishing under the new key) a result
//! resolved under the *old* config.
//!
//! The fix persists a config fingerprint with each rows-bearing generation and
//! makes both reuse tiers validate it before trusting any stored core, falling
//! through to a full cold resolve on any drift. This test drives the exact
//! scenario the finding names — an `core.autocrlf` change between a baseline
//! publish and a same-HEAD reuse attempt — and asserts the run cold-resolves
//! (never a reuse hit) and matches the cache-off oracle byte-for-byte.
//!
//! Global/system git config is isolated to `/dev/null` so an installed
//! `filter.lfs` cannot make the token persistence-ineligible and suppress the
//! baseline publish.

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

/// Run `git span <args>`; `cache` toggles the store (`GIT_SPAN_CACHE`),
/// `perf` toggles the hit-class trace. Returns `(stdout, stderr)`.
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
fn autocrlf_change_between_publish_and_same_head_reuse_falls_through_to_cold() {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path();

    run_git(p, &["init", "--initial-branch=main"]);
    run_git(p, &["config", "user.name", "Test"]);
    run_git(p, &["config", "user.email", "test@example.com"]);
    run_git(p, &["config", "commit.gpgsign", "false"]);
    // Start from a definite normalization config so the later change is a real
    // transition.
    run_git(p, &["config", "core.autocrlf", "false"]);

    // A single Fresh span over a line range. Fresh + clean ⇒ NOT widen-marked,
    // which is precisely the corpus the dirty tier would otherwise reuse
    // verbatim when nothing is dirty (the vulnerable path).
    std::fs::write(p.join("file1.txt"), "a1\na2\na3\na4\na5\n").expect("write");
    run_git(p, &["add", "-A"]);
    run_git(p, &["commit", "-m", "seed"]);
    let (_o, e) = run_span(p, &["add", "m", "file1.txt#L1-L5"], false, false);
    assert!(e.is_empty() || !e.contains("error"), "add failed: {e}");
    run_span(p, &["why", "m", "-m", "seed"], false, false);
    run_git(p, &["add", ".span"]);
    run_git(p, &["commit", "-m", "span"]);
    // Resolver entry points require a commit-graph with changed-path filters.
    run_git(p, &["commit-graph", "write", "--reachable", "--changed-paths"]);

    // ── Publish a baseline generation at HEAD (autocrlf=false). ──────────────
    let (_out, _err) = run_span(p, &["stale", "--no-exit-code"], true, true);

    // ── Change ONLY the normalization config: no commit, no worktree edit. ───
    run_git(p, &["config", "core.autocrlf", "true"]);

    // Cache-off oracle under the new config (never touches the store).
    let (oracle, _) = run_span(p, &["stale", "--no-exit-code"], false, false);

    // The new store, against a store that still holds only the baseline. The
    // canonical key changed (normalization_digest moved), so the exact read
    // misses and the dirty tier finds the same-HEAD baseline — which it must
    // now reject on config drift rather than reuse.
    let (new_store, perf) = run_span(p, &["stale", "--no-exit-code"], true, true);

    assert_eq!(
        new_store, oracle,
        "new-store output diverged from the cache-off oracle after a config \
         change\n--- oracle ---\n{oracle}\n--- new store ---\n{new_store}"
    );

    // The run must have cold-resolved, NOT reused the stale baseline.
    assert!(
        perf.contains("cache-path.hit-class: miss"),
        "expected a cold resolve after config drift; perf:\n{perf}"
    );
    assert!(
        !perf.contains("cache-path.hit-class: dirty")
            && !perf.contains("cache-path.hit-class: incremental")
            && !perf.contains("cache-path.hit-class: exact"),
        "a reuse tier served a baseline resolved under the OLD config \
         (F1 regression); perf:\n{perf}"
    );
    assert!(
        perf.contains("cache-path.bypass-reason: dirty-config-drift"),
        "expected the dirty tier to reject the same-HEAD baseline on config \
         drift; perf:\n{perf}"
    );
}
