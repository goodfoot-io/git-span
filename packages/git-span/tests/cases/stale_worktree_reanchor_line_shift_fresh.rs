//! Reproduction for main-93-1: a worktree-fresh re-anchored line shift
//! must resolve `Fresh`, not `Moved`.
//!
//! Extends the worktree-fresh-is-terminal principle (main-93, in-place
//! case) to the relocation case. When the source edit that shifts the
//! anchored content to a new range is left UNSTAGED and the span is
//! re-anchored to that new worktree range, the worktree slice at the
//! recorded range hashes to the stored hash, so the anchor is `Fresh`.
//!
//! The committed variant of this already passes
//! (`commit_reanchor_replaces_moved_range_instead_of_adding_duplicate`
//! in `stale_span_integration.rs`). The bug is specific to the
//! index/HEAD copy still holding the content at the old range: the
//! layered hunk walk shifts the recorded range forward through the
//! unstaged worktree diff, double-counting the relocation and driving a
//! false `Moved` verdict against the deeper layer.

use crate::support;

use anyhow::Result;
use git_span::types::{AnchorExtent, AnchorStatus, EngineOptions};
use git_span::{read_span, resolve_span};
use std::io::Write;
use std::process::{Command, Stdio};
use support::TestRepo;

/// Seed a committed span anchoring `file1.txt#L1-L5`, then prepend two
/// lines to the worktree (shifting the anchored content to lines 3-7),
/// leaving that source edit UNSTAGED, and re-anchor the span to the new
/// worktree range, staging only the span.
fn reanchored_unstaged_shift(repo: &TestRepo) -> Result<()> {
    repo.run_span(["add", "m", "file1.txt#L1-L5"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span m"])?;

    // Prepend two lines. Do NOT stage or commit the source edit: the
    // index and HEAD still hold `file1.txt` with the content at lines
    // 1-5, while the worktree holds it at lines 3-7.
    repo.write_file(
        "file1.txt",
        "prefix1\nprefix2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    // Re-anchor to the new worktree range and stage only the span.
    repo.span_stdout(["remove", "m", "file1.txt#L1-L5"])?;
    repo.span_stdout(["add", "m", "file1.txt#L3-L7"])?;
    repo.run_git(["add", ".span"])?;
    Ok(())
}

/// `git-span stale --batch --porcelain` reading `paths` from stdin.
fn run_stale_batch_porcelain(repo: &TestRepo, paths: &[&str]) -> Result<(String, Option<i32>)> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .args(["stale", "--batch", "--porcelain"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    {
        let stdin = child.stdin.as_mut().expect("stdin piped");
        for p in paths {
            writeln!(stdin, "{p}")?;
        }
    }
    let out = child.wait_with_output()?;
    Ok((String::from_utf8(out.stdout)?, out.status.code()))
}

/// The re-anchored anchor is recorded at the worktree range L3-L7.
#[test]
fn reanchor_to_worktree_range_is_recorded() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchored_unstaged_shift(&repo)?;
    let span = read_span(&repo.gix_repo()?, "m")?;
    assert_eq!(span.anchors.len(), 1, "re-anchor must replace old anchor");
    assert_eq!(span.anchors[0].1.path, "file1.txt");
    assert_eq!(
        span.anchors[0].1.extent,
        AnchorExtent::LineRange { start: 3, end: 7 }
    );
    Ok(())
}

/// The default (worktree + index) layer resolution must read `Fresh`:
/// the worktree slice at the recorded L3-L7 hashes to the stored hash.
#[test]
fn worktree_reanchored_line_shift_resolves_fresh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchored_unstaged_shift(&repo)?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let r = &mr.anchors[0];
    assert_eq!(
        r.status,
        AnchorStatus::ResolvedPendingCommit,
        "worktree slice at the recorded range matches the stored hash, \
         and HEAD differs (source has uncommitted changes), so the anchor \
         is ResolvedPendingCommit; got {:?}",
        r.status
    );
    Ok(())
}

/// The default `git span stale` view must omit the span and exit 0.
#[test]
fn worktree_reanchored_line_shift_stale_exits_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchored_unstaged_shift(&repo)?;
    let out = repo.run_span(["stale", "m"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "re-anchored worktree-fresh line shift must not surface as drift; stdout={stdout}"
    );
    assert!(
        !stdout.contains("moved"),
        "no Moved row expected; stdout={stdout}"
    );
    Ok(())
}

/// The porcelain batch path must emit no row for the re-anchored span
/// (ResolvedPendingCommit is a terminal resolved state, not stale).
#[test]
fn worktree_reanchored_line_shift_batch_porcelain_emits_no_row() -> Result<()> {
    let repo = TestRepo::seeded()?;
    reanchored_unstaged_shift(&repo)?;
    let (stdout, code) = run_stale_batch_porcelain(&repo, &["file1.txt"])?;
    assert!(
        !stdout.lines().any(|l| l.starts_with("m\t")),
        "batch porcelain must emit no row for the resolved-pending-commit re-anchor; stdout={stdout}"
    );
    assert_eq!(code, Some(0), "stdout={stdout}");
    Ok(())
}
