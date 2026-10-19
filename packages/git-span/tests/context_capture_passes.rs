//! Closed context captures resolve once unless newly discovered paths need coverage.
use anyhow::Result;
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
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .args(args)
        .output()?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}

fn fixture() -> Result<tempfile::TempDir> {
    let repo = tempfile::tempdir()?;
    git(repo.path(), &["init", "--initial-branch=main"])?;
    git(repo.path(), &["config", "user.name", "Test"])?;
    git(repo.path(), &["config", "user.email", "test@example.com"])?;
    git(repo.path(), &["config", "commit.gpgsign", "false"])?;
    std::fs::write(repo.path().join("source"), "alpha\nbeta\ngamma\n")?;
    git(repo.path(), &["add", "source"])?;
    git(repo.path(), &["commit", "-m", "seed"])?;
    span(repo.path(), &["add", "test", "source#L1-L2"])?;
    let definition = repo.path().join(".span/test");
    let mut file = git_span::span_file::SpanFile::parse(&std::fs::read_to_string(&definition)?)?;
    file.config.follow_moves = true;
    std::fs::write(definition, file.serialize())?;
    git(repo.path(), &["add", "."])?;
    git(repo.path(), &["commit", "-m", "span"])?;
    Ok(repo)
}

fn query(root: &Path, address: &str, passes: usize) -> Result<serde_json::Value> {
    let output = span(root, &["--perf", "context", address, "--format", "json"])?;
    let diagnostics = String::from_utf8(output.stderr)?;
    assert_eq!(
        diagnostics
            .lines()
            .filter(|line| line.starts_with("git-span perf: resolver.resolve-loaded-spans "))
            .count(),
        passes,
        "unexpected number of actual resolver passes: {diagnostics}"
    );
    Ok(serde_json::from_slice(&output.stdout)?)
}

#[test]
fn unchanged_context_needs_one_resolver_pass() -> Result<()> {
    let repo = fixture()?;
    let document = query(repo.path(), "source", 1)?;
    assert_eq!(
        document["spans"][0]["anchors"][0]["status"]["code"],
        "FRESH"
    );
    Ok(())
}

#[test]
fn relocated_destination_expands_capture_once_unless_already_queried() -> Result<()> {
    let repo = fixture()?;
    git(repo.path(), &["mv", "source", "destination"])?;
    let anchored = query(repo.path(), "source", 2)?;
    assert_eq!(
        anchored["spans"][0]["anchors"][0]["current"]["path"],
        "destination"
    );
    let current = query(repo.path(), "destination", 1)?;
    assert_eq!(
        current["spans"][0]["anchors"][0]["current"]["path"],
        "destination"
    );
    Ok(())
}
