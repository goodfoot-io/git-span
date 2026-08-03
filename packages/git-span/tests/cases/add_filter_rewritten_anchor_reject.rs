//! Regression (main-197): `git span add` must reject an anchor whose
//! address is only meaningful against the worktree file, not silently
//! record a token over the *filtered* bytes.
//!
//! In a repository with a content-rewriting `.gitattributes` filter
//! (git-lfs is the common instance — the worktree holds five lines of
//! content while the recorded blob is the three-line pointer),
//! `hash_anchor_content()` reads the worktree through
//! `read_worktree_normalized()`, which applies the filter, and both
//! validates the line range and fingerprints against those filtered
//! bytes. An address that is in range of *both* the worktree file and
//! the filtered content — `f.txt#L1-L2`, where lines 1-2 of the pointer
//! are `version https://git-lfs.github.com/spec/v1` and
//! `oid sha256:…` — succeeds silently, recording a hash over text the
//! user never wrote and emitting no diagnostic.
//!
//! The past-EOF face (`f.txt#L4-L5`) already fails closed by accident:
//! `end=5 exceeds file line count (3)` — the filtered file is shorter.
//! The in-range face is the defect this test pins. It must be rejected,
//! not recorded.
//!
//! The assertion is the fail-closed direction: the add must exit
//! non-zero and leave no span file. Against the unfixed code the add
//! exits 0 and writes `.span/sp` (hashing the pointer's lines 1-2), so
//! this test fails — the reproduction requirement.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// The fixture file as the user sees it in the worktree: five lines.
/// The filter rewrites it to a three-line pointer on the way into the
/// object database.
const WORKTREE: &str = "l1\nl2\nl3\nl4\nl5\n";

/// A `filter.<name>.process` command line for the test-helper driver,
/// quoted for the `sh -c` the resolver spawns it through.
fn filter_process_command(transform: &str) -> String {
    format!(
        "'{}' filter-process {transform}",
        env!("CARGO_BIN_EXE_git-span-test-helper")
    )
}

/// Seed a repo whose `f.txt` is committed THROUGH a content-rewriting
/// filter: the recorded blob is the three-line pointer, while the
/// worktree holds the user's five lines — the LFS shape.
fn seed_pointer_filtered_repo(repo: &TestRepo) -> Result<()> {
    repo.write_file("f.txt", WORKTREE)?;
    repo.write_file(".gitattributes", "*.txt filter=ptr\n")?;
    repo.run_git([
        "config",
        "filter.ptr.process",
        &filter_process_command("pointer"),
    ])?;
    repo.commit_all("seed through the pointer filter")?;

    // Sanity: the fixture really is the LFS shape — pointer in the
    // object database, real content on disk.
    let blob = repo.git_stdout(["cat-file", "-p", "HEAD:f.txt"])?;
    assert!(
        blob.starts_with("version https://git-lfs.github.com/spec/v1\noid sha256:"),
        "fixture: HEAD blob should be the pointer, got {blob:?}"
    );
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f.txt"))?,
        WORKTREE,
        "fixture: worktree file should hold the user's five lines"
    );
    Ok(())
}

/// The in-range face: `f.txt#L1-L2` exists in the worktree the user is
/// looking at AND in the filtered bytes, so the line-range check has
/// nothing to object to — but the two contents are different text. The
/// add must fail closed instead of silently recording a token over
/// pointer metadata.
#[test]
#[cfg(unix)]
fn add_rejects_in_range_anchor_over_filter_rewritten_content() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_pointer_filtered_repo(&repo)?;

    let out = repo.run_span(["add", "sp", "f.txt#L1-L2"])?;
    assert!(
        !out.status.success(),
        "add must reject an in-range anchor whose filtered content is \
         different text from the worktree file; it silently succeeded and \
         recorded a hash over filtered (pointer) bytes.\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
    assert!(
        !repo.path().join(".span/sp").exists(),
        "a rejected add must not leave a span file behind"
    );
    Ok(())
}
