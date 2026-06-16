//! Regression (F3): the `cache_v2` warm/cold render filled
//! `AnchorResolved.current.blob` for a HEAD-committed CHANGED anchor, while
//! the effective cache-off resolver (`stale_meshes_inner`) leaves it `None`.
//!
//! The warm-clean render used to come from the row-level committed baseline,
//! resolved with `committed_only`. For an anchor whose anchored region was
//! drifted by a COMMIT (so it is `changed` at HEAD), `committed_only` fills
//! `current.blob` with the HEAD blob; the effective resolver does not. Human
//! and porcelain do not emit `current.blob`, so only `--format json`
//! diverged — a fast wrong answer.
//!
//! The fix resolves the warm-clean whole result with the EFFECTIVE layer set
//! (safe on a clean tree, where effective == committed-key content), making
//! the cached render byte-identical to cache-off across Human, JSON, and
//! porcelain.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Seed a mesh anchoring `a.txt#L1-L3`, then drift that region via a COMMIT
/// so the anchor is `changed` at HEAD on a clean tree.
fn seed_committed_changed(repo: &TestRepo) -> Result<()> {
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.commit_all("seed")?;

    repo.run_mesh(["add", "m", "a.txt#L1-L3"])?;
    repo.run_mesh(["why", "m", "-m", "anchor on a"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // Drift the anchored region via a COMMIT: tree stays clean, anchor is
    // `changed` at HEAD.
    repo.write_file("a.txt", "A1\nA2\nA3\na4\na5\n")?;
    repo.commit_all("drift a")?;
    repo.write_commit_graph()?;
    Ok(())
}

fn assert_format_parity(repo: &TestRepo, format: &str) -> Result<()> {
    // Ground truth: cache fully disabled.
    let off = repo.run_mesh_with_env(
        ["stale", "--no-exit-code", "--format", format],
        "GIT_MESH_CACHE_V2",
        "0",
    )?;
    let off_text = stdout(&off);

    // Cold cache build, then warm cache hit. Both byte-identical to off.
    let cold = repo.run_mesh(["stale", "--no-exit-code", "--format", format])?;
    let warm = repo.run_mesh(["stale", "--no-exit-code", "--format", format])?;

    assert_eq!(
        stdout(&cold),
        off_text,
        "[{format}] cold cache-on output diverged from cache-off ground truth"
    );
    assert_eq!(
        stdout(&warm),
        off_text,
        "[{format}] warm cache-on output diverged from cache-off ground truth"
    );
    Ok(())
}

#[test]
fn cache_matches_cache_off_for_committed_changed_anchor_all_formats() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_committed_changed(&repo)?;

    // Sanity: the effective ground truth leaves `current.blob` null for the
    // committed CHANGED anchor — otherwise this test would not exercise F3.
    let off_json = repo.run_mesh_with_env(
        ["stale", "--no-exit-code", "--format", "json"],
        "GIT_MESH_CACHE_V2",
        "0",
    )?;
    let off_json_text = stdout(&off_json);
    assert!(
        off_json_text.contains("\"blob\": null"),
        "ground truth unexpectedly has a non-null current.blob:\n{off_json_text}"
    );

    assert_format_parity(&repo, "json")?;
    assert_format_parity(&repo, "human")?;
    assert_format_parity(&repo, "porcelain")?;
    Ok(())
}
