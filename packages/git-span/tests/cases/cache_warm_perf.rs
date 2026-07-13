//! Minimal smoke test for the stale-span caching path.  The authoritative
//! performance measurement lives in the `stale_warm` criterion benchmark;
//! this test merely confirms that `git span stale` runs without crashing
//! when the cache is enabled.
//!
//! The test creates a small repository (2 files, 1 span, 2 commits),
//! runs `git span stale` once with the cache enabled, and asserts that
//! the command exits successfully.

use std::fs;
use std::path::Path;
use std::process::Command;

const GIT_SPAN_BIN: &str = env!("CARGO_BIN_EXE_git-span");

fn run_git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

fn run_span(dir: &Path, args: &[&str]) {
    let out = Command::new(GIT_SPAN_BIN)
        .current_dir(dir)
        .env("GIT_SPAN_CACHE", "1")
        .args(args)
        .output()
        .expect("spawn git-span");
    assert!(
        out.status.success(),
        "git-span {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn stale_warm_smoke() {
    let dir = tempfile::tempdir().expect("tempdir");
    let p = dir.path();

    run_git(p, &["init", "--initial-branch=main"]);
    run_git(p, &["config", "user.name", "Test"]);
    run_git(p, &["config", "user.email", "test@example.com"]);
    run_git(p, &["config", "commit.gpgsign", "false"]);

    // 2 source files.
    fs::write(p.join("a.txt"), "line1\nline2\nline3\n").expect("write");
    fs::write(p.join("b.txt"), "line1\nline2\nline3\n").expect("write");
    run_git(p, &["add", "."]);
    run_git(p, &["commit", "-m", "seed"]);

    // 1 span with 2 anchors.
    run_span(p, &["add", "smoke-span", "a.txt#L1-L3", "b.txt#L1-L3"]);
    run_span(p, &["why", "smoke-span", "-m", "smoke test span"]);
    run_git(p, &["add", ".span/smoke-span"]);
    run_git(p, &["commit", "-m", "span: smoke-span"]);

    // Run stale — assert exit 0 (no crash).
    let out = Command::new(GIT_SPAN_BIN)
        .current_dir(p)
        .env("GIT_SPAN_CACHE", "1")
        .args(["stale"])
        .output()
        .expect("spawn git-span stale");
    assert!(
        out.status.success(),
        "git span stale failed (exit={:?}):\nstderr: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
}
