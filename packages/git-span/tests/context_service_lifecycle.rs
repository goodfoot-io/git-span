//! Captures remain fresh across startup, rebuild, repair publication, and churn.
#![cfg(target_os = "linux")]

use anyhow::{Context, Result};
use std::path::Path;
use std::process::{Command, Output};
use std::time::{Duration, Instant};

fn span(root: &Path, args: &[&str]) -> Result<Output> {
    Ok(Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(root)
        .args(args)
        .output()?)
}

fn fixture() -> Result<tempfile::TempDir> {
    let temp = tempfile::tempdir()?;
    for args in [
        vec!["init", "--initial-branch=main"],
        vec!["config", "user.name", "Test"],
        vec!["config", "user.email", "test@example.com"],
    ] {
        let output = Command::new("git")
            .current_dir(temp.path())
            .args(args)
            .output()?;
        anyhow::ensure!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    std::fs::write(temp.path().join("file.txt"), "first\nsecond\nthird\n")?;
    for args in [vec!["add", "."], vec!["commit", "-m", "seed"]] {
        anyhow::ensure!(
            Command::new("git")
                .current_dir(temp.path())
                .args(args)
                .output()?
                .status
                .success()
        );
    }
    anyhow::ensure!(
        span(temp.path(), &["add", "served", "file.txt#L1-L2"])?
            .status
            .success()
    );
    Ok(temp)
}

fn wait_ready(hooks: &Path) -> Result<String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Ok(token) =
            std::fs::read_to_string(hooks.join("generation-before-publication.ready"))
        {
            return Ok(token);
        }
        anyhow::ensure!(
            Instant::now() < deadline,
            "generation checkpoint did not become ready"
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn startup_and_rebuild_never_publish_a_capture_changed_before_publication() -> Result<()> {
    for rebuild in [false, true] {
        let temp = fixture()?;
        let root = temp.path();
        let hooks = tempfile::tempdir()?;
        if rebuild {
            let warm = Command::new(env!("CARGO_BIN_EXE_git-span"))
                .current_dir(root)
                .env("GIT_SPAN_CONTEXT_TEST_SERVICE_HOOK_DIR", hooks.path())
                .args(["context", "--warm"])
                .output()?;
            anyhow::ensure!(warm.status.success());
            std::fs::write(root.join("file.txt"), "prefix\nfirst\nsecond\nthird\n")?;
        }
        std::fs::write(
            hooks.path().join("generation-before-publication.arm"),
            b"armed",
        )?;
        let child = Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(root)
            .env("GIT_SPAN_CONTEXT_TEST_SERVICE_HOOK_DIR", hooks.path())
            .args(["context", "file.txt", "--format", "json"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let token = wait_ready(hooks.path())?;
        std::fs::write(
            root.join("file.txt"),
            "new-prefix\nprefix\nfirst\nsecond\nthird\n",
        )?;
        std::fs::write(
            hooks.path().join("generation-before-publication.release"),
            token,
        )?;
        let raced = child.wait_with_output()?;
        anyhow::ensure!(
            raced.status.success(),
            "{}",
            String::from_utf8_lossy(&raced.stderr)
        );
        let direct = Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(root)
            .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
            .args(["context", "file.txt", "--format", "json"])
            .output()?;
        anyhow::ensure!(direct.status.success());
        assert_eq!(raced.stdout, direct.stdout, "rebuild={rebuild}");
        let recovery = span(root, &["context", "file.txt", "--format", "json"])?;
        anyhow::ensure!(recovery.status.success());
        let reused = span(root, &["--perf", "context", "file.txt", "--format", "json"])?;
        anyhow::ensure!(reused.status.success());
        let diagnostics = String::from_utf8(reused.stderr)?;
        assert!(
            diagnostics.contains("context.service-generation-hits 1"),
            "rebuild={rebuild}: {diagnostics}"
        );
    }
    Ok(())
}

#[test]
fn repair_publication_churn_preserves_mutation_receipt_and_replay() -> Result<()> {
    let temp = fixture()?;
    let root = temp.path();
    let hooks = tempfile::tempdir()?;
    let warm = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(root)
        .env("GIT_SPAN_CONTEXT_TEST_SERVICE_HOOK_DIR", hooks.path())
        .args(["context", "--warm"])
        .output()?;
    anyhow::ensure!(warm.status.success());
    std::fs::write(root.join("file.txt"), "prefix\nfirst\nsecond\nthird\n")?;
    std::fs::write(
        hooks.path().join("generation-before-publication.arm"),
        b"armed",
    )?;
    let operation = uuid::Uuid::new_v4().to_string();
    let args = [
        "context",
        "file.txt",
        "--format",
        "json",
        "--fix",
        "--operation-id",
        &operation,
    ];
    let child = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(root)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let token = wait_ready(hooks.path())?;
    std::fs::write(root.join("build-output"), "ordinary build activity")?;
    std::fs::write(
        hooks.path().join("generation-before-publication.release"),
        token,
    )?;
    let fixed = child.wait_with_output()?;
    anyhow::ensure!(
        fixed.status.success(),
        "{}",
        String::from_utf8_lossy(&fixed.stderr)
    );
    let document: serde_json::Value = serde_json::from_slice(&fixed.stdout)?;
    assert_eq!(document["mutation"]["rewritten"], true);
    let replay = span(root, &args)?;
    anyhow::ensure!(replay.status.success());
    assert_eq!(replay.stdout, fixed.stdout);
    let query = span(root, &["context", "file.txt", "--format", "json"])?;
    anyhow::ensure!(query.status.success());
    let query: serde_json::Value =
        serde_json::from_slice(&query.stdout).context("fresh post-repair context")?;
    assert_eq!(query["spans"], document["spans"]);
    Ok(())
}

#[test]
fn continued_build_activity_allows_bounded_context_then_warm_reuse() -> Result<()> {
    let temp = fixture()?;
    let root = temp.path();
    std::fs::create_dir(root.join("build"))?;
    let output = root.join("build/output");
    std::fs::write(&output, "initial")?;
    anyhow::ensure!(span(root, &["context", "--warm"])?.status.success());
    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let writer_running = running.clone();
    let writer = std::thread::spawn(move || -> Result<()> {
        let mut count = 0;
        while writer_running.load(std::sync::atomic::Ordering::Relaxed) {
            std::fs::write(&output, format!("build {count}"))?;
            count += 1;
            std::thread::sleep(Duration::from_millis(2));
        }
        Ok(())
    });
    let result = (|| -> Result<()> {
        for _ in 0..3 {
            let started = Instant::now();
            let query = span(root, &["context", "file.txt", "--format", "json"])?;
            anyhow::ensure!(
                query.status.success(),
                "{}",
                String::from_utf8_lossy(&query.stderr)
            );
            let document: serde_json::Value = serde_json::from_slice(&query.stdout)?;
            assert_eq!(document["spans"][0]["name"], "served");
            assert!(started.elapsed() < Duration::from_secs(4));
        }
        Ok(())
    })();
    running.store(false, std::sync::atomic::Ordering::Relaxed);
    writer.join().expect("build writer panicked")?;
    result?;
    anyhow::ensure!(
        span(root, &["context", "file.txt", "--format", "json"])?
            .status
            .success()
    );
    let reused = span(root, &["--perf", "context", "file.txt", "--format", "json"])?;
    anyhow::ensure!(reused.status.success());
    let diagnostics = String::from_utf8(reused.stderr)?;
    assert!(
        diagnostics.contains("context.service-generation-hits 1"),
        "{diagnostics}"
    );
    Ok(())
}
