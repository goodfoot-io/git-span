//! `git span why --at` must fail closed on a corrupt or conflict-bearing
//! historical span file — matching `run_show`'s `--at` behavior.
//!
//! `run_why_reader` currently uses `SpanFile::parse(&text).ok()`, which
//! discards `Err(ParseError)` and `Err(SpanConflict)`, making a corrupt
//! span file indistinguishable from one that genuinely has no `why`
//! annotation. The result is exit 0 with the misleading "has no why
//! recorded." message.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Create a committed span-with-why, then create a second commit that
/// corrupts the span file with Git conflict markers.  `why --at` against
/// the corrupt commit should fail non-zero.
#[test]
fn why_at_corrupt_span_file_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // --- Seed a span with a why message and commit -------------------
    repo.run_span(["add", "z", "file1.txt#L1-L1"])?;
    repo.run_span(["why", "z", "-m", "original-why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span z with why"])?;

    // --- Corrupt the span file with conflict markers, then commit ---
    repo.write_file(
        ".span/z",
        "<<<<<<< HEAD\nfile1.txt L1-L1 abcd\n=======\nfile1.txt L1-L5 dead\n>>>>>>> other\n\ncorrupt why\n",
    )?;
    repo.commit_all("corrupt span z")?;

    // --- Run `why --at` against the corrupt commit ------------------
    let out = repo.run_span(["why", "z", "--at", "HEAD"])?;

    // Must exit non-zero — a corrupt span file is not "no why."
    assert!(
        !out.status.success(),
        "why --at on a corrupt span file must exit non-zero"
    );

    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Must not print the misleading "no why" message for a corrupt file.
    assert!(
        !stdout.contains("no why recorded"),
        "stdout must not claim 'no why recorded' for a corrupt span file\nstdout: {stdout}"
    );

    // Must surface the parse failure on stderr.
    assert!(
        !stderr.is_empty(),
        "stderr must contain a parse error for a corrupt span file"
    );

    Ok(())
}

/// A span file that is malformed (not conflict markers, but unparseable
/// content) should also fail closed, not silently return "no why."
#[test]
fn why_at_malformed_span_file_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // --- Seed a span with a why message and commit -------------------
    repo.run_span(["add", "m", "file1.txt#L1-L1"])?;
    repo.run_span(["why", "m", "-m", "original-why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span m with why"])?;

    // --- Replace span file with garbage, then commit -----------------
    repo.write_file(".span/m", "!@#$\n%\n^&\n*\n(\n)")?;
    repo.commit_all("garbage span m")?;

    // --- Run `why --at` against the garbage commit -------------------
    let out = repo.run_span(["why", "m", "--at", "HEAD"])?;

    assert!(
        !out.status.success(),
        "why --at on a malformed span file must exit non-zero"
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("no why recorded"),
        "stdout must not claim 'no why recorded' for a malformed span file\nstdout: {stdout}"
    );

    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.is_empty(),
        "stderr must contain a parse error for a malformed span file"
    );

    Ok(())
}
