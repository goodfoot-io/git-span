//! CLI performance logging opt-in.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn perf_flag_logs_timings_to_stderr_only() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["--perf", "list"])?;

    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    let stderr = String::from_utf8(out.stderr)?;

    assert_eq!(stdout.trim(), "No spans match the filters.");
    assert!(
        stderr.contains("git-span perf: command.list"),
        "expected command timing in stderr, got: {stderr}"
    );
    assert!(
        stderr.contains("git-span perf: git.discover"),
        "expected git discovery timing in stderr, got: {stderr}"
    );
    Ok(())
}

#[test]
fn perf_env_logs_timings_to_stderr_only() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
    let out = cmd
        .current_dir(repo.path())
        .env("GIT_SPAN_PERF", "1")
        .arg("list")
        .output()?;

    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    let stderr = String::from_utf8(out.stderr)?;

    assert_eq!(stdout.trim(), "No spans match the filters.");
    assert!(
        stderr.contains("git-span perf: command.list"),
        "expected command timing in stderr, got: {stderr}"
    );
    Ok(())
}
