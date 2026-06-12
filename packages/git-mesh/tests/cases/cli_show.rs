//! CLI: `git mesh`, `git mesh <name>` (show), `git mesh list`.
//!
//! File-backed model: `git mesh add` writes the `.mesh/<name>` worktree
//! file directly (no staging, no `git mesh commit`). `show` emits TOML
//! with empty commit-metadata placeholders; the removed `--log`,
//! `--limit`, and `--format` flags no longer exist, so their suites are
//! deleted with this rewrite. `--oneline` and `--at <commit-ish>`
//! survive.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a mesh via the file-backed CLI and commit the `.mesh` file so
/// `--at` history walks have something to resolve.
fn seed(repo: &TestRepo, name: &str) -> Result<()> {
    repo.mesh_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", name, "-m", "seed"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", &format!("mesh {name}")])?;
    Ok(())
}

#[test]
fn bare_mesh_prints_help() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "alpha")?;
    seed(&repo, "beta")?;
    let out = repo.mesh_stdout::<[&str; 0], &str>([])?;
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
    let out = repo.mesh_stdout(["alpha"])?;
    assert!(out.starts_with("name = \"alpha\"\n"), "out={out}");
    assert!(out.contains("path = \"file1.txt\""), "out={out}");
    assert!(out.contains("message = \"seed\""), "out={out}");
    assert!(out.contains("[config]"), "out={out}");
    assert!(
        out.contains("copy_detection = \"same-commit\""),
        "out={out}"
    );
    assert!(!out.contains("### Commit"), "out={out}");
    Ok(())
}

#[test]
fn show_oneline_drops_header() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "alpha")?;
    let out = repo.mesh_stdout(["alpha", "--oneline"])?;
    assert!(!out.contains("Author:"));
    assert!(out.contains("file1.txt#L1-L5"));
    Ok(())
}

#[test]
fn show_at_walks_history() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "h")?;
    // Second commit adds a second anchor.
    repo.mesh_stdout(["add", "h", "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "h", "-m", "v2"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh v2"])?;
    let prev = repo.git_stdout(["rev-parse", "HEAD~1"])?;
    let out = repo.mesh_stdout(["h", "--at", &prev])?;
    assert!(out.contains("file1.txt"));
    assert!(!out.contains("file2.txt"));
    Ok(())
}

#[test]
fn show_missing_mesh_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["ghost"])?;
    assert!(!out.status.success());
    Ok(())
}

#[test]
fn show_at_bad_revision_reports_missing_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "alpha")?;
    let out = repo.run_mesh(["alpha", "--at", "does-not-exist"])?;
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("no mesh named `alpha`"), "stderr={stderr}");
    Ok(())
}

#[test]
fn ls_all_lists_every_file_with_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.mesh_stdout(["list"])?;
    assert!(out.contains("## m"), "expected mesh `m` in list: {out}");
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
    let out = repo.mesh_stdout(["list", "file1.txt"])?;
    assert!(out.contains("## m"), "expected mesh `m`: {out}");
    Ok(())
}

#[test]
fn ls_by_path_range_filters() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.mesh_stdout(["list", "file1.txt#L1-L3"])?;
    assert!(out.contains("## m"), "expected mesh `m`: {out}");
    Ok(())
}
