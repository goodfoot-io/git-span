//! Integration tests for `git mesh add --replace <old-addr>`.
//!
//! The `--replace` flag atomically removes an existing anchor and inserts
//! new anchor(s) in the same write.  The old anchor must exist in the
//! mesh or the command fails-closed with a clear error and no changes.

use crate::support;

use anyhow::Result;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

/// Replace one anchor with a different line range.
#[test]
fn add_replace_happy_path() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    // Replace the old anchor with a new range.
    let stdout = repo.mesh_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-mesh",
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
    let content = std::fs::read_to_string(repo.path().join(".mesh/test-mesh"))?;
    assert!(
        !content.contains("file1.txt#L1-L2"),
        "old anchor should be removed; mesh:\n{content}"
    );
    assert!(
        content.contains("file1.txt#L2-L3"),
        "new anchor should be present; mesh:\n{content}"
    );
    Ok(())
}

/// Replace one anchor with a whole-file anchor.
#[test]
fn add_replace_with_whole_file_anchor() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    repo.mesh_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-mesh",
        "file1.txt",
    ])?;

    let content = std::fs::read_to_string(repo.path().join(".mesh/test-mesh"))?;
    assert!(
        !content.contains("file1.txt#L1-L2"),
        "old line-anchor should be removed; mesh:\n{content}"
    );
    assert!(
        content.contains("file1.txt rk64:") || content.contains("file1.txt\n"),
        "whole-file anchor should be present; mesh:\n{content}"
    );
    Ok(())
}

/// Replace a whole-file anchor with another whole-file anchor on the
/// same file. Exercises the `(path, 0, 0)` key comparison path.
#[test]
fn add_replace_whole_file_to_whole_file() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    // First add a whole-file anchor.
    repo.mesh_stdout(["add", "test-mesh", "file1.txt"])?;
    repo.commit_all("add whole-file anchor")?;

    // Replace the whole-file anchor with… itself (different hash if
    // content changed, but here content is the same — exercises the
    // remove path for whole-file keys).
    repo.mesh_stdout([
        "add",
        "--replace",
        "file1.txt",
        "test-mesh",
        "file1.txt",
    ])?;

    let content = std::fs::read_to_string(repo.path().join(".mesh/test-mesh"))?;
    // The old whole-file anchor for file1.txt should be gone; the new
    // whole-file anchor for file1.txt should be present. There should
    // only be one entry for file1.txt.
    let file1_count = content
        .lines()
        .filter(|l| l.starts_with("file1.txt") && !l.contains('#'))
        .count();
    assert_eq!(
        file1_count, 1,
        "exactly one whole-file anchor for file1.txt expected; mesh:\n{content}"
    );
    Ok(())
}

/// Replace a whole-file anchor with a line-range anchor on the same file.
#[test]
fn add_replace_whole_file_to_line_range() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    // First add a whole-file anchor.
    repo.mesh_stdout(["add", "test-mesh", "file1.txt"])?;
    repo.commit_all("add whole-file anchor")?;

    // Replace the whole-file anchor with a line-range anchor.
    repo.mesh_stdout([
        "add",
        "--replace",
        "file1.txt",
        "test-mesh",
        "file1.txt#L1-L3",
    ])?;

    let content = std::fs::read_to_string(repo.path().join(".mesh/test-mesh"))?;
    // Old whole-file anchor removed.
    assert!(
        !content.contains("file1.txt rk64:"),
        "old whole-file anchor should be removed; mesh:\n{content}"
    );
    // New line-range anchor present.
    assert!(
        content.contains("file1.txt#L1-L3"),
        "new line-range anchor should be present; mesh:\n{content}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

/// `--replace` with an anchor that does not exist in the mesh must fail
/// with a clear error and leave the mesh unchanged.
#[test]
fn add_replace_fails_when_old_anchor_missing() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    // The mesh has `file1.txt#L1-L2`; try to replace a non-existent anchor.
    let out = repo.run_mesh([
        "add",
        "--replace",
        "file1.txt#L9-L10",
        "test-mesh",
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

    // Mesh content must be unchanged (no partial state).
    let content = std::fs::read_to_string(repo.path().join(".mesh/test-mesh"))?;
    assert!(
        content.contains("file1.txt#L1-L2"),
        "original anchor must survive; mesh:\n{content}"
    );
    assert!(
        !content.contains("file1.txt#L2-L3"),
        "new anchor must not appear after failed replace; mesh:\n{content}"
    );
    Ok(())
}

/// `--replace` against a mesh that does not exist at all must fail.
#[test]
fn add_replace_fails_on_nonexistent_mesh() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    let out = repo.run_mesh([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "nonexistent-mesh",
        "file1.txt#L2-L3",
    ])?;
    assert!(
        !out.status.success(),
        "replace on nonexistent mesh must fail; got exit {:?}",
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
    let repo = seeded_repo_with_mesh()?;

    let out = repo.run_mesh([
        "add",
        "--replace",
        "#L1-L2",
        "test-mesh",
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

    // Mesh unchanged.
    let content = std::fs::read_to_string(repo.path().join(".mesh/test-mesh"))?;
    assert!(
        content.contains("file1.txt#L1-L2"),
        "mesh must be unchanged after invalid replace; mesh:\n{content}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Atomicity: inode changes after replace (Unix only)
// ---------------------------------------------------------------------------

/// Verify that `--replace` goes through the atomic rename path by
/// checking that the mesh file's inode changes after a replace.
/// Unix-only — Windows has no inodes; the `write_worktree_mesh` unit
/// test in commit.rs already covers atomicity for all platforms.
#[test]
#[cfg(unix)]
fn add_replace_is_atomic() -> Result<()> {
    let repo = seeded_repo_with_mesh()?;

    let mesh_path = repo.path().join(".mesh/test-mesh");
    let ino_before =
        support::inode(&mesh_path).expect("mesh file must exist and metadata must be readable");

    repo.mesh_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-mesh",
        "file1.txt#L2-L3",
    ])?;

    let ino_after =
        support::inode(&mesh_path).expect("mesh file must exist after --replace");

    assert_ne!(
        ino_before, ino_after,
        "mesh file inode must change after --replace (atomic rename path); \
         same inode suggests a non-atomic in-place write"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a repo with a single mesh `test-mesh` anchored at
/// `file1.txt#L1-L2` and `file2.txt#L1-L2`.
fn seeded_repo_with_mesh() -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;

    // Add two anchors so we have a mesh to work with.
    repo.mesh_stdout(["add", "test-mesh", "file1.txt#L1-L2", "file2.txt#L1-L2"])?;

    // Commit the mesh so it's tracked (matches real usage).
    repo.commit_all("seed test-mesh")?;

    Ok(repo)
}
