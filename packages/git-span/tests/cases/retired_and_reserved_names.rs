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

/// Build a repo carrying a span named `context`, from before that token became
/// a subcommand. The fixture writes the declaration directly because current
/// create-time validation correctly reserves the command name.
fn repo_with_pre_existing_context_span() -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    let gix = repo.gix_repo()?;
    support::create_and_commit_span(
        &gix,
        "context",
        &[("file1.txt", 1, 3)],
        "Legacy context span remains readable after the command is added.",
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

/// `git span help stale` must not fall through to clap's help machinery:
/// clap resolves `help`'s argument as a subcommand name, so without the
/// guard it answers "unrecognized subcommand 'stale'" — exit 2, and never
/// names the replacement. The refusal must reach the help form too.
#[test]
fn help_for_retired_subcommand_still_gets_the_rename() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["help", "stale"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert_eq!(out.status.code(), Some(1), "stderr: {stderr}");
    assert!(
        stderr.contains("git span drift"),
        "the refusal must name the replacement, got: {stderr}"
    );
    assert!(
        !stderr.contains("unrecognized subcommand"),
        "`help stale` must not reach clap, got: {stderr}"
    );
    Ok(())
}

/// A typo is not a retired name: `stail` remains an ordinary missing span, so
/// the two mistakes stay distinguishable from their output alone.
#[test]
fn unknown_typo_reports_missing_span_without_creating_or_reserving_it() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let status_before = repo.git_stdout(["status", "--porcelain=v1"])?;
    assert!(
        !repo.path().join(".span/stail").exists(),
        "fixture must not already contain the misspelled span"
    );
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
    assert_eq!(
        repo.git_stdout(["status", "--porcelain=v1"])?,
        status_before,
        "looking up an unknown typo must leave the repository unchanged"
    );
    assert!(
        !repo.path().join(".span/stail").exists(),
        "the failed lookup must not create a span artifact"
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
fn doctor_fails_for_a_pre_existing_reserved_span_without_mutating_it() -> Result<()> {
    let repo = repo_with_pre_existing_drift_span()?;
    let span_before = std::fs::read(repo.path().join(".span/drift"))?;
    let status_before = repo.git_stdout(["status", "--porcelain=v1"])?;
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
    assert_eq!(
        std::fs::read(repo.path().join(".span/drift"))?,
        span_before,
        "doctor must audit the reserved span without rewriting it"
    );
    assert_eq!(
        repo.git_stdout(["status", "--porcelain=v1"])?,
        status_before,
        "doctor must leave the repository unchanged"
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

    // Register the merge driver so doctor's merge-driver checks stay silent
    // and the exit code is about the name alone.
    repo.register_span_merge_driver()?;

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

// --- Pre-existing span colliding with the context subcommand -------------

/// The compatibility spelling is a bare span read, so global flags may appear
/// on either side of the legacy name. Context addresses and context-specific
/// options remain unambiguously owned by the new command.
#[test]
fn pre_existing_context_span_has_a_precise_bare_routing_matrix() -> Result<()> {
    let repo = repo_with_pre_existing_context_span()?;

    for args in [
        vec!["context"],
        vec!["--perf", "context"],
        vec!["context", "--perf"],
    ] {
        let output = repo.run_span(&args)?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(
            output.status.code(),
            Some(0),
            "legacy read {args:?} failed; stderr: {stderr}"
        );
        assert!(
            stdout.contains("Legacy context span remains readable"),
            "legacy read {args:?} did not show the span: {stdout}"
        );
    }

    let explicit = repo.run_span(["show", "context"])?;
    assert_eq!(
        explicit.status.code(),
        Some(0),
        "explicit show must remain available: {}",
        String::from_utf8_lossy(&explicit.stderr)
    );
    assert!(
        String::from_utf8_lossy(&explicit.stdout).contains("Legacy context span remains readable")
    );

    let query = repo.run_span_with_env(
        ["context", "file1.txt#L1-L1", "--format", "json"],
        "GIT_SPAN_CONTEXT_DISABLE_SERVICE",
        "1",
    )?;
    assert_eq!(
        query.status.code(),
        Some(0),
        "an address must route to the context command: {}",
        String::from_utf8_lossy(&query.stderr)
    );
    let document: serde_json::Value = serde_json::from_slice(&query.stdout)?;
    assert_eq!(document["schema_version"], 1);

    let option_without_address = repo.run_span(["context", "--format", "json"])?;
    let stderr = String::from_utf8_lossy(&option_without_address.stderr);
    assert_eq!(
        option_without_address.status.code(),
        Some(2),
        "a context-specific option must not fall back to the legacy span; stderr: {stderr}"
    );
    assert!(option_without_address.stdout.is_empty());
    assert!(
        stderr.contains("required arguments were not provided"),
        "clap must own the missing-address diagnostic: {stderr}"
    );
    Ok(())
}

/// Outside a repository there cannot be a legacy span to disambiguate. The
/// parser therefore owns bare `context` and reports its missing address with
/// clap's usage exit, rather than attempting repository discovery first.
#[test]
fn bare_context_outside_a_repository_is_a_usage_error() -> Result<()> {
    let outside = tempfile::tempdir()?;
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(outside.path())
        .arg("context")
        .output()?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    assert_eq!(output.status.code(), Some(2), "stderr: {stderr}");
    assert!(output.stdout.is_empty());
    assert!(
        stderr.contains("required arguments were not provided"),
        "clap must report the missing context address: {stderr}"
    );
    assert!(
        !stderr.contains("not inside a git repository"),
        "repository discovery must not replace the usage error: {stderr}"
    );

    let repo_without_legacy_span = TestRepo::seeded()?;
    for args in [vec!["context"], vec!["context", "--perf"]] {
        let output = repo_without_legacy_span.run_span(&args)?;
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert_eq!(
            output.status.code(),
            Some(2),
            "a repository without the legacy span must keep clap's usage error for {args:?}: {stderr}"
        );
        assert!(output.stdout.is_empty());
        assert!(stderr.contains("required arguments were not provided"));
    }
    Ok(())
}
