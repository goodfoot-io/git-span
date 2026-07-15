//! Regression (originally a `cache_v2` bug, guards the new store): a deleted
//! untracked/gitignored span file must not keep being served from the cache.
//!
//! The deleted `cache_v2` baseline was enumerated from the raw worktree
//! filesystem (untracked + gitignored span files included) while its key
//! (`span_tree_key` = HEAD tree of the span root) and dirty detection
//! (`git status -uno`, which skips untracked and ignored paths) only observed
//! git-tracked state. A span file living only in the worktree — e.g. a
//! `.span/.../build` file matched by a `.gitignore` `build` pattern — was baked
//! into the committed baseline on the cold build, but deleting it changed
//! neither the HEAD tree (never committed) nor `git status` (ignored), so the
//! warm-clean path replayed the pre-deletion baseline, listing the deleted span
//! and exiting non-zero — a CI false positive with no cache-bypass flag.
//!
//! These tests run against the new (and only) store to pin that a deleted
//! untracked/gitignored span disappears from `git span stale` without a manual
//! cache clear.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// A gitignored span file reported as stale must disappear from
/// `git span stale` (and stop forcing a non-zero exit) once it is
/// deleted from the worktree — without manually clearing the cache.
#[test]
fn deleted_gitignored_span_is_not_served_from_cache() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;

    // `build` ignores every file named `build` anywhere in the tree,
    // including the span file `.span/bld/build` created below.
    repo.write_file(".gitignore", "build\n")?;
    repo.commit_all("gitignore build")?;

    // Create a gitignored span (never tracked) anchored to charge.ts.
    repo.run_span(["add", "bld/build", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "bld/build", "-m", "ignored build span"])?;
    assert!(
        repo.path().join(".span/bld/build").exists(),
        "precondition: the gitignored span file exists on disk"
    );

    // Drift the anchored content at HEAD so the span is `changed`.
    repo.write_file("api/charge.ts", "A\nB\nC\nd\ne\n")?;
    repo.commit_all("edit charge")?;
    repo.write_commit_graph()?;

    // Cold build: the baseline is populated and the span is reported.
    let first = repo.run_span(["stale"])?;
    let first_out = String::from_utf8_lossy(&first.stdout);
    assert!(
        first_out.contains("bld/build"),
        "precondition: stale reports the drifting gitignored span; got:\n{first_out}"
    );
    assert_eq!(
        first.status.code(),
        Some(1),
        "precondition: stale exits non-zero when a span is stale"
    );

    // Delete the gitignored span file from the worktree.
    std::fs::remove_file(repo.path().join(".span/bld/build"))?;

    // Second run: the span is gone, so stale must neither list it nor
    // exit non-zero. Before the fix the warm-clean cache replayed the
    // pre-deletion baseline.
    let second = repo.run_span(["stale"])?;
    let second_out = String::from_utf8_lossy(&second.stdout);
    assert!(
        !second_out.contains("bld/build"),
        "deleted gitignored span must not be served from the stale cache; got:\n{second_out}"
    );
    assert_eq!(
        second.status.code(),
        Some(0),
        "stale must exit 0 after the only stale span was deleted; stdout:\n{second_out}\nstderr:\n{}",
        String::from_utf8_lossy(&second.stderr)
    );
    Ok(())
}

/// The same cache gap applies to any untracked span file — `git status
/// -uno` reports neither untracked nor gitignored paths — so an
/// uncommitted (but not ignored) span must also be surfaced while it
/// exists and dropped once deleted, without a manual cache clear.
#[test]
fn deleted_untracked_span_is_not_served_from_cache() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;

    // Untracked span file (never `git add`ed), anchored to charge.ts.
    repo.run_span(["add", "untracked", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "untracked", "-m", "untracked span"])?;

    // Drift the anchored content at HEAD so the span is `changed`.
    repo.write_file("api/charge.ts", "A\nB\nC\nd\ne\n")?;
    repo.commit_all("edit charge")?;
    repo.write_commit_graph()?;

    // While it exists, the uncommitted span is surfaced (via the dirty
    // overlay — it is never part of the HEAD-keyed committed baseline).
    let first = repo.run_span(["stale"])?;
    let first_out = String::from_utf8_lossy(&first.stdout);
    assert!(
        first_out.contains("## untracked"),
        "an uncommitted span must still be reported as stale; got:\n{first_out}"
    );

    std::fs::remove_file(repo.path().join(".span/untracked"))?;

    let second = repo.run_span(["stale"])?;
    let second_out = String::from_utf8_lossy(&second.stdout);
    assert!(
        !second_out.contains("untracked"),
        "deleted untracked span must not be served from the stale cache; got:\n{second_out}"
    );
    assert_eq!(
        second.status.code(),
        Some(0),
        "stale must exit 0 after the deleted untracked span; stdout:\n{second_out}"
    );
    Ok(())
}
