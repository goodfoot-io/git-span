//! The optional context service must leave time for direct work inside a hook.
#![cfg(target_os = "linux")]

use anyhow::{Context, Result};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

fn git(root: &std::path::Path, args: &[&str]) -> Result<()> {
    let output = Command::new("git").current_dir(root).args(args).output()?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

fn context(root: &std::path::Path, repair: bool) -> Result<Output> {
    let mut command = Command::new(env!("CARGO_BIN_EXE_git-span"));
    command
        .current_dir(root)
        .args(["context", "file.txt#L1-L1", "--format", "json"])
        .env("GIT_SPAN_CONTEXT_TEST_WORKER_DELAY_MS", "2000")
        .env_remove("GIT_SPAN_CONTEXT_DISABLE_SERVICE");
    if repair {
        command.args([
            "--fix",
            "--operation-id",
            "6b37f0a2-d62c-4d47-9aa7-427d2d714177",
        ]);
    }
    Ok(command.output()?)
}

#[test]
fn delayed_service_leaves_hook_budget_for_direct_context_and_repair() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let root = temp.path();
    git(root, &["init", "--initial-branch=main"])?;
    git(root, &["config", "user.name", "Context deadline"])?;
    git(root, &["config", "user.email", "context@example.test"])?;
    std::fs::write(root.join("file.txt"), "first\nsecond\n")?;
    git(root, &["add", "file.txt"])?;
    git(root, &["commit", "-m", "seed"])?;
    std::fs::create_dir(root.join(".span"))?;

    for repair in [false, true] {
        let started = Instant::now();
        let output = context(root, repair)?;
        let elapsed = started.elapsed();
        anyhow::ensure!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let document: serde_json::Value = serde_json::from_slice(&output.stdout)
            .context("deadline fallback must produce context JSON")?;
        assert_eq!(document["schema_version"], 1);
        assert!(
            elapsed < Duration::from_millis(1500),
            "service wait consumed the hook's direct-computation reserve (repair={repair}, elapsed={elapsed:?})"
        );
    }
    Ok(())
}
