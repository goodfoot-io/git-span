//! Whole-file pins render as `(whole)` across all renderers, not as
//! `#L0-L0` or raw `0   0`. Regression coverage for the rendering bug
//! called out in `docs/manual-validation-of-git-span-follow-up.md`.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a span containing a whole-file pin on a binary asset and drift
/// the worktree so it shows as CHANGED.
fn seed_whole_file_drift(repo: &TestRepo) -> Result<()> {
    std::fs::write(repo.path().join("hero.png"), [0u8, 1, 2, 3, 4, 5, 6, 7])?;
    repo.commit_all("seed")?;
    let _ = repo.run_span(["add", "m", "hero.png"])?;
    repo.span_stdout(["why", "m", "describes hero"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Drift the worktree.
    std::fs::write(repo.path().join("hero.png"), [9u8, 9, 9, 9])?;
    Ok(())
}

/// Seed a span with a line-anchor pin and drift it (regression guard:
/// line ranges must still render as `#L1-L5`).
fn seed_line_range_drift(repo: &TestRepo) -> Result<()> {
    repo.span_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    Ok(())
}

#[test]
fn whole_pin_human_renders_whole() -> Result<()> {
    // New: whole-file pins render as bare path — no `(whole file)` decoration.
    // The absence of `#L` is the whole-file signal per the unified block spec.
    let repo = TestRepo::seeded()?;
    seed_whole_file_drift(&repo)?;
    let out = repo.run_span(["stale", "m"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("hero.png"),
        "expected `hero.png` bullet, got:\n{text}"
    );
    // No `(whole file)` decoration in the unified block shape.
    assert!(
        !text.contains("(whole file)"),
        "whole file decoration must be absent in unified block, got:\n{text}"
    );
    assert!(
        !text.contains("#L0-L0"),
        "did not expect `#L0-L0` in human output:\n{text}"
    );
    Ok(())
}


#[test]
fn whole_pin_porcelain_uses_whole_marker() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_whole_file_drift(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=porcelain"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("(whole)"),
        "porcelain missing `(whole)`:\n{text}"
    );
    assert!(
        !text.contains("\t0\t0\t"),
        "porcelain should not carry literal `0\\t0\\t` columns for whole pins:\n{text}"
    );
    Ok(())
}



#[test]
fn whole_pin_show_renders_whole() -> Result<()> {
    let repo = TestRepo::seeded()?;
    std::fs::write(repo.path().join("hero.png"), [0u8, 1, 2, 3, 4, 5, 6, 7])?;
    repo.commit_all("seed")?;
    let _ = repo.run_span(["add", "m", "hero.png"])?;
    repo.span_stdout(["why", "m", "describes hero"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    let text = repo.span_stdout(["m"])?;
    assert!(
        text.contains("hero.png"),
        "show output missing `hero.png`:\n{text}"
    );
    assert!(!text.contains("#L0-L0"));
    Ok(())
}

#[test]
fn line_range_pin_still_renders_line_address() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_drift(&repo)?;
    let out = repo.run_span(["stale", "m"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        text.contains("file1.txt#L1-L5"),
        "line-anchor pin must still render `#L1-L5`:\n{text}"
    );
    assert!(!text.contains("(whole)"));
    Ok(())
}
