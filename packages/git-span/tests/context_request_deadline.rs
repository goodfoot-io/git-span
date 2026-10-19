//! Context must report a precise deadline failure before the hook kills it.
#![cfg(target_os = "linux")]

use anyhow::Result;
use fs4::fs_std::FileExt;
use std::process::Command;
use std::time::{Duration, Instant};

fn contended_context(repair: bool) -> Result<()> {
    let temp = tempfile::tempdir()?;
    let repo = gix::init(temp.path())?;
    std::fs::create_dir(temp.path().join(".span"))?;
    std::fs::create_dir(repo.git_dir().join("span"))?;
    let held = std::fs::File::create(repo.git_dir().join("span/recovery-domain.lock"))?;
    held.lock_exclusive()?;
    let operation = "17da6120-cc9b-40ac-adb5-79ce575b8c80";
    let mut command = Command::new(env!("CARGO_BIN_EXE_git-span"));
    command.current_dir(temp.path())
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .env("GIT_SPAN_LOCK_WAIT_SECS", "6")
        .args(["context", "file.txt", "--format", "json"]);
    if repair {
        command.args(["--fix", "--operation-id", operation]);
    }
    let started = Instant::now();
    let output = command.output()?;
    let elapsed = started.elapsed();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(elapsed < Duration::from_millis(4900), "context exceeded hook deadline: {elapsed:?}");
    let diagnostic = String::from_utf8(output.stderr)?;
    assert!(diagnostic.contains("context request deadline exceeded"), "{diagnostic}");
    if repair {
        assert!(diagnostic.contains(operation), "{diagnostic}");
        assert!(diagnostic.contains("mutation outcome unknown"), "{diagnostic}");
    }
    Ok(())
}

#[test]
fn contended_direct_context_reports_deadline_before_hook_timeout() -> Result<()> {
    contended_context(false)
}

#[test]
fn contended_repair_deadline_preserves_retry_identity() -> Result<()> {
    contended_context(true)
}
