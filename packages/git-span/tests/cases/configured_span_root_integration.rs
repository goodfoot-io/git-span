//! Regression coverage for F1: a configured (non-default) span root
//! must be honored identically by the writer and by every reader,
//! management, and stale path — not silently ignored in favor of a
//! hardcoded `.span`.
//!
//! Precedence under test (highest first): `--span-dir` >
//! `GIT_SPAN_DIR` > `git config git-span.dir` > `.span`. Before this
//! fix, `add` wrote `<root>/<name>` while `list`/`show`/`stale`/`move`
//! read `.span` and reported "nothing" / "not found".

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// `--span-dir <root>` threaded through add → list → show → stale → move.
#[test]
fn configured_span_dir_flag_round_trips() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;

    // add under a non-default root via --span-dir.
    let add = repo.run_span([
        "--span-dir",
        "spans",
        "add",
        "demo/coupling",
        "src/lib.rs#L1-L2",
    ])?;
    assert!(
        add.status.success(),
        "add under --span-dir failed: {}",
        String::from_utf8_lossy(&add.stderr)
    );

    // The writer must have written under the configured root, not `.span`.
    assert!(
        repo.path().join("spans/demo/coupling").exists(),
        "span file not written under configured root"
    );
    assert!(
        !repo.path().join(".span").exists(),
        "span file leaked into the hardcoded default `.span`"
    );

    // list must see it (was empty before the fix).
    let list = repo.span_stdout(["--span-dir", "spans", "list"])?;
    assert!(
        list.contains("demo/coupling"),
        "list missed configured-root span: {list}"
    );

    // show must resolve it (was SpanNotFound before the fix).
    let show = repo.span_stdout(["--span-dir", "spans", "show", "demo/coupling"])?;
    assert!(
        show.contains("demo/coupling"),
        "show missed configured-root span: {show}"
    );
    // No vestigial ref-era fields in show output (F8).
    assert!(
        !show.contains("anchor_sha"),
        "show emitted dead anchor_sha field: {show}"
    );
    assert!(
        !show.contains("created_at"),
        "show emitted dead created_at field: {show}"
    );
    assert!(
        !show.contains("blob"),
        "show emitted dead blob field: {show}"
    );

    // Bare `git span <name>` with a preceding global option must work (F8).
    let bare = repo.run_span(["--span-dir", "spans", "demo/coupling"])?;
    assert!(
        bare.status.success(),
        "bare show with preceding --span-dir failed: {}",
        String::from_utf8_lossy(&bare.stderr)
    );
    assert!(String::from_utf8_lossy(&bare.stdout).contains("demo/coupling"));

    // stale must scan the configured root (reported clean/empty before).
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "track span"])?;
    repo.write_commit_graph()?;
    let stale = repo.run_span(["--span-dir", "spans", "stale"])?;
    assert!(
        stale.status.success(),
        "stale under configured root failed: {}",
        String::from_utf8_lossy(&stale.stderr)
    );
    let stale_out = String::from_utf8_lossy(&stale.stdout);
    assert!(
        stale_out.contains("demo/coupling") || stale_out.contains("0 stale"),
        "stale did not account for the configured-root span: {stale_out}"
    );

    // move must find and rename it under the configured root.
    let mv = repo.run_span([
        "--span-dir",
        "spans",
        "move",
        "demo/coupling",
        "demo/renamed",
    ])?;
    assert!(
        mv.status.success(),
        "move under configured root failed: {}",
        String::from_utf8_lossy(&mv.stderr)
    );
    assert!(repo.path().join("spans/demo/renamed").exists());
    assert!(!repo.path().join("spans/demo/coupling").exists());

    Ok(())
}

/// `git config git-span.dir` is honored by writer and readers alike.
#[test]
fn configured_span_dir_via_git_config() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.txt", "one\ntwo\n")?;
    repo.commit_all("seed")?;
    repo.run_git(["config", "git-span.dir", "cfgroot"])?;

    let add = repo.run_span(["add", "cfg/span", "a.txt"])?;
    assert!(
        add.status.success(),
        "add with git-config root failed: {}",
        String::from_utf8_lossy(&add.stderr)
    );
    assert!(repo.path().join("cfgroot/cfg/span").exists());
    assert!(!repo.path().join(".span").exists());

    let list = repo.span_stdout(["list"])?;
    assert!(
        list.contains("cfg/span"),
        "list missed git-config-root span: {list}"
    );
    Ok(())
}
