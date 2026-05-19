//! Reproduction: `git mesh add <child>` after a colliding mesh is renamed
//! in the worktree + index (but not committed).
//!
//! Hypothesis: `MeshFileReader::list_mesh_names` naively unions worktree +
//! HEAD + index names without applying tombstone semantics, so a name that
//! still exists in HEAD but has been deleted in the index/worktree (via a
//! two-step rename) is still reported. `check_worktree_prefix_collision`
//! then sees the stale pre-rename name `a/b` and rejects `git mesh add
//! a/b/c` even though `a/b` no longer exists in the worktree or index.

mod support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn add_child_succeeds_after_uncommitted_two_step_rename_of_blocker() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Commit a blocker mesh `a/b` anchored at a real file.
    repo.mesh_stdout(["add", "a/b", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "a/b", "-m", "blocker mesh that will be renamed away"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh a/b"])?;

    // Two-step rename `a/b` -> `tmp-blocker-hold` -> `a/b/index`. Both
    // moves edit the worktree mesh files and `git mesh` stages them, but
    // we do NOT commit. After this, HEAD still has `a/b`, while the index
    // and worktree have `a/b/index` (a child of `a/b`).
    repo.mesh_stdout(["move", "a/b", "tmp-blocker-hold"])?;
    repo.mesh_stdout(["move", "tmp-blocker-hold", "a/b/index"])?;
    repo.run_git(["add", "-A", ".mesh"])?;

    // Sanity: HEAD still carries the stale `a/b` blob (uncommitted rename).
    let head_tree = repo.git_stdout(["ls-tree", "-r", "--name-only", "HEAD"])?;
    assert!(
        head_tree.contains(".mesh/a/b"),
        "precondition: HEAD must still contain the pre-rename `.mesh/a/b`, got: {head_tree}"
    );

    // Now add a sibling child mesh `a/b/c`. With the rename effective in
    // worktree+index, `a/b` no longer exists as a leaf mesh, so this must
    // succeed. (Current code consults HEAD's stale `a/b` and rejects it.)
    let out = repo.run_mesh(["add", "a/b/c", "file2.txt#L1-L5"])?;

    assert_eq!(
        out.status.code(),
        Some(0),
        "`git mesh add a/b/c` should succeed after the uncommitted rename of `a/b`; \
         stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    Ok(())
}
