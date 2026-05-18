//! Regression: `git mesh add` / `git mesh commit` must emit a structured error when a
//! mesh name collides with an existing mesh on the worktree file vs.
//! directory boundary (card `main-57`).
//!
//! With file-backed mesh storage, the `.mesh/` directory cannot hold both a
//! regular file and a directory at the same path component.  A committed mesh
//! `wiki/architecture/compact-view` writes a regular file at `.mesh/wiki/architecture/compact-view`.
//! A later `add` for `wiki/architecture/compact-view/state-machine` would need
//! `.mesh/wiki/architecture/compact-view/` to be a directory, which the
//! filesystem rejects.  The library must detect this before any file write
//! and surface a typed error naming both meshes.

mod support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn cli_commit_emits_typed_error_for_child_under_committed_leaf() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Commit a leaf mesh that occupies the worktree path
    // `.mesh/wiki/arch/compact-view`.
    repo.mesh_stdout(["add", "wiki/arch/compact-view", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "wiki/arch/compact-view", "-m", "Leaf seed"])?;
    repo.mesh_stdout(["commit", "wiki/arch/compact-view"])?;

    // Attempt to add a child mesh whose name has the committed leaf as a
    // path prefix.  The `add` command detects this through a worktree prefix
    // collision check before any file write.
    let out = repo.run_mesh([
        "add",
        "wiki/arch/compact-view/state-machine",
        "file2.txt#L1-L4",
    ])?;
    assert!(
        !out.status.success(),
        "expected the colliding add to fail; got success"
    );
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let combined = format!("{stdout}\n{stderr}");

    // The error must name BOTH the staged child and the blocking parent so a
    // user reading it knows what to do.
    assert!(
        combined.contains("wiki/arch/compact-view/state-machine"),
        "error did not mention the staged child name: {combined}"
    );
    assert!(
        combined.contains("wiki/arch/compact-view"),
        "error did not mention the blocking committed mesh: {combined}"
    );
    // The error must NOT be a raw OS error.
    assert!(
        !combined.contains("os error"),
        "expected structured error, got a raw OS error: {combined}"
    );
    assert!(
        !combined.contains("File exists"),
        "expected structured error, got a raw OS error: {combined}"
    );
    assert!(
        !combined.contains("Is a directory"),
        "expected structured error, got a raw OS error: {combined}"
    );
    Ok(())
}

#[test]
fn cli_commit_emits_typed_error_for_parent_over_committed_children() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Commit a child mesh first, which creates `.mesh/wiki/arch/compact-view`.
    repo.mesh_stdout(["add", "wiki/arch/compact-view", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "wiki/arch/compact-view", "-m", "Child seed"])?;
    repo.mesh_stdout(["commit", "wiki/arch/compact-view"])?;

    // Attempt to add a parent-shaped name that would need the same
    // filesystem path as a directory.  The `add` command detects this
    // through a worktree prefix collision check.
    let out = repo.run_mesh(["add", "wiki/arch", "file2.txt#L1-L4"])?;
    assert!(
        !out.status.success(),
        "expected the colliding add to fail; got success"
    );
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let combined = format!("{stdout}\n{stderr}");

    assert!(
        combined.contains("wiki/arch") && combined.contains("wiki/arch/compact-view"),
        "error did not name both staged parent and blocking child: {combined}"
    );
    assert!(
        !combined.contains("os error"),
        "expected structured error, got a raw OS error: {combined}"
    );
    assert!(
        !combined.contains("File exists"),
        "expected structured error, got a raw OS error: {combined}"
    );
    assert!(
        !combined.contains("Is a directory"),
        "expected structured error, got a raw OS error: {combined}"
    );
    Ok(())
}

#[test]
fn cli_commit_batch_does_not_block_unrelated_meshes_on_prefix_collision() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Committed leaf mesh.
    repo.mesh_stdout(["add", "wiki/arch/compact-view", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "wiki/arch/compact-view", "-m", "Leaf"])?;
    repo.mesh_stdout(["commit", "wiki/arch/compact-view"])?;

    // Attempt to add a colliding child — file-backed storage detects the
    // prefix collision at add time and rejects it.  This is expected; the
    // unrelated mesh below is unaffected.
    let _child_out = repo.run_mesh([
        "add",
        "wiki/arch/compact-view/state-machine",
        "file2.txt#L1-L4",
    ])?;

    // Independent mesh that should still commit cleanly.
    repo.mesh_stdout(["add", "unrelated", "file2.txt#L5-L8"])?;
    repo.mesh_stdout(["why", "unrelated", "-m", "Independent"])?;
    repo.mesh_stdout(["commit", "unrelated"])?;

    let names = git_mesh::list_mesh_names(&repo.gix_repo()?)?;
    assert!(
        names.contains(&"unrelated".to_string()),
        "unrelated mesh should have been created despite the collision"
    );
    Ok(())
}
