//! Card main-157 Phase 3: differential parity for the store execution path
//! (now the default and only cache — no legacy path, no development switch).
//!
//! The store must be byte-identical to the fully-disabled ground truth across
//! every output format, on the clean / exact-cold / exact-warm states this
//! phase landed. It must also actually ENGAGE (a `--perf` trace proves a
//! one-build cold miss and an exact warm hit), so a silent bypass cannot make
//! this pass trivially.
//!
//! Every subprocess runs with global/system git config isolated
//! (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` → `/dev/null`) so a globally
//! installed `filter.lfs` cannot make the token persistence-ineligible (by
//! design — see `StateToken::persistence_eligible`) and thereby prevent the new
//! store from ever publishing a warm generation. Isolation is applied uniformly
//! to all three modes, so the comparison stays valid.

use crate::support;

use anyhow::Result;
use std::path::{Path, PathBuf};
use std::process::Command;
use support::TestRepo;

const SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");
const FORMATS: &[&str] = &["human", "porcelain", "json"];

#[derive(Clone, Copy)]
enum Mode {
    /// The store disabled — the ground-truth oracle.
    Disabled,
    /// The store (default, no switch needed).
    NewStore,
}

/// Run `git span <args>` in `repo` under `mode`, with global/system config
/// isolated. `perf` toggles `GIT_SPAN_PERF` so the cache-path trace lands on
/// stderr. Returns `(stdout, stderr)`.
fn run(repo: &Path, args: &[&str], mode: Mode, perf: bool) -> (String, String) {
    let mut cmd = Command::new(SPAN_BIN);
    cmd.current_dir(repo).args(args);
    cmd.env("GIT_CONFIG_GLOBAL", "/dev/null");
    cmd.env("GIT_CONFIG_SYSTEM", "/dev/null");
    match mode {
        Mode::Disabled => {
            cmd.env("GIT_SPAN_CACHE", "0");
        }
        Mode::NewStore => {}
    }
    if perf {
        cmd.env("GIT_SPAN_PERF", "1");
    }
    let out = cmd
        .output()
        .unwrap_or_else(|e| panic!("spawn git-span {args:?}: {e}"));
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Remove every persistent cache tier so the next run is a genuine cold miss.
fn clear_all_caches(repo: &Path) {
    let span_dir = repo.join(".git").join("span");
    // New store.
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(span_dir.join(format!("store.db{suffix}")));
    }
    // Legacy SQLite + filesystem tiers.
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(span_dir.join(format!("stale-cache.db{suffix}")));
    }
    let _ = std::fs::remove_dir_all(span_dir.join("cache"));
}

/// A clean multi-span corpus with committed drift at HEAD, so `stale` reports
/// findings across formats without a dirty worktree.
fn seed(repo: &TestRepo) -> Result<PathBuf> {
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("b.txt", "b1\nb2\nb3\nb4\nb5\n")?;
    repo.write_file("c.txt", "c1\nc2\nc3\nc4\nc5\n")?;
    repo.commit_all("seed")?;

    // aaa drifts (its anchored region changes at HEAD); bbb stays fresh; ccc
    // is orphaned (its file is deleted at HEAD).
    repo.run_span(["add", "aaa", "a.txt#L1-L3"])?;
    repo.run_span(["why", "aaa", "tracks a"])?;
    repo.run_span(["add", "bbb", "b.txt#L1-L3"])?;
    repo.run_span(["why", "bbb", "tracks b"])?;
    repo.run_span(["add", "ccc", "c.txt#L1-L3"])?;
    repo.run_span(["why", "ccc", "tracks c"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "spans"])?;

    // Drift aaa's region and orphan ccc, via COMMITS so the tree stays clean.
    repo.write_file("a.txt", "A1_CHANGED\nA2_CHANGED\na3\na4\na5\n")?;
    std::fs::remove_file(repo.path().join("c.txt"))?;
    repo.run_git(["add", "-A"])?;
    repo.commit_all("drift and orphan")?;
    repo.write_commit_graph()?;
    Ok(repo.path().to_path_buf())
}

#[test]
fn store_matches_disabled_across_formats() -> Result<()> {
    let repo = TestRepo::new()?;
    let path = seed(&repo)?;
    let stale = ["stale", "--no-exit-code"];

    for fmt in FORMATS {
        let args = [stale[0], stale[1], "--format", fmt];

        // Ground truth: fully disabled.
        clear_all_caches(&path);
        let (disabled, _) = run(&path, &args, Mode::Disabled, false);

        // Sanity: the corpus actually produces findings, so parity is meaningful.
        assert!(
            !disabled.trim().is_empty(),
            "[{fmt}] ground truth is empty — corpus does not exercise findings"
        );

        // Store cold + warm.
        clear_all_caches(&path);
        let (new_cold, _) = run(&path, &args, Mode::NewStore, false);
        let (new_warm, _) = run(&path, &args, Mode::NewStore, false);

        assert_eq!(new_cold, disabled, "[{fmt}] store cold != disabled");
        assert_eq!(new_warm, disabled, "[{fmt}] store warm != disabled");
    }
    Ok(())
}

/// Prove the store actually engaged — a one-build exact-cold followed by an
/// exact warm hit — rather than silently bypassing.
#[test]
fn store_engages_with_one_build_then_exact_hit() -> Result<()> {
    let repo = TestRepo::new()?;
    let path = seed(&repo)?;
    let args = ["stale", "--no-exit-code"];

    clear_all_caches(&path);
    let (_, cold_err) = run(&path, &args, Mode::NewStore, true);
    assert!(
        cold_err.contains("cache-path.cold-miss-builds 1"),
        "cold run must record exactly one resolver build:\n{cold_err}"
    );
    assert!(
        !cold_err.contains("cache-path.hit-class: exact"),
        "cold run must NOT be an exact hit:\n{cold_err}"
    );

    let (_, warm_err) = run(&path, &args, Mode::NewStore, true);
    assert!(
        warm_err.contains("cache-path.hit-class: exact"),
        "warm run must be a store exact hit:\n{warm_err}"
    );
    assert!(
        !warm_err.contains("cache-path.cold-miss-builds 1"),
        "warm run must NOT rebuild:\n{warm_err}"
    );
    Ok(())
}
