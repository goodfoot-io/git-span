//! Regression (originally F4, guards the new store): LFS availability must be
//! probed from the actual anchored corpus, not the ROOT `.gitattributes` only.
//!
//! LFS configured via a SUBDIRECTORY `.gitattributes` (or an LFS-pointer blob
//! committed with no root attributes) once left `corpus_has_lfs=false`, so the
//! `git lfs version` availability probe never ran and the availability key bit
//! was pinned — a cached `ContentUnavailable` could survive an LFS install,
//! diverging from the cache-off ground truth. The availability identity now
//! scans the anchored corpus: a `.gitattributes` declaring `filter=lfs` in any
//! ancestor directory of an anchored path, or an anchored file whose committed
//! blob is itself an LFS pointer, forces the probe.
//!
//! This test exercises the subdirectory-`.gitattributes` shape (the case the
//! old root-only check missed) and asserts the new store is byte-identical to
//! the `GIT_SPAN_CACHE=0` cache-off ground truth across all formats.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Seed a span anchoring a file under `sub/`, whose LFS configuration lives in
/// a SUBDIRECTORY `.gitattributes` — there is NO root `.gitattributes`.
fn seed_subdir_lfs_corpus(repo: &TestRepo) -> Result<()> {
    repo.write_file("sub/big.txt", "x1\nx2\nx3\nx4\nx5\n")?;
    // Subdirectory .gitattributes declaring LFS for the anchored file. No root
    // .gitattributes exists, so the old root-only probe would miss this.
    repo.write_file("sub/.gitattributes", "*.txt filter=lfs diff=lfs merge=lfs -text\n")?;
    repo.commit_all("seed")?;

    repo.run_span(["add", "m", "sub/big.txt#L1-L3"])?;
    repo.run_span(["why", "m", "-m", "anchors an LFS-tracked file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Drift the anchored region via a COMMIT so there is a finding to render.
    repo.write_file("sub/big.txt", "X1\nX2\nX3\nx4\nx5\n")?;
    repo.commit_all("drift big")?;
    repo.write_commit_graph()?;
    Ok(())
}

fn assert_format_parity(repo: &TestRepo, format: &str) -> Result<()> {
    let off = repo.run_span_with_env(
        ["stale", "--no-exit-code", "--format", format],
        "GIT_SPAN_CACHE",
        "0",
    )?;
    let off_text = stdout(&off);

    let cold = repo.run_span(["stale", "--no-exit-code", "--format", format])?;
    let warm = repo.run_span(["stale", "--no-exit-code", "--format", format])?;

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
fn cache_matches_cache_off_for_subdir_lfs_shape() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_subdir_lfs_corpus(&repo)?;

    assert_format_parity(&repo, "human")?;
    assert_format_parity(&repo, "json")?;
    assert_format_parity(&repo, "porcelain")?;
    Ok(())
}
