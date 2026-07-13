//! Regression: `git span` operations must work when run from a linked
//! worktree.
//!
//! File-backed model: span state is the tracked `.span/` tree at the
//! worktree's workdir root (not under `.git`). A linked worktree has its
//! own workdir, so `.span/` resolves there. The original bug —
//! traversing into the `.git` *pointer file* — cannot recur, but the
//! regression that span writes/reads must succeed from a linked worktree
//! still holds.

use crate::support;

use anyhow::Result;
use git_span::{list_span_names, read_span};
use std::process::Command;
use support::TestRepo;

/// Create a linked worktree off `repo` at HEAD on a new branch and
/// return the worktree dir (and its owning tempdir, which must outlive
/// the worktree).
fn add_worktree(repo: &TestRepo, name: &str) -> Result<(tempfile::TempDir, std::path::PathBuf)> {
    let owner = tempfile::tempdir()?;
    let wt = owner.path().join("wt");
    repo.run_git(["worktree", "add", "-b", name, wt.to_str().unwrap(), "HEAD"])?;
    Ok((owner, wt))
}

#[test]
fn cli_span_add_works_from_worktree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let (_owner, wt) = add_worktree(&repo, "wt3")?;
    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(&wt)
        .args(["add", "doc/feature", "file1.txt#L1-L5"])
        .output()?;
    assert!(
        out.status.success(),
        "git-span add from worktree failed (code {:?}): stdout={} stderr={}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
    // The `.span/<name>` file is written under the worktree's workdir.
    assert!(
        wt.join(".span").join("doc").join("feature").exists(),
        "span file should be written under the linked worktree"
    );
    Ok(())
}

#[test]
fn span_read_works_from_worktree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let (_owner, wt) = add_worktree(&repo, "wt-read")?;
    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(&wt)
        .args(["add", "m", "file1.txt#L1-L5"])
        .output()?;
    assert!(out.status.success(), "add failed");

    let gix = gix::open(&wt)?;
    let names = list_span_names(&gix)?;
    assert!(names.contains(&"m".to_string()), "names={names:?}");
    let span = read_span(&gix, "m")?;
    assert_eq!(span.anchors.len(), 1);
    assert_eq!(span.anchors[0].1.path, "file1.txt");
    Ok(())
}

#[test]
fn cli_span_remove_works_from_worktree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let (_owner, wt) = add_worktree(&repo, "wt-rm")?;
    let bin = env!("CARGO_BIN_EXE_git-span");
    let add = Command::new(bin)
        .current_dir(&wt)
        .args(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L3"])
        .output()?;
    assert!(add.status.success(), "add failed");
    let rm = Command::new(bin)
        .current_dir(&wt)
        .args(["remove", "m", "file2.txt#L1-L3"])
        .output()?;
    assert!(
        rm.status.success(),
        "remove from worktree failed: {}",
        String::from_utf8_lossy(&rm.stderr)
    );
    let span = read_span(&gix::open(&wt)?, "m")?;
    assert_eq!(span.anchors.len(), 1, "remove should leave one anchor");
    Ok(())
}
