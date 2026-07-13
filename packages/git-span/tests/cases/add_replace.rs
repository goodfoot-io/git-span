//! Integration tests for `git span add --replace <old-addr>`.
//!
//! The `--replace` flag atomically removes an existing anchor and inserts
//! new anchor(s) in the same write.  The old anchor must exist in the
//! span or the command fails-closed with a clear error and no changes.

use crate::support;

use anyhow::Result;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

/// Replace one anchor with a different line range.
#[test]
fn add_replace_happy_path() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    // Replace the old anchor with a new range.
    let stdout = repo.span_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-span",
        "file1.txt#L2-L3",
    ])?;

    // Output mentions the removal, the addition, and the per-anchor lines.
    assert!(
        stdout.contains("Replaced 1 anchor"),
        "output must mention replacement: {stdout}"
    );
    assert!(
        stdout.contains("Added 1 anchor"),
        "output must mention the addition: {stdout}"
    );
    assert!(
        stdout.contains("- removed via replace:"),
        "output must contain the removal line format; got:\n{stdout}"
    );

    // Verify: old anchor removed, new anchor present.
    let content = std::fs::read_to_string(repo.path().join(".span/test-span"))?;
    assert!(
        !content.contains("file1.txt#L1-L2"),
        "old anchor should be removed; span:\n{content}"
    );
    assert!(
        content.contains("file1.txt#L2-L3"),
        "new anchor should be present; span:\n{content}"
    );
    Ok(())
}

/// Replace one anchor with a whole-file anchor.
#[test]
fn add_replace_with_whole_file_anchor() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    repo.span_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-span",
        "file1.txt",
    ])?;

    let content = std::fs::read_to_string(repo.path().join(".span/test-span"))?;
    assert!(
        !content.contains("file1.txt#L1-L2"),
        "old line-anchor should be removed; span:\n{content}"
    );
    assert!(
        content.contains("file1.txt rk64:") || content.contains("file1.txt\n"),
        "whole-file anchor should be present; span:\n{content}"
    );
    Ok(())
}

/// Replace a whole-file anchor with another whole-file anchor on the
/// same file. Exercises the `(path, 0, 0)` key comparison path.
#[test]
fn add_replace_whole_file_to_whole_file() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    // First add a whole-file anchor.
    repo.span_stdout(["add", "test-span", "file1.txt"])?;
    repo.commit_all("add whole-file anchor")?;

    // Replace the whole-file anchor with… itself (different hash if
    // content changed, but here content is the same — exercises the
    // remove path for whole-file keys).
    repo.span_stdout([
        "add",
        "--replace",
        "file1.txt",
        "test-span",
        "file1.txt",
    ])?;

    let content = std::fs::read_to_string(repo.path().join(".span/test-span"))?;
    // The old whole-file anchor for file1.txt should be gone; the new
    // whole-file anchor for file1.txt should be present. There should
    // only be one entry for file1.txt.
    let file1_count = content
        .lines()
        .filter(|l| l.starts_with("file1.txt") && !l.contains('#'))
        .count();
    assert_eq!(
        file1_count, 1,
        "exactly one whole-file anchor for file1.txt expected; span:\n{content}"
    );
    Ok(())
}

/// Replace a whole-file anchor with a line-range anchor on the same file.
#[test]
fn add_replace_whole_file_to_line_range() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    // First add a whole-file anchor.
    repo.span_stdout(["add", "test-span", "file1.txt"])?;
    repo.commit_all("add whole-file anchor")?;

    // Replace the whole-file anchor with a line-range anchor.
    repo.span_stdout([
        "add",
        "--replace",
        "file1.txt",
        "test-span",
        "file1.txt#L1-L3",
    ])?;

    let content = std::fs::read_to_string(repo.path().join(".span/test-span"))?;
    // Old whole-file anchor removed.
    assert!(
        !content.contains("file1.txt rk64:"),
        "old whole-file anchor should be removed; span:\n{content}"
    );
    // New line-range anchor present.
    assert!(
        content.contains("file1.txt#L1-L3"),
        "new line-range anchor should be present; span:\n{content}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

/// `--replace` with an anchor that does not exist in the span must fail
/// with a clear error and leave the span unchanged.
#[test]
fn add_replace_fails_when_old_anchor_missing() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    // The span has `file1.txt#L1-L2`; try to replace a non-existent anchor.
    let out = repo.run_span([
        "add",
        "--replace",
        "file1.txt#L9-L10",
        "test-span",
        "file1.txt#L2-L3",
    ])?;
    assert!(
        !out.status.success(),
        "replace with missing old anchor must fail; got exit {:?}",
        out.status.code()
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("is not an anchor on"),
        "stderr must name the missing anchor; got:\n{stderr}"
    );

    // Span content must be unchanged (no partial state).
    let content = std::fs::read_to_string(repo.path().join(".span/test-span"))?;
    assert!(
        content.contains("file1.txt#L1-L2"),
        "original anchor must survive; span:\n{content}"
    );
    assert!(
        !content.contains("file1.txt#L2-L3"),
        "new anchor must not appear after failed replace; span:\n{content}"
    );
    Ok(())
}

/// `--replace` against a span that does not exist at all must fail.
#[test]
fn add_replace_fails_on_nonexistent_span() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    let out = repo.run_span([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "nonexistent-span",
        "file1.txt#L2-L3",
    ])?;
    assert!(
        !out.status.success(),
        "replace on nonexistent span must fail; got exit {:?}",
        out.status.code()
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("is not an anchor on"),
        "stderr must indicate the missing anchor; got:\n{stderr}"
    );
    Ok(())
}

/// `--replace` with a syntactically invalid old-address must fail with a
/// parse error before touching any state.
#[test]
fn add_replace_fails_on_invalid_old_address() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    let out = repo.run_span([
        "add",
        "--replace",
        "#L1-L2",
        "test-span",
        "file1.txt#L2-L3",
    ])?;
    assert!(
        !out.status.success(),
        "replace with invalid address must fail; got exit {:?}",
        out.status.code()
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("is not a valid anchor"),
        "stderr must mention invalid address; got:\n{stderr}"
    );
    // The remediation steps must mention `--replace` so the user is
    // guided back to the correct command — not a plain `add` that would
    // silently append instead of replace.
    assert!(
        stderr.contains("--replace"),
        "stderr next_steps must mention --replace; got:\n{stderr}"
    );

    // Span unchanged.
    let content = std::fs::read_to_string(repo.path().join(".span/test-span"))?;
    assert!(
        content.contains("file1.txt#L1-L2"),
        "span must be unchanged after invalid replace; span:\n{content}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Atomicity: inode changes after replace (Unix only)
// ---------------------------------------------------------------------------

/// Verify that `--replace` goes through the atomic rename path by
/// checking that the span file's inode changes after a replace.
/// Unix-only — Windows has no inodes; the `write_worktree_span` unit
/// test in commit.rs already covers atomicity for all platforms.
#[test]
#[cfg(unix)]
fn add_replace_is_atomic() -> Result<()> {
    let repo = seeded_repo_with_span()?;

    let span_path = repo.path().join(".span/test-span");
    let ino_before =
        support::inode(&span_path).expect("span file must exist and metadata must be readable");

    repo.span_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-span",
        "file1.txt#L2-L3",
    ])?;

    let ino_after =
        support::inode(&span_path).expect("span file must exist after --replace");

    assert_ne!(
        ino_before, ino_after,
        "span file inode must change after --replace (atomic rename path); \
         same inode suggests a non-atomic in-place write"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a repo with a single span `test-span` anchored at
/// `file1.txt#L1-L2` and `file2.txt#L1-L2`.
fn seeded_repo_with_span() -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;

    // Add two anchors so we have a span to work with.
    repo.span_stdout(["add", "test-span", "file1.txt#L1-L2", "file2.txt#L1-L2"])?;

    // Commit the span so it's tracked (matches real usage).
    repo.commit_all("seed test-span")?;

    Ok(repo)
}
