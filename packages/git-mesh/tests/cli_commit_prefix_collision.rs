//! Regression: `git mesh commit` must emit a structured error when a staged
//! mesh name collides with an existing mesh on the loose-ref file vs.
//! directory boundary (card `main-57`).
//!
//! Loose refs live at `refs/meshes/v1/<name>` with `/` becoming a directory
//! separator. A committed mesh `wiki/architecture/compact-view` writes a
//! regular file at that path. A later staged mesh
//! `wiki/architecture/compact-view/state-machine` cannot coexist with that
//! regular file, so the ref write would fail with a low-level
//! "could not be read in full" git error. The library must detect this
//! before any ref write and surface a typed error naming both meshes.

mod support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn cli_commit_emits_typed_error_for_child_under_committed_leaf() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Commit a leaf mesh that occupies the loose-ref path.
    repo.mesh_stdout(["add", "wiki/arch/compact-view", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "wiki/arch/compact-view", "-m", "Leaf seed"])?;
    repo.mesh_stdout(["commit", "wiki/arch/compact-view"])?;

    // Stage a child mesh whose name has the committed leaf as a path prefix.
    repo.mesh_stdout([
        "add",
        "wiki/arch/compact-view/state-machine",
        "file2.txt#L1-L4",
    ])?;
    repo.mesh_stdout([
        "why",
        "wiki/arch/compact-view/state-machine",
        "-m",
        "Child seed",
    ])?;

    let out = repo.run_mesh(["commit", "wiki/arch/compact-view/state-machine"])?;
    assert!(
        !out.status.success(),
        "expected the colliding child commit to fail; got success"
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
    // The error must NOT be the cryptic low-level loose-ref read failure.
    assert!(
        !combined.contains("could not be read in full"),
        "expected structured error, got the raw loose-ref I/O error: {combined}"
    );
    Ok(())
}

#[test]
fn cli_commit_emits_typed_error_for_parent_over_committed_children() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Commit a child mesh first, which creates the directory
    // `refs/meshes/v1/wiki/arch/` (with `compact-view` as a file inside).
    repo.mesh_stdout(["add", "wiki/arch/compact-view", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "wiki/arch/compact-view", "-m", "Child seed"])?;
    repo.mesh_stdout(["commit", "wiki/arch/compact-view"])?;

    // Stage a parent-shaped name that would need the same path as a file.
    repo.mesh_stdout(["add", "wiki/arch", "file2.txt#L1-L4"])?;
    repo.mesh_stdout(["why", "wiki/arch", "-m", "Parent seed"])?;

    let out = repo.run_mesh(["commit", "wiki/arch"])?;
    assert!(
        !out.status.success(),
        "expected the colliding parent commit to fail; got success"
    );
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let combined = format!("{stdout}\n{stderr}");

    assert!(
        combined.contains("wiki/arch") && combined.contains("wiki/arch/compact-view"),
        "error did not name both staged parent and blocking child: {combined}"
    );
    assert!(
        !combined.contains("could not be read in full"),
        "expected structured error, got the raw loose-ref I/O error: {combined}"
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

    // Staged colliding child.
    repo.mesh_stdout([
        "add",
        "wiki/arch/compact-view/state-machine",
        "file2.txt#L1-L4",
    ])?;
    repo.mesh_stdout([
        "why",
        "wiki/arch/compact-view/state-machine",
        "-m",
        "Child",
    ])?;

    // Independent staged mesh that should still commit cleanly.
    repo.mesh_stdout(["add", "unrelated", "file2.txt#L5-L8"])?;
    repo.mesh_stdout(["why", "unrelated", "-m", "Independent"])?;

    // Bare `git mesh commit` (post-commit-hook path). Exits non-zero because
    // one mesh fails, but the unrelated mesh must still get its ref.
    let _ = repo.run_mesh(["commit"])?;
    let names = git_mesh::list_mesh_names(&repo.gix_repo()?)?;
    assert!(
        names.contains(&"unrelated".to_string()),
        "unrelated mesh should have been created despite the collision"
    );
    Ok(())
}
