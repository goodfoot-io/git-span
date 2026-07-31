//! Unreadable-HEAD reads fail closed with the curated resolver error.
//!
//! main-194 issue R3: a repository whose HEAD objects cannot be read must
//! never classify an anchor as relocated/deleted — `stale` and `history`
//! abort before rendering anything, and the failure prints the shared
//! curated shape (`resolver_read_error`) rather than a raw `error: git: …`
//! line. The fixture corrupts an intermediate tree object in place
//! (truncation), the pattern verified against gix: a damaged tree along the
//! path is a read *error*, while a genuinely absent entry — including a
//! directory demoted to a blob — stays `PathNotInTree`.

use crate::support;
use anyhow::Result;
use support::TestRepo;

/// Build a repo with one whole-file span and one line-range span anchored
/// under `sub/`, delete the worktree copies (forcing HEAD consultation), and
/// truncate `sub/`'s tree object so every HEAD read under it fails.
fn corrupted_head_repo() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    // Loose objects only: a packed tree cannot be truncated individually.
    repo.run_git(["config", "gc.auto", "0"])?;

    repo.write_file("sub/whole.txt", "whole body\nsecond line\n")?;
    repo.write_file("sub/lines.txt", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("seed anchored files")?;

    repo.span_stdout(["add", "whole-span", "sub/whole.txt"])?;
    repo.span_stdout(["why", "whole-span", "whole-file extent under corruption"])?;
    repo.span_stdout(["add", "range-span", "sub/lines.txt#L1-L3"])?;
    repo.span_stdout(["why", "range-span", "line-range extent under corruption"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare spans"])?;

    // Remove the worktree copies so resolution must read the anchored
    // content back out of HEAD instead of the (deleted) files.
    std::fs::remove_file(repo.path().join("sub/whole.txt"))?;
    std::fs::remove_file(repo.path().join("sub/lines.txt"))?;

    // Truncate `sub/`'s tree object in place. Every path lookup under
    // `sub/` now fails at the object store, while the root tree still
    // resolves — the exact "unreadable, not absent" boundary R3 draws.
    let tree_oid = repo.git_stdout(["rev-parse", "HEAD:sub"])?;
    let tree_oid = tree_oid.trim();
    let tree_path = repo
        .path()
        .join(".git")
        .join("objects")
        .join(&tree_oid[..2])
        .join(&tree_oid[2..]);
    assert!(
        tree_path.exists(),
        "tree {tree_oid} should be a loose object at {tree_path:?}"
    );
    // Loose objects are written read-only; lift that before truncating.
    let mut perms = std::fs::metadata(&tree_path)?.permissions();
    perms.set_readonly(false);
    std::fs::set_permissions(&tree_path, perms)?;
    std::fs::write(&tree_path, b"garbage")?;

    Ok(repo)
}

/// Assert the curated resolver-read failure: non-zero exit, empty stdout,
/// and the shared `resolver_read_error` shape on stderr.
fn assert_curated_read_failure(out: &std::process::Output, subcommand: &str) {
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success(),
        "{subcommand} must fail on an unreadable HEAD; stdout: {stdout}; stderr: {stderr}"
    );
    assert!(
        stdout.is_empty(),
        "{subcommand} must render nothing on an unreadable HEAD; stdout: {stdout}"
    );
    assert!(
        stderr.contains(&format!("git span {subcommand}: span state could not be resolved.")),
        "stderr must carry the curated summary; got: {stderr}"
    );
    assert!(
        stderr.contains("What to do next"),
        "stderr must carry the remediation section; got: {stderr}"
    );
    assert!(
        stderr.contains("git fsck"),
        "stderr must suggest the fsck diagnostic; got: {stderr}"
    );
    assert!(
        !stderr.contains("error: git:"),
        "the raw uncurated shape must not appear; got: {stderr}"
    );
}

#[test]
fn stale_fails_closed_on_unreadable_head_for_both_extents() -> Result<()> {
    let repo = corrupted_head_repo()?;

    // Scoped per span so each extent independently exercises the boundary:
    // neither the whole-file nor the line-range resolver path may classify
    // (relocated/deleted) what it cannot read.
    for span in ["whole-span", "range-span"] {
        let out = repo.run_span(["stale", span])?;
        assert_curated_read_failure(&out, "stale");
    }

    // The unscoped scan shares the same fail-closed boundary.
    let out = repo.run_span(["stale"])?;
    assert_curated_read_failure(&out, "stale");
    Ok(())
}

#[test]
fn history_fails_closed_on_unreadable_head_for_both_extents() -> Result<()> {
    let repo = corrupted_head_repo()?;

    // `history` renders its timeline only after the `current` block resolves
    // through the same engine `stale` uses, so an unreadable HEAD aborts the
    // whole command with the identical curated shape — no partial timeline.
    for span in ["whole-span", "range-span"] {
        let out = repo.run_span(["history", span])?;
        assert_curated_read_failure(&out, "history");
    }
    Ok(())
}
