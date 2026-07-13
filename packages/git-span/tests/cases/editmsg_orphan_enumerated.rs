//! Editor scratch files (`.EDITMSG`) are left behind after `run_why_editor`
//! hits an early return (non-zero editor exit, L757-768), and the orphan
//! is visible to span enumeration because:
//!
//! - `is_span_name_segment` only filters dot-prefixed *basenames* —
//!   `foo.EDITMSG` does not start with `.`, so it passes.
//! - `collect_file_names` walks every file under the span root and inserts
//!   each non-dotfile name, including `.EDITMSG` orphans.
//! - The template content (`\n# Write the relationship description. ...\n`)
//!   parses successfully as a why-only span (empty anchors, comment why).
//!
//! This test MUST FAIL against the unfixed code because `git span list`
//! currently enumerates the `.EDITMSG` orphan as a legitimate span.
//! The failing assertion encodes the desired post-fix behavior: `.EDITMSG`
//! files must be excluded from span enumeration.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn editmsg_orphan_excluded_from_span_list() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "fn foo() {}\n")?;
    repo.commit_all("seed source")?;

    // Create a real span so the .span/ directory exists with a known span.
    let out = repo.run_span(["add", "myflow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "seeding span failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Simulate an editor scratch file left behind after editor failure.
    // run_why_editor (commit.rs:741-742) writes template content to
    // `<span_root>/<name>.EDITMSG` and only deletes it on the happy path
    // (L778). Non-zero editor exit (L757-768) skips cleanup.
    repo.write_file(
        ".span/myflow.EDITMSG",
        "\n# Write the relationship description. Empty why aborts.\n",
    )?;

    // List should NOT include the .EDITMSG orphan.
    let out = repo.run_span(["list"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    // THIS ASSERTION MUST FAIL with the current unfixed code because
    // `collect_worktree_names` enumerates the orphan as `myflow.EDITMSG`
    // and nothing filters `.EDITMSG`-suffixed names.
    assert!(
        !stdout.contains("EDITMSG"),
        "EDITMSG scratch file must not appear as a span;\n\
         stdout:\n{stdout}\nstderr:\n{stderr}"
    );

    // The legitimate span must still be listed.
    assert!(
        stdout.contains("myflow"),
        "real span must still be listed; stdout:\n{stdout}"
    );

    Ok(())
}
