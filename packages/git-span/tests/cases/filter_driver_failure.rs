//! A content-filter driver that cannot be run is a per-anchor condition.
//!
//! `.gitattributes` can route a path through `filter=<name>`, and the driver it
//! names is ordinary software that is often simply not installed — git-crypt is
//! the motivating case. The engine has always had the right answer for this:
//! `ContentUnavailable(FilterFailed)` on the affected anchor, every other span
//! reported normally. Only two of the eight configurations reached it.
//!
//! The other six aborted the whole scan. That is the defect these tests exist
//! for, and it is worth being precise about why it was invisible: the exit code
//! is `1` either way. `1` is also what ordinary drift returns, so a CI job, a
//! pre-commit hook, or the agent advisor sees "drift found" and cannot tell that
//! a real, unrelated drift was dropped on the floor. A test that only asserted
//! the error text would have passed against the broken build.
//!
//! So every case here carries **two** spans: `protected`, whose file is behind
//! the missing driver, and `unrelated`, which genuinely drifts and whose
//! presence in the output is the actual assertion. The grid is driver form
//! (one-shot `clean`/`smudge` vs long-running `process`) x
//! `filter.<name>.required` x worktree state, because those three axes produced
//! different failures and no single one of them predicts the outcome.

use crate::support;
use anyhow::Result;
use support::TestRepo;

/// Which filter protocol `.gitattributes`'s driver is configured under.
#[derive(Clone, Copy, Debug)]
enum DriverForm {
    /// `filter.<name>.clean` / `.smudge` — one shell command per conversion.
    CleanSmudge,
    /// `filter.<name>.process` — one long-running pkt-line codec.
    Process,
}

/// Two spans, one commit apart from a broken filter driver.
///
/// `protected/secret.txt` is behind `filter=gc`, whose driver does not exist.
/// `unrelated/other.txt` is behind nothing and is left drifted in every case:
/// it is the probe for whole-scan suppression, so it must never be the thing
/// under test. The filter is configured *after* the spans are committed, since
/// `git span add` would otherwise be reading through the same broken driver.
fn broken_filter_repo(form: DriverForm, required: bool, modified: bool) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("secret.txt", "a\nb\nc\nd\n")?;
    repo.write_file("other.txt", "x\ny\nz\n")?;
    repo.write_file(".gitattributes", "secret.txt filter=gc\n")?;
    repo.commit_all("seed")?;

    repo.span_stdout(["add", "protected", "secret.txt#L1-L2"])?;
    repo.span_stdout(["why", "protected", "the protected head"])?;
    repo.span_stdout(["add", "unrelated", "other.txt#L1-L2"])?;
    repo.span_stdout(["why", "unrelated", "the unrelated head"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare spans"])?;

    match form {
        DriverForm::CleanSmudge => {
            repo.run_git(["config", "filter.gc.clean", "/nonexistent/gc clean"])?;
            repo.run_git(["config", "filter.gc.smudge", "/nonexistent/gc smudge"])?;
        }
        DriverForm::Process => {
            repo.run_git(["config", "filter.gc.process", "/nonexistent/gc process"])?;
        }
    }
    repo.run_git([
        "config",
        "filter.gc.required",
        if required { "true" } else { "false" },
    ])?;

    // `unrelated` always drifts — that is the whole point of it.
    repo.write_file("other.txt", "x\nY\nz\n")?;
    if modified {
        repo.write_file("secret.txt", "a\nB\nc\nd\nE\n")?;
    }
    Ok(repo)
}

/// Every cell of the grid, as `(form, required, modified)`.
fn grid() -> Vec<(DriverForm, bool, bool)> {
    let mut cells = Vec::new();
    for form in [DriverForm::CleanSmudge, DriverForm::Process] {
        for required in [false, true] {
            for modified in [false, true] {
                cells.push((form, required, modified));
            }
        }
    }
    cells
}

fn label(form: DriverForm, required: bool, modified: bool) -> String {
    format!(
        "form={form:?} required={required} worktree={}",
        if modified { "modified" } else { "pristine" }
    )
}

/// The load-bearing property: one file's unreadable filter must not cost the
/// report on every other span. Asserted in all three output formats, because a
/// renderer that drops the row is as damaging as an engine that never produced
/// it, and asserted in all eight cells, because six of them used to fail.
#[test]
fn unrelated_drift_survives_a_broken_filter_driver_in_every_configuration() -> Result<()> {
    for (form, required, modified) in grid() {
        let cell = label(form, required, modified);
        let repo = broken_filter_repo(form, required, modified)?;

        for format in ["human", "porcelain", "json"] {
            let out = match format {
                "human" => repo.run_span(["drift"])?,
                other => repo.run_span(["drift", "--format", other])?,
            };
            let stdout = String::from_utf8_lossy(&out.stdout);
            assert!(
                stdout.contains("unrelated"),
                "[{cell}] --format {format} dropped the unrelated span's drift; \
                 stdout: {stdout}; stderr: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert!(
                !stdout.is_empty(),
                "[{cell}] --format {format} rendered nothing at all"
            );
        }
    }
    Ok(())
}

/// The filtered anchor is classified, not errored — and the classification
/// names the driver, since "which program do I install" is the only fact the
/// user can act on.
#[test]
fn the_filtered_anchor_is_classified_as_filter_failed_and_names_the_driver() -> Result<()> {
    for (form, required, modified) in grid() {
        let cell = label(form, required, modified);
        let repo = broken_filter_repo(form, required, modified)?;

        let porcelain = String::from_utf8_lossy(
            &repo.run_span(["drift", "--format", "porcelain"])?.stdout,
        )
        .into_owned();
        assert!(
            porcelain.contains("FILTER_FAILED\t-\tprotected\tsecret.txt"),
            "[{cell}] porcelain must carry a FILTER_FAILED row for the protected \
             anchor; got: {porcelain}"
        );

        let human =
            String::from_utf8_lossy(&repo.run_span(["drift"])?.stdout).into_owned();
        assert!(
            human.contains("content unavailable (filter `gc` failed)"),
            "[{cell}] the human row must name the driver; got: {human}"
        );

        let json =
            String::from_utf8_lossy(&repo.run_span(["drift", "--format", "json"])?.stdout)
                .into_owned();
        let parsed: serde_json::Value = serde_json::from_str(&json)
            .map_err(|e| anyhow::anyhow!("[{cell}] json was not parseable: {e}; got: {json}"))?;
        let statuses = parsed["findings"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("[{cell}] json has no findings array"))?;
        assert!(
            statuses.iter().any(|f| {
                f["status"]["reason"] == "FILTER_FAILED" && f["status"]["detail"]["filter"] == "gc"
            }),
            "[{cell}] json must carry the FILTER_FAILED reason with the driver name; \
             got: {json}"
        );
    }
    Ok(())
}

/// A missing filter driver must never produce repository-repair advice. `git
/// fsck` exits 0 on these repositories: the object store is intact and the fix
/// is to install a program. Advice to re-fetch or restore from a backup is
/// destructive-adjacent, and following it would cost the user real work while
/// leaving the actual problem untouched.
#[test]
fn a_broken_filter_driver_never_advises_repository_repair() -> Result<()> {
    for (form, required, modified) in grid() {
        let cell = label(form, required, modified);
        let repo = broken_filter_repo(form, required, modified)?;

        for args in [
            vec!["drift"],
            vec!["drift", "--format", "porcelain"],
            vec!["drift", "--format", "json"],
        ] {
            let out = repo.run_span(args.clone())?;
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            for forbidden in [
                "git fsck",
                "object store is damaged",
                "re-fetching from a remote",
                "restoring from a backup",
            ] {
                assert!(
                    !combined.contains(forbidden),
                    "[{cell}] `git span {}` offered repository-repair advice \
                     ({forbidden:?}) for a missing filter driver; got: {combined}",
                    args.join(" ")
                );
            }
        }
    }
    Ok(())
}

/// The old wording claimed the *feature* was missing. It is not: the process
/// protocol works, and a real driver resolves anchors through it. What failed
/// is this repository's configured driver.
#[test]
fn the_filter_error_does_not_claim_the_protocol_is_unimplemented() -> Result<()> {
    for (form, required, modified) in grid() {
        let cell = label(form, required, modified);
        let repo = broken_filter_repo(form, required, modified)?;
        let out = repo.run_span(["drift"])?;
        let combined = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            !combined.contains("filter not implemented"),
            "[{cell}] output still blames an unimplemented protocol; got: {combined}"
        );
    }
    Ok(())
}

/// A repository between `git init` and its first commit is the most common
/// state there is, and it used to be told its object store might be damaged and
/// that restoring from a backup was on the table. The read failure is real and
/// still fails closed; what must not survive is the unearned diagnosis.
#[test]
fn an_unborn_head_is_not_diagnosed_as_a_damaged_object_store() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("only.txt", "one\ntwo\n")?;
    repo.run_git(["add", "only.txt"])?;

    let out = repo.run_span(["drift"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    // Nothing has been committed, so there is nothing to resolve against and
    // failing closed is correct. Only the explanation is under test.
    assert!(
        !out.status.success(),
        "an unborn HEAD still fails closed; stderr: {stderr}"
    );
    assert!(
        !stderr.contains("object store is damaged"),
        "an unborn branch is not a damaged object store; got: {stderr}"
    );
    assert!(
        !stderr.contains("This usually means"),
        "the template must not assert a cause it has no evidence for; got: {stderr}"
    );
    // `fsck` may still be offered as one hypothesis, but only behind the
    // conditional the rewritten template introduces.
    if stderr.contains("git fsck") {
        assert!(
            stderr.contains("If the error points at a missing or unreadable object"),
            "`git fsck` must be conditional on evidence; got: {stderr}"
        );
    }
    Ok(())
}
