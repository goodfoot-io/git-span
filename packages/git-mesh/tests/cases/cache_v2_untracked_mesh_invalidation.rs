//! Regression: `git mesh stale` served deleted meshes from the
//! file-backed `cache_v2` baseline because the baseline was enumerated
//! from the raw worktree filesystem (untracked + gitignored mesh files
//! included) while the cache key (`mesh_tree_key` = HEAD tree of the
//! mesh root) and dirty detection (`git status -uno`, which skips
//! untracked and ignored paths) only observed git-tracked state.
//!
//! A mesh file living only in the worktree — e.g. a `.mesh/.../build`
//! file matched by a `.gitignore` `build` pattern — was baked into the
//! committed baseline on the cold build, but deleting it changed
//! neither the HEAD tree (it was never committed) nor `git status`
//! (it is ignored). The warm-clean path then replayed the pre-deletion
//! baseline, listing the deleted mesh and exiting non-zero — a CI
//! false positive with no cache-bypass flag.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// A gitignored mesh file reported as stale must disappear from
/// `git mesh stale` (and stop forcing a non-zero exit) once it is
/// deleted from the worktree — without manually clearing the cache.
#[test]
fn deleted_gitignored_mesh_is_not_served_from_cache() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;

    // `build` ignores every file named `build` anywhere in the tree,
    // including the mesh file `.mesh/bld/build` created below.
    repo.write_file(".gitignore", "build\n")?;
    repo.commit_all("gitignore build")?;

    // Create a gitignored mesh (never tracked) anchored to charge.ts.
    repo.run_mesh(["add", "bld/build", "api/charge.ts#L1-L3"])?;
    repo.run_mesh(["why", "bld/build", "-m", "ignored build mesh"])?;
    assert!(
        repo.path().join(".mesh/bld/build").exists(),
        "precondition: the gitignored mesh file exists on disk"
    );

    // Drift the anchored content at HEAD so the mesh is `changed`.
    repo.write_file("api/charge.ts", "A\nB\nC\nd\ne\n")?;
    repo.commit_all("edit charge")?;
    repo.write_commit_graph()?;

    // Cold build: the baseline is populated and the mesh is reported.
    let first = repo.run_mesh(["stale"])?;
    let first_out = String::from_utf8_lossy(&first.stdout);
    assert!(
        first_out.contains("bld/build"),
        "precondition: stale reports the drifting gitignored mesh; got:\n{first_out}"
    );
    assert_eq!(
        first.status.code(),
        Some(1),
        "precondition: stale exits non-zero when a mesh is stale"
    );

    // Delete the gitignored mesh file from the worktree.
    std::fs::remove_file(repo.path().join(".mesh/bld/build"))?;

    // Second run: the mesh is gone, so stale must neither list it nor
    // exit non-zero. Before the fix the warm-clean cache replayed the
    // pre-deletion baseline.
    let second = repo.run_mesh(["stale"])?;
    let second_out = String::from_utf8_lossy(&second.stdout);
    assert!(
        !second_out.contains("bld/build"),
        "deleted gitignored mesh must not be served from the stale cache; got:\n{second_out}"
    );
    assert_eq!(
        second.status.code(),
        Some(0),
        "stale must exit 0 after the only stale mesh was deleted; stdout:\n{second_out}\nstderr:\n{}",
        String::from_utf8_lossy(&second.stderr)
    );
    Ok(())
}

/// The same cache gap applies to any untracked mesh file — `git status
/// -uno` reports neither untracked nor gitignored paths — so an
/// uncommitted (but not ignored) mesh must also be surfaced while it
/// exists and dropped once deleted, without a manual cache clear.
#[test]
fn deleted_untracked_mesh_is_not_served_from_cache() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;

    // Untracked mesh file (never `git add`ed), anchored to charge.ts.
    repo.run_mesh(["add", "untracked", "api/charge.ts#L1-L3"])?;
    repo.run_mesh(["why", "untracked", "-m", "untracked mesh"])?;

    // Drift the anchored content at HEAD so the mesh is `changed`.
    repo.write_file("api/charge.ts", "A\nB\nC\nd\ne\n")?;
    repo.commit_all("edit charge")?;
    repo.write_commit_graph()?;

    // While it exists, the uncommitted mesh is surfaced (via the dirty
    // overlay — it is never part of the HEAD-keyed committed baseline).
    let first = repo.run_mesh(["stale"])?;
    let first_out = String::from_utf8_lossy(&first.stdout);
    assert!(
        first_out.contains("## untracked"),
        "an uncommitted mesh must still be reported as stale; got:\n{first_out}"
    );

    std::fs::remove_file(repo.path().join(".mesh/untracked"))?;

    let second = repo.run_mesh(["stale"])?;
    let second_out = String::from_utf8_lossy(&second.stdout);
    assert!(
        !second_out.contains("untracked"),
        "deleted untracked mesh must not be served from the stale cache; got:\n{second_out}"
    );
    assert_eq!(
        second.status.code(),
        Some(0),
        "stale must exit 0 after the deleted untracked mesh; stdout:\n{second_out}"
    );
    Ok(())
}
