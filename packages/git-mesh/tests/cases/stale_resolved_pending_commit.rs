//! Regression test for `AnchorStatus::ResolvedPendingCommit`.
//!
//! Reproduces the Stop-hook incident shape: a mesh that has been
//! re-anchored to match the worktree content but whose source file
//! changes remain uncommitted. The stub detection in Phase 1 returns
//! `ResolvedPendingCommit` for any file-backed anchor with a resolved
//! current position. These tests verify that the contract compiles and
//! the output plumbing is wired correctly.
//!
//! Phase 3 replaces the stub with real worktree-vs-HEAD comparison.
//! When that lands, these tests are un-ignored and the assertions
//! become the definitive regression check.

use crate::support;

use anyhow::Result;
use git_mesh::types::{AnchorStatus, EngineOptions, LayerSet};
use git_mesh::resolve_mesh;
use support::TestRepo;

/// Seed a committed mesh anchoring `file1.txt#L1-L5`, prepend two lines
/// (unstaged), re-anchor to the shifted range `file1.txt#L3-L7`, and
/// stage only the mesh file.
fn reanchor_unstaged_source(repo: &TestRepo) -> Result<()> {
    repo.run_mesh(["add", "m", "file1.txt#L1-L5"])?;
    repo.run_mesh(["why", "m", "-m", "seed"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh m"])?;

    // Prepend two lines. Do NOT stage or commit the source edit.
    repo.write_file(
        "file1.txt",
        "prefix1\nprefix2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    // Re-anchor to the new worktree range and stage only the mesh.
    repo.run_mesh(["remove", "m", "file1.txt#L1-L5"])?;
    repo.run_mesh(["add", "m", "file1.txt#L3-L7"])?;
    repo.run_git(["add", ".mesh"])?;
    Ok(())
}

/// `resolve_mesh` with worktree + index layers reports
/// `ResolvedPendingCommit` for an uncommitted re-anchor.
#[ignore]
#[test]
fn worktree_resolves_resolved_pending_commit() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchor_unstaged_source(&repo)?;
    let mr = resolve_mesh(&repo.gix_repo()?, ".mesh", "m", EngineOptions::full())?;
    assert_eq!(
        mr.anchors[0].status,
        AnchorStatus::ResolvedPendingCommit,
        "expected ResolvedPendingCommit with worktree+index layers; got {:?}",
        mr.anchors[0].status
    );
    Ok(())
}

/// `resolve_mesh` with index + HEAD (no worktree) layers reports
/// `ResolvedPendingCommit`.
#[ignore]
#[test]
fn staged_resolves_resolved_pending_commit() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchor_unstaged_source(&repo)?;
    let staged_opts = EngineOptions {
        layers: LayerSet {
            worktree: false,
            index: true,
            staged_mesh: false,
        },
        ..EngineOptions::full()
    };
    let mr = resolve_mesh(&repo.gix_repo()?, ".mesh", "m", staged_opts)?;
    assert_eq!(
        mr.anchors[0].status,
        AnchorStatus::ResolvedPendingCommit,
        "expected ResolvedPendingCommit with staged layers; got {:?}",
        mr.anchors[0].status
    );
    Ok(())
}

/// `resolve_mesh` with HEAD-only layers reports
/// `ResolvedPendingCommit`.
#[ignore]
#[test]
fn head_resolves_resolved_pending_commit() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchor_unstaged_source(&repo)?;
    let mr = resolve_mesh(
        &repo.gix_repo()?,
        ".mesh",
        "m",
        EngineOptions::committed_only(),
    )?;
    assert_eq!(
        mr.anchors[0].status,
        AnchorStatus::ResolvedPendingCommit,
        "expected ResolvedPendingCommit with HEAD-only layers; got {:?}",
        mr.anchors[0].status
    );
    Ok(())
}

/// `git mesh stale m` exits 0 and prints "resolved, pending commit" in
/// human output.
#[ignore]
#[test]
fn stale_command_exits_zero_with_resolved_pending_commit() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchor_unstaged_source(&repo)?;
    let out = repo.run_mesh(["stale", "m"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "ResolvedPendingCommit must not drive non-zero exit; stdout={stdout}"
    );
    assert!(
        stdout.contains("resolved, pending commit"),
        "human output must contain 'resolved, pending commit'; stdout={stdout}"
    );
    Ok(())
}

/// Repeated `git mesh stale m` without state change is stable (no flip
/// to a different status on re-invocation).
#[ignore]
#[test]
fn repeated_invocation_is_stable() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchor_unstaged_source(&repo)?;
    for _ in 0..3 {
        let out = repo.run_mesh(["stale", "m"])?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "exit code must remain 0 across repeated invocations"
        );
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            stdout.contains("resolved, pending commit"),
            "status must remain 'resolved, pending commit'; stdout={stdout}"
        );
    }
    Ok(())
}
