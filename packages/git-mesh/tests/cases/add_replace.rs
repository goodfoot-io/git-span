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

    // Output mentions both the removal and the addition.
    assert!(
        stdout.contains("Replaced 1 anchor"),
        "output must mention replacement: {stdout}"
    );
    assert!(
        stdout.contains("Added 1 anchor"),
        "output must mention the addition: {stdout}"
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
#[test]
#[cfg(unix)]
fn add_replace_is_atomic() -> Result<()> {
    use std::os::unix::fs::MetadataExt;

    let repo = seeded_repo_with_mesh()?;

    let mesh_path = repo.path().join(".mesh/test-mesh");
    let ino_before = std::fs::metadata(&mesh_path)?.ino();

    repo.mesh_stdout([
        "add",
        "--replace",
        "file1.txt#L1-L2",
        "test-mesh",
        "file1.txt#L2-L3",
    ])?;

    let ino_after = std::fs::metadata(&mesh_path)?.ino();

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
