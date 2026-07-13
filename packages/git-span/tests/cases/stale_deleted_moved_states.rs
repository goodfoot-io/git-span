//! Regression tests for F2/F4/F7 of the tracked-file-storage evaluation.
//!
//! - F2: `git span stale` works on an ordinary repo with no commit-graph.
//! - F4: a removed anchored path/range classifies as `Deleted`; content
//!   relocated verbatim (different path or shifted range) classifies as
//!   `Moved`; both are distinct from `Changed`, across whole-file and
//!   line anchors and the worktree + index layers.
//! - F7: `git span stale --stat` lists only stale anchors and the
//!   heading count/wording matches the listed rows.

use crate::support;

use anyhow::Result;
use git_span::types::{AnchorStatus, EngineOptions};
use git_span::{resolve_span, stale_spans};
use support::TestRepo;

fn full_opts() -> EngineOptions {
    EngineOptions::full()
}

/// F2: a plain `git init` + `git add` + `git commit` repo has no
/// commit-graph. `stale` must still succeed (no plumbing instruction as a
/// fatal error).
#[test]
fn stale_succeeds_without_commit_graph() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "charge", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "charge", "-m", "charge flow"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span charge"])?;

    // No `git commit-graph write` here — ordinary repo state.
    assert!(
        !repo.path().join(".git/objects/info/commit-graph").exists(),
        "test precondition: no commit-graph file"
    );

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "charge", EngineOptions::committed_only())?;
    assert_eq!(resolved.anchors.len(), 1);
    assert_eq!(resolved.anchors[0].status, AnchorStatus::Fresh);

    // Full scan path too (the headline command).
    let _ = stale_spans(&gix, ".span", full_opts())?;

    // And via the CLI binary.
    let out = repo.run_span(vec!["stale"])?;
    assert!(
        out.status.success(),
        "`git span stale` failed on a no-commit-graph repo: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// F4(b): `git rm` (staged, uncommitted) of an anchored whole-file path
/// must read as a deletion ("deleted in the index"), never "changed".
#[test]
fn whole_file_path_removed_reads_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;

    let stale = repo.span_stdout(["stale", "wf", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index") || stale.contains("deleted in the working tree"),
        "git rm of an anchored whole-file path must read as a deletion, \
         not 'changed'; stale=\n{stale}"
    );
    assert!(
        !stale.contains("— changed"),
        "removal must never be labeled 'changed'; stale=\n{stale}"
    );
    Ok(())
}

/// F4(b): committed deletion of an anchored whole-file path → `Deleted`
/// (renders "deleted"; the path no longer resolves at HEAD).
#[test]
fn whole_file_path_committed_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Deleted,
        "committed deletion of an anchored whole-file path must be Deleted"
    );
    Ok(())
}

/// F4(b'): `git rm` (staged, uncommitted) of an anchored line-range path
/// must read as a deletion, never "changed".
#[test]
fn line_range_path_removed_reads_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "lr", "-m", "line range"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span lr"])?;

    repo.run_git(["rm", "api/charge.ts"])?;

    let stale = repo.span_stdout(["stale", "lr", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index") || stale.contains("deleted in the working tree"),
        "git rm of an anchored line-range path must read as a deletion; \
         stale=\n{stale}"
    );
    assert!(
        !stale.contains("— changed"),
        "removal must never be labeled 'changed'; stale=\n{stale}"
    );
    Ok(())
}

/// F4(b'): committed deletion of an anchored line-range path → `Deleted`.
#[test]
fn line_range_path_committed_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "lr", "-m", "line range"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span lr"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "lr", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Deleted,
        "committed deletion of an anchored line-range path must be Deleted"
    );
    Ok(())
}

/// F4(c): verbatim-relocate anchored whole-file content to a new path and
/// delete the original → `Moved` (stored content hash exists at the new
/// path).
#[test]
fn whole_file_content_relocated_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    // Verbatim copy to a new path, remove the original (worktree+index).
    repo.write_file("api/billing.ts", "alpha\nbeta\ngamma\n")?;
    repo.run_git(["add", "api/billing.ts"])?;
    repo.run_git(["rm", "api/charge.ts"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "verbatim-relocated whole-file content must classify as Moved"
    );
    let cur = resolved.anchors[0]
        .current
        .as_ref()
        .expect("Moved carries a current location");
    assert_eq!(cur.path, std::path::PathBuf::from("api/billing.ts"));
    Ok(())
}

/// F4(d): prepend lines so the anchored extent shifts down within the same
/// file → `Moved` (stored content hash found at a shifted range).
#[test]
fn line_range_shifted_extent_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "anchor-a\nanchor-b\nanchor-c\ntail\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "lr", "-m", "line range"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span lr"])?;

    // Prepend two lines: the anchored slice now lives at L3-L5.
    repo.write_file(
        "api/charge.ts",
        "new-1\nnew-2\nanchor-a\nanchor-b\nanchor-c\ntail\n",
    )?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "lr", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "prepended lines shifting the anchored extent must classify as Moved"
    );
    Ok(())
}

/// F4: index-layer relocation. Stage a `git mv` (relocation lives in the
/// index, not yet committed) → `Moved` against the index layer.
#[test]
fn whole_file_relocated_in_index_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "x1\nx2\nx3\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "-m", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    // Staged relocation: removed from the index/worktree at the old path,
    // present verbatim at the new path.
    repo.run_git(["mv", "api/charge.ts", "api/billing.ts"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "staged-relocation verbatim content must classify as Moved"
    );
    Ok(())
}
