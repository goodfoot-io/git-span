//! Sibling worktree metadata must not invalidate this worktree's generation.
#![cfg(target_os = "linux")]

use anyhow::{Context, Result};
use std::path::Path;
use std::process::{Command, Output};

fn git(root: &Path, args: &[&str]) -> Result<()> {
    let output = Command::new("git").current_dir(root).args(args).output()?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

fn span(root: &Path, args: &[&str]) -> Result<Output> {
    let output = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(root)
        .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
        .env_remove("GIT_SPAN_CONTEXT_DISABLE_SERVICE")
        .args(args)
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}

fn assert_generation_hit(root: &Path) -> Result<()> {
    let output = span(root, &["--perf", "context", "source", "--format", "json"])?;
    let diagnostics = String::from_utf8(output.stderr)?;
    anyhow::ensure!(
        diagnostics.contains("context.service-generation-hits 1"),
        "sibling metadata invalidated active context generation: {diagnostics}"
    );
    anyhow::ensure!(
        diagnostics.contains("context.service-invalidations 0"),
        "sibling metadata contributed invalidation events: {diagnostics}"
    );
    Ok(())
}

#[test]
fn sibling_metadata_does_not_invalidate_primary_or_linked_worktree() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let primary = temp.path().join("primary");
    std::fs::create_dir(&primary)?;
    git(&primary, &["init", "--initial-branch=main"])?;
    git(&primary, &["config", "user.name", "Test"])?;
    git(&primary, &["config", "user.email", "test@example.com"])?;
    git(&primary, &["config", "commit.gpgsign", "false"])?;
    std::fs::write(primary.join("source"), "content\n")?;
    git(&primary, &["add", "source"])?;
    git(&primary, &["commit", "-m", "source"])?;
    span(&primary, &["add", "test", "source#L1-L1"])?;
    git(&primary, &["add", "."])?;
    git(&primary, &["commit", "-m", "seed"])?;
    let active = temp.path().join("active");
    let sibling = temp.path().join("sibling");
    git(
        &primary,
        &[
            "worktree",
            "add",
            "-b",
            "active",
            active.to_str().context("active path")?,
        ],
    )?;
    git(
        &primary,
        &[
            "worktree",
            "add",
            "-b",
            "sibling",
            sibling.to_str().context("sibling path")?,
        ],
    )?;
    let sibling_metadata = primary.join(".git/worktrees/sibling");
    for root in [&primary, &active] {
        span(root, &["context", "--warm"])?;
        assert_generation_hit(root)?;
        std::fs::write(sibling_metadata.join("index.lock"), "sibling refresh")?;
        assert_generation_hit(root)?;
        std::fs::create_dir_all(sibling_metadata.join("span"))?;
        std::fs::write(sibling_metadata.join("span/journal"), "sibling runtime")?;
        assert_generation_hit(root)?;
        let future = primary.join(".git/worktrees").join(if root == &primary {
            "future-primary"
        } else {
            "future-linked"
        });
        std::fs::create_dir(&future)?;
        std::fs::write(future.join("index.lock"), "new sibling")?;
        assert_generation_hit(root)?;
        std::fs::remove_dir_all(future)?;
        std::fs::remove_file(sibling_metadata.join("index.lock"))?;
    }
    Ok(())
}
