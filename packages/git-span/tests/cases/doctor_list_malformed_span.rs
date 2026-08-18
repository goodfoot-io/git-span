//! `git span doctor` and `git span list` must not abort with a raw
//! top-level `error: invalid span file: ...` when one span file under the
//! span root fails to parse.
//!
//! The corpus loader ([`load_all_spans_in`]) documents — in
//! `scan_interior_anchors`'s contract and the drift path's — that spans
//! whose content fails to *parse* are skipped, with the parse failures
//! surfaced by the dedicated reporting paths (doctor's per-span parse
//! findings, `show`'s structured `CliError`). In practice both
//! `read_effective_serial` and `read_effective_parallel` treated every
//! non-conflict error as fatal, so a single corrupted span file aborted
//! the whole audit: doctor never printed its `## Findings` section, never
//! reached reserved-name / interior-anchor / duplicate-identity surfacing,
//! and never ran the legacy-lock cleanup; list crashed before rendering
//! anything at all.
//!
//! Expected: doctor reports the malformed span as a per-span finding and
//! still runs every other check (including the legacy-lock cleanup added
//! by main-261); list degrades to a per-span skip and still lists the
//! healthy spans.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a repo with one healthy span (`healthy`) plus a `.span/broken`
/// file whose content is not a valid span, and a stale legacy lock file
/// so doctor's cleanup has something to do. The malformed file is left
/// untracked in the worktree — exactly the state a hand-edit or a crash
/// leaves behind.
fn repo_with_malformed_span() -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "healthy", "file1.txt"])?;
    repo.write_file(".span/broken", "garbage not valid\n")?;
    repo.write_file(".span/.stale.lock", "")?;
    Ok(repo)
}

#[test]
fn doctor_reports_malformed_span_as_finding_and_continues_every_other_check() -> Result<()> {
    let repo = repo_with_malformed_span()?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    // Before the fix, doctor aborted at the corpus load with a raw
    // `error: invalid span file: ...` on stderr and printed nothing at
    // all on stdout — no findings section, no cleanup.
    assert!(
        !out.status.success(),
        "doctor must exit 1 when a malformed span is present;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        !stderr.contains("error: invalid span file"),
        "the malformed span must not surface as a raw top-level error;\nstderr:\n{stderr}"
    );
    assert!(
        stdout.contains("## Findings"),
        "doctor must reach its findings section;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("span `broken` failed to parse"),
        "doctor must report the malformed span as a per-span finding;\nstdout:\n{stdout}"
    );
    // The healthy span was still checked and counted.
    assert!(
        stdout.contains("2 spans checked"),
        "doctor must still count the healthy span;\nstdout:\n{stdout}"
    );

    // Doctor's other work ran too — in particular the legacy-lock cleanup
    // (main-261) that used to be skipped entirely.
    assert!(
        stdout.contains("## Cleanup"),
        "doctor must reach the cleanup section despite the malformed span;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`.span/.stale.lock`"),
        "doctor must name the removed stale lock file;\nstdout:\n{stdout}"
    );
    assert!(
        !repo.path().join(".span/.stale.lock").exists(),
        "doctor must have removed the stale lock file;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn list_skips_malformed_span_and_lists_healthy_span() -> Result<()> {
    let repo = repo_with_malformed_span()?;

    let out = repo.run_span(["list"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    // Before the fix, list aborted at the corpus load with a raw
    // `error: invalid span file: ...` and exit 1, rendering nothing.
    assert!(
        out.status.success(),
        "list must succeed despite a malformed span;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        !stderr.contains("error: invalid span file"),
        "the malformed span must not surface as a raw top-level error;\nstderr:\n{stderr}"
    );
    assert!(
        stdout.contains("healthy"),
        "list must still enumerate the healthy span;\nstdout:\n{stdout}"
    );
    // The broken file is skipped per-span rather than blanking the corpus.
    assert!(
        !stdout.contains("garbage"),
        "list must not render the malformed file's content;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn list_with_only_a_malformed_span_degrades_gracefully() -> Result<()> {
    // Serial corpus-load path (`names.len() <= 1`): a single broken span
    // must be skipped, not fatal.
    let repo = TestRepo::seeded()?;
    repo.write_file(".span/broken", "garbage not valid\n")?;

    let out = repo.run_span(["list"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "list must succeed when every span file is malformed;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        !stderr.contains("error: invalid span file"),
        "the malformed span must not surface as a raw top-level error;\nstderr:\n{stderr}"
    );

    Ok(())
}
