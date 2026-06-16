//! Regression (F2): the `cache_v2` warm-clean render diverged from the
//! effective cache-off resolver for an interior-anchor corpus.
//!
//! When the corpus carries an interior anchor (an anchor whose path is under
//! `mesh_root`), the whole-result store is skipped (fail-closed, so run_stale
//! keeps its interior-anchor scan). The warm-clean render then used to fall
//! back to the row-level committed baseline (`reportable(baseline.meshes)`),
//! resolved with `committed_only`. `committed_only` labels an interior
//! anchor's drift "changed" (HEAD) while the effective resolver labels it
//! "changed in the working tree" — so cache-on diverged from cache-off in
//! Human output for any corpus mixing a normal drifted mesh with an
//! interior-anchor mesh.
//!
//! The fix builds the warm-clean render from the EFFECTIVE resolution even
//! when the whole result is not stored, so the rendered drift labels match
//! cache-off regardless of the interior-anchor store gate. The cache must be
//! byte-identical to the `GIT_MESH_CACHE_V2=0` ground truth.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Seed two meshes: a normal partially-drifted mesh over source files, and a
/// second mesh whose anchor points INSIDE `.mesh/` (an interior anchor).
fn seed_interior_anchor_corpus(repo: &TestRepo) -> Result<()> {
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("b.txt", "b1\nb2\nb3\nb4\nb5\n")?;
    repo.commit_all("seed")?;

    // Normal mesh: two anchors, one will be drifted (partial drift).
    repo.run_mesh(["add", "normal", "a.txt#L1-L3", "b.txt#L1-L3"])?;
    repo.run_mesh(["why", "normal", "-m", "normal partially drifted mesh"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh normal"])?;

    // Interior-anchor mesh: its anchor path is under `.mesh/`, pointing at the
    // committed `normal` mesh file. This trips the whole-result store gate.
    repo.run_mesh(["add", "interior", ".mesh/normal#L1-L2"])?;
    repo.run_mesh(["why", "interior", "-m", "interior anchor watches normal"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh interior"])?;
    repo.write_commit_graph()?;

    // Drift one anchored region of the normal mesh via a COMMIT (clean tree).
    repo.write_file("a.txt", "A1\nA2\nA3\na4\na5\n")?;
    repo.commit_all("drift a")?;
    repo.write_commit_graph()?;
    Ok(())
}

fn assert_format_parity(repo: &TestRepo, format: &str) -> Result<()> {
    let off = repo.run_mesh_with_env(
        ["stale", "--no-exit-code", "--format", format],
        "GIT_MESH_CACHE_V2",
        "0",
    )?;
    let off_text = stdout(&off);

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
fn cache_matches_cache_off_for_interior_anchor_corpus() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_interior_anchor_corpus(&repo)?;

    // Sanity: the ground truth surfaces the drifted normal mesh — otherwise
    // this test would not exercise the render path.
    let off = repo.run_mesh_with_env(["stale", "--no-exit-code"], "GIT_MESH_CACHE_V2", "0")?;
    let off_text = stdout(&off);
    assert!(
        off_text.contains("a.txt#L1-L3"),
        "ground truth missing drifted anchor:\n{off_text}"
    );

    assert_format_parity(&repo, "human")?;
    assert_format_parity(&repo, "json")?;
    assert_format_parity(&repo, "porcelain")?;
    Ok(())
}
