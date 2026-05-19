//! Integration tests for the surviving Slice 5/6 behavior under the
//! file-backed model.
//!
//! In the file-backed model anchors carry no `anchor_sha` (commit-time
//! anchoring is gone), so the `--since` *filter* is a documented no-op:
//! the engine includes every anchor regardless of `since`. The deleted
//! suites here exercised commit-time `--since` filtering, staged-anchor
//! `--at` ordering, and catalog-ref reflog coverage — all removed
//! features. What survives is content-blind binary detection on
//! `git mesh add` and the no-op `--since` contract.

mod support;

use anyhow::Result;
use git_mesh::types::EngineOptions;
use git_mesh::resolve_mesh;
use std::str::FromStr;
use support::{create_and_commit_mesh, TestRepo};

// ---------------------------------------------------------------------------
// Slice 5 — `--since` is a no-op in the file-backed model.
// ---------------------------------------------------------------------------

#[test]
fn since_does_not_filter_file_backed_anchors() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.txt", "alpha\n")?;
    let seed = repo.commit_all("seed")?;
    repo.write_file("a.txt", "beta\n")?;
    let later = repo.commit_all("later")?;

    let gix = repo.gix_repo()?;
    create_and_commit_mesh(&gix, "m", &[("a.txt", 1, 1)], "x")?;
    repo.write_commit_graph()?;

    // Both an early and a late `since` keep the anchor: file-backed
    // anchors have no anchor_sha, so the filter cannot exclude them.
    for cutoff in [&seed, &later] {
        let opts = EngineOptions {
            since: Some(gix::ObjectId::from_str(cutoff)?),
            ..EngineOptions::full()
        };
        let mr = resolve_mesh(&gix, ".mesh", "m", opts)?;
        assert_eq!(
            mr.anchors.len(),
            1,
            "since={cutoff} must not filter file-backed anchors"
        );
    }
    Ok(())
}

#[test]
fn since_bad_ref_errors_cleanly() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["stale", "--since", "definitely-not-a-ref"])?;
    assert!(!out.status.success(), "expected non-zero exit");
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("--since") || err.contains("rev-parse"),
        "stderr should mention --since: {err}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Slice 6b — content-blind binary detection on `git mesh add`.
// ---------------------------------------------------------------------------

#[test]
fn nul_bearing_file_rejects_line_range_add() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("data.bin", "")?;
    std::fs::write(repo.path().join("data.bin"), b"abc\0def\n")?;
    repo.commit_all("seed")?;
    let out = repo.run_mesh(["add", "m", "data.bin#L1-L1"])?;
    assert!(
        !out.status.success(),
        "line-anchor add on NUL file must fail"
    );
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("binary"),
        "expected binary rejection, got: {err}"
    );
    let out2 = repo.run_mesh(["add", "m", "data.bin"])?;
    assert!(
        out2.status.success(),
        "whole-file add should accept NUL content: {}",
        String::from_utf8_lossy(&out2.stderr)
    );
    Ok(())
}

#[test]
fn non_utf8_file_rejects_line_range_add() -> Result<()> {
    let repo = TestRepo::new()?;
    std::fs::write(repo.path().join("image.bin"), b"\x89PNG\r\n\x1a\noldbinary")?;
    repo.run_git(["add", "image.bin"])?;
    repo.run_git(["commit", "-m", "seed"])?;

    let out = repo.run_mesh(["add", "m", "image.bin#L1-L1"])?;
    assert!(
        !out.status.success(),
        "line-anchor add on non-UTF-8 content must fail"
    );
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("binary"),
        "expected binary rejection, got: {err}"
    );

    let whole = repo.run_mesh(["add", "m", "image.bin"])?;
    assert!(
        whole.status.success(),
        "whole-file pin should accept non-UTF-8 content: {}",
        String::from_utf8_lossy(&whole.stderr)
    );
    Ok(())
}
