//! Retired subcommands, and spans that already carry a now-reserved name.
//!
//! Two failure modes that shipped together when `stale` was renamed to
//! `drift`:
//!
//! 1. Removing `stale` from the reserved list made it an ordinary span name,
//!    so `git span stale` was spliced into `show` and reported a missing
//!    *span*, pointing at `git span list` — which enumerates spans and can
//!    never mention the replacement subcommand.
//! 2. Adding `drift` to the reserved list applied retroactively to spans
//!    created when the name was legal, because `delete` and `rename`
//!    validated the *existing* name against the create-time rule. The span
//!    became permanently read-only and undeletable.
//!
//! The rename policy is unchanged: `git span stale` still does not run.

use crate::support::{self, TestRepo};

use anyhow::Result;

/// Build a repo carrying a span named `drift` — a name that was legal when
/// the span was created and is reserved now. `create_and_commit_span` writes
/// the span file directly, which is the only way to reach this state today
/// and exactly how a pre-release binary left it on disk.
fn repo_with_pre_existing_drift_span() -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    support::create_and_commit_span(
        &gix,
        "drift",
        &[("file1.txt", 1, 3)],
        "Legacy span created before `drift` became a reserved name.",
    )?;
    Ok(repo)
}

// --- Retired subcommand -----------------------------------------------

/// `git span stale` must name its replacement and must not run the drift
/// command. Exit 1 (operational refusal), not clap's exit 2 and not a
/// span-not-found.
#[test]
fn retired_stale_names_drift_and_does_not_run() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["stale"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("git span drift"),
        "the refusal must name the replacement subcommand, got: {stderr}"
    );
    assert!(
        !stderr.contains("no span named"),
        "`stale` must not be misreported as a missing span, got: {stderr}"
    );
    assert!(
        !stderr.contains("git span list"),
        "`git span list` enumerates spans and cannot lead to `drift`, got: {stderr}"
    );
    assert!(
        stdout.is_empty(),
        "the retired name must not execute anything, got stdout: {stdout}"
    );
    Ok(())
}

/// The refusal ignores the rest of the argv: flags that `stale` used to
/// accept must still get the rename, not a clap usage error about a command
/// that no longer exists.
#[test]
fn retired_stale_with_flags_still_gets_the_rename() -> Result<()> {
    let repo = TestRepo::seeded()?;
    for args in [
        vec!["stale", "--format", "porcelain"],
        vec!["stale", "--fix"],
        vec!["--perf", "stale"],
    ] {
        let out = repo.run_span(&args)?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(
            out.status.code(),
            Some(1),
            "`{args:?}` must be an operational refusal, not a usage error; stderr: {stderr}"
        );
        assert!(
            stderr.contains("git span drift"),
            "`{args:?}` must name the replacement, got: {stderr}"
        );
    }
    Ok(())
}

/// A typo is not a retired name: `stail` remains an ordinary missing span, so
/// the two mistakes stay distinguishable from their output alone.
#[test]
fn typo_still_reports_a_missing_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["stail"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        stderr.contains("no span named"),
        "an unknown name is still a missing span, got: {stderr}"
    );
    assert!(
        !stderr.contains("was retired"),
        "a typo must not be reported as a rename, got: {stderr}"
    );
    Ok(())
}

/// The retired name is reserved, so it cannot be claimed as a span name
/// either — otherwise the rename message would become unreachable.
#[test]
fn retired_name_cannot_be_created_as_a_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["add", "stale", "file1.txt#L1-L3"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_ne!(out.status.code(), Some(0), "stderr: {stderr}");
    assert!(
        stderr.contains("git span drift"),
        "the refusal must name the replacement, got: {stderr}"
    );
    Ok(())
}

// --- Pre-existing span carrying a now-reserved name --------------------

/// A span named `drift` created before the reservation must still be
/// deletable. A delete that refuses to delete leaves the span with no escape
/// at all.
#[test]
fn pre_existing_reserved_span_can_be_deleted() -> Result<()> {
    let repo = repo_with_pre_existing_drift_span()?;
    let out = repo.run_span(["delete", "drift"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(0),
        "a reserved-named span must still be deletable; stderr: {stderr}"
    );
    assert!(
        !repo.path().join(".span/drift").exists(),
        "the span file must be gone from the worktree"
    );
    Ok(())
}

/// Renaming *away* from a reserved name is the supported migration, so the
/// source name faces the shape rule only. The destination still faces the
/// full create-time rule.
#[test]
fn pre_existing_reserved_span_can_be_renamed_away() -> Result<()> {
    let repo = repo_with_pre_existing_drift_span()?;
    let gix = repo.gix_repo()?;

    git_span::rename_span(&gix, "drift", "legacy/drift-coupling")?;
    assert!(
        !repo.path().join(".span/drift").exists(),
        "the reserved-named file must be vacated"
    );
    assert!(
        repo.path().join(".span/legacy/drift-coupling").exists(),
        "the span must exist under its new name"
    );

    // The reserved list still governs the destination.
    let err = git_span::rename_span(&gix, "legacy/drift-coupling", "drift")
        .expect_err("renaming *to* a reserved name must still be refused");
    assert!(
        matches!(err, git_span::Error::ReservedName(_)),
        "expected ReservedName, got {err:?}"
    );
    Ok(())
}

/// `doctor` is the audit surface: a span whose name became reserved must be
/// a finding with a remedy, so the user meets it there rather than when a
/// write already refused.
#[test]
fn doctor_reports_a_pre_existing_reserved_span() -> Result<()> {
    let repo = repo_with_pre_existing_drift_span()?;
    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert_eq!(
        out.status.code(),
        Some(1),
        "a reserved-named span is a finding, so doctor must not exit clean; stdout: {stdout}"
    );
    assert!(
        stdout.contains("span `drift`"),
        "the finding must name the span, got: {stdout}"
    );
    assert!(
        stdout.contains("git span delete drift"),
        "the finding must carry the escape, got: {stdout}"
    );
    Ok(())
}

/// A hierarchical name whose first segment is reserved is untouched — the
/// reservation is on the whole name. This repository's own `.span/drift/*`
/// spans depend on it.
#[test]
fn reserved_prefix_under_a_hierarchy_is_not_a_finding() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    support::create_and_commit_span(
        &gix,
        "drift/nested",
        &[("file1.txt", 1, 3)],
        "A hierarchical span whose first segment matches a subcommand.",
    )?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "stdout: {stdout}");
    assert!(
        !stdout.contains("reserved by this version"),
        "`drift/nested` is a legal name, got: {stdout}"
    );
    Ok(())
}

/// Writes to a reserved-named span still refuse — but the refusal must say
/// the name is the problem and name the way out, not just restate the rule.
#[test]
fn write_to_reserved_span_explains_the_escape() -> Result<()> {
    let repo = repo_with_pre_existing_drift_span()?;
    let out = repo.run_span(["add", "drift", "file2.txt#L1-L4"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_ne!(out.status.code(), Some(0), "stderr: {stderr}");
    assert!(
        stderr.contains("git span delete drift"),
        "the refusal must name the escape, got: {stderr}"
    );
    Ok(())
}
