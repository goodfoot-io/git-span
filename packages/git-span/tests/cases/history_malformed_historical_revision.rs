//! `git span history` must not abort when a historical revision of a span
//! contains a malformed span file (e.g. missing blank-line separator between
//! anchors and why text).

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn history_succeeds_when_historical_revision_is_malformed() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Commit 1: healthy span
    repo.run_span(["add", "my-span", "file1.txt#L1-L3"])?;
    repo.run_span(["why", "my-span", "initial healthy why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create valid span"])?;

    // Commit 2: historical revision with malformed span file.
    // Missing blank line between anchor and why paragraph (same defect as in upstream repo).
    let hash_out = repo.span_stdout(["show", "my-span"])?;
    let anchor_line = hash_out
        .lines()
        .find(|l| l.contains("file1.txt"))
        .expect("anchor line");
    let malformed_content = format!("{anchor_line}\nprose without blank line separator\n");
    repo.write_file(".span/my-span", &malformed_content)?;
    repo.run_git(["add", ".span/my-span"])?;
    repo.run_git(["commit", "-m", "commit with malformed span file"])?;
    let malformed_commit = repo.git_stdout(["rev-parse", "HEAD"])?;

    // Commit 3: fixed span file with proper blank line separator
    let fixed_content = format!("{anchor_line}\n\nfixed why with blank line\n");
    repo.write_file(".span/my-span", &fixed_content)?;
    repo.run_git(["add", ".span/my-span"])?;
    repo.run_git(["commit", "-m", "fix span file with separator"])?;

    // Verify current state is healthy across other commands
    let show = repo.run_span(["show", "my-span"])?;
    assert!(show.status.success(), "show must succeed on healthy current state");

    // History must not abort with exit 1; prints trail and warns to stderr
    let out = repo.run_span(["history", "my-span"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "`git span history` must exit 0 and not abort on historical malformed revision;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stderr.contains("warning: historical revision") && stderr.contains(&malformed_commit),
        "stderr must report the malformed revision as unreadable; stderr:\n{stderr}"
    );
    assert!(
        stdout.contains("create valid span") && stdout.contains("fix span file with separator"),
        "stdout must print the span's revision trail; stdout:\n{stdout}"
    );

    // JSON format also succeeds and returns valid HistoryDocument
    let json_out = repo.run_span(["history", "my-span", "--format=json"])?;
    assert!(json_out.status.success(), "history --format=json must succeed");
    let json: serde_json::Value = serde_json::from_slice(&json_out.stdout)?;
    assert_eq!(json["span"], "my-span");

    Ok(())
}
