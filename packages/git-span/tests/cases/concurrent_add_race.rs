//! Regression test for the read-modify-write race in `run_add`: concurrent
//! `git span add` invocations on the same span must not silently lose
//! anchors.
//!
//! The race window spans `read_worktree_span` -> `write_worktree_span`
//! (anchor processing, content hashing, record management). Two processes
//! calling `git span add` concurrently against the same span name, each
//! adding a different anchor, must not both read the same starting span
//! content and have the slower write silently overwrite the faster.
//!
//! Serialization no longer comes from a per-span lock inside `run_add` —
//! that lock was deleted in favor of the single exclusive repository lock
//! (`<git_dir>/span/recovery-domain.lock`) taken once at CLI dispatch and
//! held for the whole command (`cli/mod.rs` via
//! `recovery_domain::acquire_writer`). This test therefore drives two real
//! `git-span` processes rather than calling `run_add` as a library function
//! in-process: a direct library call bypasses dispatch entirely and would
//! no longer be serialized by anything, which is a different (and
//! uninteresting) way to observe lost work than the one this test targets —
//! two independent operators racing the CLI.
//!
//! Test strategy:
//! 1. Seed a span with one anchor so it exists on disk and is committed.
//! 2. Launch two `git span add` child processes concurrently, each adding
//!    a different second anchor.
//! 3. After both processes complete, read the span back and assert all
//!    three anchors are present.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn concurrent_add_race_loses_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Seed the span with a first anchor so the .span/<name> file exists
    // on disk before either worker process tries to read it.
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;

    // Worker 1: adds file1.txt#L6-L10 to the same span.
    let path1 = repo.path().to_path_buf();
    let t1 = std::thread::spawn(move || -> Result<std::process::Output> {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
        cmd.current_dir(&path1);
        cmd.args(["add", "test/race", "file1.txt#L6-L10"]);
        Ok(cmd.output()?)
    });

    // Worker 2: adds file2.txt#L1-L5 to the same span.
    let path2 = repo.path().to_path_buf();
    let t2 = std::thread::spawn(move || -> Result<std::process::Output> {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
        cmd.current_dir(&path2);
        cmd.args(["add", "test/race", "file2.txt#L1-L5"]);
        Ok(cmd.output()?)
    });

    // Wait for both workers to complete.
    let r1 = t1.join().unwrap()?;
    let r2 = t2.join().unwrap()?;

    assert!(
        r1.status.success(),
        "worker 1 must succeed; stderr:\n{}",
        String::from_utf8_lossy(&r1.stderr)
    );
    assert!(
        r2.status.success(),
        "worker 2 must succeed; stderr:\n{}",
        String::from_utf8_lossy(&r2.stderr)
    );

    let span_content = std::fs::read_to_string(repo.path().join(".span/test/race"))
        .expect("span file must exist after at least one successful add");
    let span = git_span::span_file::SpanFile::parse(&span_content)?;

    let anchor_paths: Vec<String> = span
        .anchors
        .iter()
        .map(|a| format!("{}#L{}-L{}", a.path, a.start_line, a.end_line))
        .collect();

    // Both processes serialize through the repository lock taken at
    // dispatch, so both writes must land: seed + worker 1's anchor +
    // worker 2's anchor.
    assert_eq!(
        span.anchors.len(),
        3,
        "Concurrent `git span add` lost work: expected 3 anchors but found {}.\n\
         Span content:\n{}\n\
         Anchors present:\n\
         {}",
        span.anchors.len(),
        span_content,
        anchor_paths.join("\n"),
    );

    Ok(())
}
