//! Regression (originally a `cache_v2` bug, guards the new store): the warm
//! render of a partially-drifted span must keep its fresh anchors.
//!
//! For a span with some drifted and some fresh anchors, `git span stale`
//! renders the drifted anchors as findings and the fresh siblings as bare
//! bullets. The deleted `cache_v2` persisted only the non-`Fresh` finding rows
//! and, on the warm path, skipped the fresh-anchor backfill when a whole result
//! was present, so the fresh siblings vanished from cached output while the
//! cache-off path still listed them.
//!
//! The new store must produce output byte-identical to the `GIT_SPAN_CACHE=0`
//! cache-off ground truth for clean, fully-drifted, and partially-drifted
//! spans alike.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a single span with three anchors across three files, then drift
/// exactly one of them so the span is partially drifted (one `changed`
/// anchor, two `fresh` siblings).
fn seed_partial_drift(repo: &TestRepo) -> Result<()> {
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("b.txt", "b1\nb2\nb3\nb4\nb5\n")?;
    repo.write_file("c.txt", "c1\nc2\nc3\nc4\nc5\n")?;
    repo.commit_all("seed")?;

    repo.run_span(["add", "m", "a.txt#L1-L3", "b.txt#L1-L3", "c.txt#L1-L3"])?;
    repo.run_span(["why", "m", "spans three files"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Drift only b.txt's anchored region; a.txt and c.txt stay fresh.
    repo.write_file("b.txt", "B1\nB2\nB3\nb4\nb5\n")?;
    repo.commit_all("drift b")?;
    repo.write_commit_graph()?;
    Ok(())
}

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[test]
fn cache_matches_cache_off_for_partial_drift() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_partial_drift(&repo)?;

    // Ground truth: cache fully disabled.
    let off = repo.run_span_with_env(["stale", "--no-exit-code"], "GIT_SPAN_CACHE", "0")?;
    let off_text = stdout(&off);

    // Sanity: the partially-drifted span shows the drifted anchor *and*
    // both fresh siblings — otherwise this test would not exercise the bug.
    assert!(
        off_text.contains("b.txt#L1-L3"),
        "ground truth missing drifted anchor:\n{off_text}"
    );
    assert!(
        off_text.contains("a.txt#L1-L3") && off_text.contains("c.txt#L1-L3"),
        "ground truth missing fresh sibling anchors:\n{off_text}"
    );

    // Cold cache build, then warm cache hit. Both must be byte-identical
    // to the ground truth.
    let cold = repo.run_span(["stale", "--no-exit-code"])?;
    let warm = repo.run_span(["stale", "--no-exit-code"])?;

    assert_eq!(
        stdout(&cold),
        off_text,
        "cold cache-on output diverged from cache-off ground truth"
    );
    assert_eq!(
        stdout(&warm),
        off_text,
        "warm cache-on output diverged from cache-off ground truth"
    );
    Ok(())
}
