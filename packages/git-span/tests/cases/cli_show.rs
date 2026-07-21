//! CLI: `git span`, `git span <name>` (show), `git span list`.
//!
//! File-backed model: `git span add` writes the `.span/<name>` worktree
//! file directly (no staging, no `git span commit`). `show` emits TOML
//! with empty commit-metadata placeholders; the removed `--log`,
//! `--limit`, and `--format` flags no longer exist, so their suites are
//! deleted with this rewrite. `--oneline` and `--at <commit-ish>`
//! survive.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a span via the file-backed CLI and commit the `.span` file so
/// `--at` history walks have something to resolve.
fn seed(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", name, "-m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", &format!("span {name}")])?;
    Ok(())
}

#[test]
fn bare_span_prints_help() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "alpha")?;
    seed(&repo, "beta")?;
    let out = repo.span_stdout::<[&str; 0], &str>([])?;
    assert!(
        out.contains("Usage:"),
        "expected Usage: in bare output, got: {out}"
    );
    Ok(())
}

#[test]
fn show_by_name_has_required_lines() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "alpha")?;
    let out = repo.span_stdout(["alpha"])?;
    assert!(out.starts_with("name = \"alpha\"\n"), "out={out}");
    assert!(out.contains("path = \"file1.txt\""), "out={out}");
    assert!(out.contains("why = \"seed\""), "out={out}");
    assert!(out.contains("[config]"), "out={out}");
    assert!(
        out.contains("copy_detection = \"same-commit\""),
        "out={out}"
    );
    assert!(!out.contains("### Commit"), "out={out}");
    Ok(())
}



#[test]
fn show_missing_span_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["ghost"])?;
    assert!(!out.status.success());
    Ok(())
}


#[test]
fn ls_all_lists_every_file_with_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.span_stdout(["list"])?;
    assert!(out.contains("## m"), "expected span `m` in list: {out}");
    assert!(
        out.contains("- file1.txt#L1-L5"),
        "expected anchor bullet: {out}"
    );
    Ok(())
}

#[test]
fn ls_by_path_filters() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.span_stdout(["list", "file1.txt"])?;
    assert!(out.contains("## m"), "expected span `m`: {out}");
    Ok(())
}

#[test]
fn ls_by_path_range_filters() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.span_stdout(["list", "file1.txt#L1-L3"])?;
    assert!(out.contains("## m"), "expected span `m`: {out}");
    Ok(())
}
