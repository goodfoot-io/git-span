//! Regression/evidence tests for card main-300: share one index snapshot
//! across drifted-anchor scans and route `compute_layer_sources` through
//! the session's memoized blob reader.
//!
//! Two invariants are pinned, both observable through counters that already
//! exist (or are emitted alongside the existing `session.*` family):
//!
//! 1. **Index snapshot count per run is constant.** Before main-300,
//!    `find_relocated_range_in_paths` and `find_similar_ranges` each called
//!    `git::index_entries(repo)` per drifted anchor, so a run over K
//!    worktree-deleted anchors rematerialized the snapshot ~2·K times. The
//!    session now materializes it once (`session.index-snapshot-loads == 1`)
//!    and the process-global `index_entries_call_count` during an in-process
//!    `resolve_span` is identical for different anchor counts.
//!
//! 2. **Layer-source reads hit the session memo.** With K range anchors on
//!    ONE deleted file, every anchor's `compute_layer_sources` (and its
//!    `ResolvedPendingCommit` probe) reads the same HEAD blob; after the fix
//!    the ODB decode happens exactly once (`session.blob-text-misses == 1`)
//!    while every later request is a memo hit.

use crate::support;

use anyhow::Result;
use git_span::types::{AnchorStatus, EngineOptions};
use git_span::{index_entries_call_count, reset_index_entries_call_count, resolve_span};
use std::process::Command;
use support::TestRepo;

/// Distinct, mutually-dissimilar body for candidate file `i`, so the fuzzy
/// scan never finds a relocation target and every drifted anchor lands on
/// the `Changed` classification (which is what drives the per-anchor scans).
fn body(i: usize) -> String {
    format!("zeta{i} alpha line\nzeta{i} beta line\nzeta{i} gamma line\n")
}

/// One span named `m` holding one line-range anchor per seeded file, plus
/// every seeded file deleted from the worktree (index still tracks them):
/// the worst-case shape from the card — every anchor drifted-absent, every
/// anchor running the cross-path relocation scan, the worktree-blob
/// fallback, and the fuzzy-similarity scan.
fn seed_multi_file_fixture(repo: &TestRepo, k: usize) -> Result<()> {
    for i in 0..k {
        repo.write_file(&format!("src/file{i:02}.txt"), &body(i))?;
    }
    repo.commit_all("seed files")?;
    let mut add_args = vec!["add".to_string(), "m".to_string()];
    for i in 0..k {
        add_args.push(format!("src/file{i:02}.txt#L1-L2"));
    }
    repo.run_span(&add_args)?;
    repo.run_span(["why", "m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "seed spans"])?;
    repo.write_commit_graph()?;
    for i in 0..k {
        std::fs::remove_file(repo.path().join(format!("src/file{i:02}.txt")))?;
    }
    Ok(())
}

/// One span named `m` holding `k` disjoint range anchors on ONE file, which
/// is then deleted from the worktree: every anchor shares the file's HEAD
/// blob, so layer-source reads collapse onto a single OID.
fn seed_single_file_fixture(repo: &TestRepo, k: usize) -> Result<()> {
    let mut contents = String::new();
    for i in 0..(3 * k) {
        contents.push_str(&format!("shared line {i:04}\n"));
    }
    repo.write_file("src/shared.txt", &contents)?;
    repo.commit_all("seed shared file")?;
    let mut add_args = vec!["add".to_string(), "m".to_string()];
    for i in 0..k {
        let start = 3 * i + 1;
        add_args.push(format!("src/shared.txt#L{start}-L{}", start + 1));
    }
    repo.run_span(&add_args)?;
    repo.run_span(["why", "m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "seed spans"])?;
    repo.write_commit_graph()?;
    std::fs::remove_file(repo.path().join("src/shared.txt"))?;
    Ok(())
}

/// Run the real `git span drift` binary with perf counters enabled and
/// return (stdout, stderr).
fn run_drift_with_perf(repo: &TestRepo) -> Result<(String, String)> {
    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .args(["drift", "--no-exit-code"])
        .env("GIT_SPAN_PERF", "1")
        .env("GIT_SPAN_CACHE", "0")
        .output()?;
    Ok((
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

fn parse_counter(stderr: &str, label: &str) -> u64 {
    for line in stderr.lines() {
        if let Some(rest) = line.strip_prefix("git-span perf: ")
            && let Some(value_str) = rest.strip_prefix(&format!("{label} "))
            && let Ok(v) = value_str.trim().parse::<u64>()
        {
            return v;
        }
    }
    panic!("counter `{label}` not found in stderr:\n{stderr}");
}

/// Card main-300, invariant 1 (in-process): the number of
/// `git::index_entries` materializations during one `resolve_span` run must
/// not scale with the drifted-anchor count. Pre-fix this is `1 + 2·K`
/// (one span-read conflict probe + a relocation/fuzzy snapshot pair per
/// drifted anchor); post-fix it is exactly 2 (the same span-read probe +
/// the single session snapshot).
#[test]
fn index_snapshot_loads_do_not_scale_with_drifted_anchor_count() -> Result<()> {
    // (anchors, expected global index_entries calls)
    for (k, expected) in [(3usize, 2usize), (7, 2)] {
        let repo = TestRepo::new()?;
        seed_multi_file_fixture(&repo, k)?;

        reset_index_entries_call_count();
        let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;

        // Every anchor must actually have gone through the drifted-absent
        // classification (which is what used to rescan the index per
        // anchor) — otherwise this assertion would pass vacuously.
        assert_eq!(mr.anchors.len(), k, "all anchors resolved");
        for anchor in &mr.anchors {
            assert_eq!(
                anchor.status,
                AnchorStatus::Changed,
                "worktree-deleted anchor {} must classify Changed",
                anchor.anchor_id
            );
        }

        let count = index_entries_call_count();
        assert_eq!(
            count, expected,
            "index_entries called {count} times for K={k} — expected \
             {expected} (1 span-read conflict probe + 1 session-wide index \
             snapshot). The drifted-anchor scans are re-materializing the \
             index instead of sharing the session snapshot."
        );
    }
    Ok(())
}

/// Card main-300, invariant 1 (perf-counter surface): the session reports
/// exactly one index snapshot materialization regardless of how many
/// drifted anchors scanned it.
#[test]
fn session_reports_one_index_snapshot_per_run() -> Result<()> {
    for k in [3usize, 7] {
        let repo = TestRepo::new()?;
        seed_multi_file_fixture(&repo, k)?;
        let (stdout, stderr) = run_drift_with_perf(&repo)?;

        // Sanity: every drifted anchor rendered a row naming its file, so
        // the scans genuinely ran.
        for i in 0..k {
            let path = format!("src/file{i:02}.txt");
            assert!(
                stdout.contains(&path),
                "anchor on {path} must render a drift row; stdout=\n{stdout}\nstderr=\n{stderr}"
            );
        }

        let loads = parse_counter(&stderr, "session.index-snapshot-loads");
        assert_eq!(
            loads, 1,
            "session.index-snapshot-loads must be 1 per run (K={k}) — got \
             {loads}; the index snapshot is being rematerialized.\nstderr=\n{stderr}"
        );
    }
    Ok(())
}

/// Card main-300, invariant 2: layer-source blob reads hit the session
/// memo. K range anchors on one deleted file share one HEAD blob, so the
/// ODB decode happens once (`blob-text-misses == 1`) while subsequent
/// requests are memo hits scaling with the anchor count.
#[test]
fn layer_source_reads_hit_the_session_blob_memo() -> Result<()> {
    for k in [2usize, 6] {
        let repo = TestRepo::new()?;
        seed_single_file_fixture(&repo, k)?;
        let (_stdout, stderr) = run_drift_with_perf(&repo)?;

        let misses = parse_counter(&stderr, "session.blob-text-misses");
        let hits = parse_counter(&stderr, "session.blob-text-hits");
        assert_eq!(
            misses, 1,
            "session.blob-text-misses must be 1 (K={k}): every anchor's \
             layer-source reads name the same HEAD blob, so exactly one ODB \
             decode may happen. Got {misses}.\nstderr=\n{stderr}"
        );
        // Each anchor makes ≥3 blob-text requests (ResolvedPendingCommit
        // probe + HEAD-layer + index-layer reads in compute_layer_sources),
        // all against the same OID: at least 3·K−1 of them must be hits.
        assert!(
            hits as usize >= 3 * k - 1,
            "expected ≥ {} memo hits for K={k}, got {hits}\nstderr=\n{stderr}",
            3 * k - 1
        );
    }
    Ok(())
}

/// Whole-file twin of [`seed_multi_file_fixture`]: one span named `m`
/// holding ONE whole-file anchor per seeded file (no line extent), every
/// file then removed from the worktree. Every anchor takes the full
/// whole-file resolution path — index-layer entry probe, gitlink probe,
/// cross-path relocation scan — each of which used to call
/// `git::index_entries` per anchor before the session snapshot covered
/// `whole_file.rs`.
///
/// With `committed_delete`, the files are `git rm`ed and committed
/// instead: anchors additionally fall into the absent-at-HEAD arm whose
/// submodule probe is the fourth whole-file snapshot consumer.
fn seed_multi_file_fixture_whole(repo: &TestRepo, k: usize, committed_delete: bool) -> Result<()> {
    for i in 0..k {
        repo.write_file(&format!("src/file{i:02}.txt"), &body(i))?;
    }
    repo.commit_all("seed files")?;
    let mut add_args = vec!["add".to_string(), "m".to_string()];
    for i in 0..k {
        add_args.push(format!("src/file{i:02}.txt"));
    }
    repo.run_span(&add_args)?;
    repo.run_span(["why", "m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "seed spans"])?;
    if committed_delete {
        for i in 0..k {
            repo.run_git(["rm", &format!("src/file{i:02}.txt")])?;
        }
        repo.run_git(["commit", "-m", "delete seeded files"])?;
    }
    repo.write_commit_graph()?;
    if !committed_delete {
        for i in 0..k {
            std::fs::remove_file(repo.path().join(format!("src/file{i:02}.txt")))?;
        }
    }
    Ok(())
}

/// Card main-300 whole-file follow-up, invariant 1 (in-process): the
/// number of `git::index_entries` materializations during one
/// `resolve_span` over K drifted WHOLE-FILE anchors must not scale with K.
/// Pre-follow-up this is `1 + 3·K` for worktree-deleted anchors (one
/// span-read conflict probe + an index-entry/gitlink/relocation-scan
/// materialization triple per anchor); post-follow-up it is exactly 2.
#[test]
fn whole_file_index_snapshot_loads_do_not_scale_with_drifted_anchor_count() -> Result<()> {
    for (committed_delete, expected) in [(false, 2usize), (true, 2)] {
        for k in [3usize, 7] {
            let repo = TestRepo::new()?;
            seed_multi_file_fixture_whole(&repo, k, committed_delete)?;

            reset_index_entries_call_count();
            let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;

            assert_eq!(mr.anchors.len(), k, "all anchors resolved");
            let expected_status = if committed_delete {
                AnchorStatus::Deleted
            } else {
                AnchorStatus::Changed
            };
            for anchor in &mr.anchors {
                assert_eq!(
                    anchor.status, expected_status,
                    "drifted whole-file anchor {} must classify {expected_status:?}",
                    anchor.anchor_id
                );
            }

            let count = index_entries_call_count();
            assert_eq!(
                count, expected,
                "index_entries called {count} times for K={k} \
                 (committed_delete={committed_delete}) — expected {expected} \
                 (1 span-read conflict probe + 1 session-wide index snapshot). \
                 The whole-file path is re-materializing the index instead of \
                 sharing the session snapshot."
            );
        }
    }
    Ok(())
}

/// Card main-300 whole-file follow-up, invariant 1 (perf-counter surface):
/// a drift run over K worktree-deleted whole-file anchors reports exactly
/// one session index snapshot materialization regardless of K.
#[test]
fn whole_file_session_reports_one_index_snapshot_per_run() -> Result<()> {
    for k in [3usize, 7] {
        let repo = TestRepo::new()?;
        seed_multi_file_fixture_whole(&repo, k, false)?;
        let (stdout, stderr) = run_drift_with_perf(&repo)?;

        for i in 0..k {
            let path = format!("src/file{i:02}.txt");
            assert!(
                stdout.contains(&path),
                "anchor on {path} must render a drift row; stdout=\n{stdout}\nstderr=\n{stderr}"
            );
        }

        let loads = parse_counter(&stderr, "session.index-snapshot-loads");
        assert_eq!(
            loads, 1,
            "session.index-snapshot-loads must be 1 per run (K={k}) — got \
             {loads}; the whole-file path is rematerializing the index.\nstderr=\n{stderr}"
        );
    }
    Ok(())
}
