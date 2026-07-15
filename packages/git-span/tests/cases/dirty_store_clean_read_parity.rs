//! Regression (guards the new store): a whole-result entry must never
//! render phantom anchors on a CLEAN worktree after a dirty cold build.
//!
//! A whole-result entry is keyed by COMMITTED identity, which uncommitted
//! worktree edits to a committed `.span/<name>` file do NOT change. The
//! deleted `cache_v2` derived the entry's content from the worktree-effective
//! corpus, so a cold build performed while a committed span file carried
//! uncommitted worktree edits froze worktree-only anchors into a
//! committed-keyed entry. After the worktree was reverted to clean WITHOUT an
//! intervening commit, the warm-clean path replayed those poisoned worktree
//! anchors — phantom anchors that exist in no commit — diverging from the
//! cache-off ground truth. The new store gates the whole result against
//! uncommitted `.span/` edits (`withhold_whole_result_for_dirty_tree` /
//! `has_uncommitted_span_files`), so the frozen-phantom shape cannot recur.
//!
//! This pins the guarantee: on the dirty-store -> revert-to-clean ->
//! warm-read path, the new store must be byte-identical to the
//! `GIT_SPAN_CACHE=0` cache-off ground truth.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Seed a span `m` with three anchors, drift one anchor's file and commit
/// (tree clean, no cache yet). Returns with a clean worktree at a commit.
fn seed_committed_drift(repo: &TestRepo) -> Result<()> {
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("b.txt", "b1\nb2\nb3\nb4\nb5\n")?;
    repo.write_file("c.txt", "c1\nc2\nc3\nc4\nc5\n")?;
    repo.write_file("d.txt", "d1\nd2\nd3\n")?;
    repo.commit_all("seed")?;

    repo.run_span(["add", "m", "a.txt#L1-L3", "b.txt#L1-L3", "c.txt#L1-L3"])?;
    repo.run_span(["why", "m", "-m", "spans three files"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Drift one anchored region and commit, so the committed corpus has a
    // drifted anchor but a clean tree and no cache yet.
    repo.write_file("b.txt", "B1\nB2\nB3\nb4\nb5\n")?;
    repo.commit_all("drift b")?;
    repo.write_commit_graph()?;
    Ok(())
}

#[test]
fn cache_matches_cache_off_after_dirty_store_then_clean_read() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_committed_drift(&repo)?;

    // Ground truth on the CLEAN committed tree: cache fully disabled.
    let off = repo.run_span_with_env(["stale", "--no-exit-code"], "GIT_SPAN_CACHE", "0")?;
    let off_text = stdout(&off);
    // The committed corpus has no anchor on d.txt — a phantom anchor would
    // show `d.txt`.
    assert!(
        !off_text.contains("d.txt"),
        "ground truth unexpectedly references d.txt:\n{off_text}"
    );

    // Worktree-only edit to the committed `.span/m`: add an anchor on
    // d.txt. The committed key (HEAD span tree) is unchanged; the tree is
    // now dirty.
    repo.run_span(["add", "m", "d.txt#L1-L2"])?;
    assert!(
        repo.path().join(".span/m").exists(),
        "span file missing after add"
    );

    // Cold build with cache ON while the tree is dirty. The run itself
    // correctly takes the warm-dirty path; the danger is what gets STORED
    // into the committed-keyed whole-result entry.
    let _dirty = repo.run_span(["stale", "--no-exit-code"])?;

    // Revert the worktree span to the committed version WITHOUT committing:
    // tree is clean again, committed key unchanged, no cache rebuild.
    repo.run_git(["checkout", "--", ".span"])?;

    // Warm-clean read on the clean tree. Must be byte-identical to the
    // cache-off ground truth — no phantom d.txt anchor.
    let warm = repo.run_span(["stale", "--no-exit-code"])?;
    let warm_text = stdout(&warm);

    assert!(
        !warm_text.contains("d.txt"),
        "warm-clean cache-on output rendered phantom d.txt anchor:\n{warm_text}"
    );
    assert_eq!(
        warm_text, off_text,
        "warm-clean cache-on output diverged from cache-off ground truth"
    );
    Ok(())
}
