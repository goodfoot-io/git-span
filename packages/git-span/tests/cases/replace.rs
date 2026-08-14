//! `git span replace` — the atomic anchor-replacement transaction.
//!
//! The contract (card main-205): `git span replace <name> <old> <new>`
//! retires exactly one matching old identity and installs the validated
//! new identity in a single locked read-modify-write, or changes nothing.
//! Errors leave the declaration byte-for-byte unchanged; success leaves
//! no intermediate state in which both or neither anchor is present.
//!
//! Contract-first (tdd-bootstrap): these checks were written skipped
//! against the `run_replace` stub, then unskipped as the transaction
//! landed.

use crate::support::TestRepo;

use anyhow::Result;
use git_span::cli::{AddArgs, AddFormat};
use git_span::cli::commit::run_add;
use git_span::cli::commit::run_replace;
use serde_json::Value;

/// Path of the span declaration inside the repo.
fn span_path(repo: &TestRepo, name: &str) -> std::path::PathBuf {
    repo.path().join(".span").join(name)
}

/// Raw bytes of the span declaration (None when the file does not exist).
fn span_bytes(repo: &TestRepo, name: &str) -> Result<Option<Vec<u8>>> {
    let p = span_path(repo, name);
    if p.exists() {
        Ok(Some(std::fs::read(&p)?))
    } else {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Success paths
// ---------------------------------------------------------------------------

/// Range → range replacement: the old identity is gone, the new identity
/// is present, and the output names both addresses.
#[test]
fn replace_range_to_range_retires_old_installs_new() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    assert!(
        out.status.success(),
        "replace failed (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("file1.txt#L1-L5"),
        "output must name the retired address, got: {stdout}"
    );
    assert!(
        stdout.contains("file1.txt#L6-L10"),
        "output must name the installed address, got: {stdout}"
    );
    assert!(
        stdout.contains("drift-free"),
        "a valid replacement must report the span drift-free, got: {stdout}"
    );

    let span = String::from_utf8(span_bytes(&repo, "test/race")?.unwrap())?;
    assert!(
        span.contains("file1.txt#L6-L10"),
        "new identity must be present in the declaration:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L5"),
        "old identity must be retired from the declaration:\n{span}"
    );
    Ok(())
}

/// Whole-file → range replacement.
#[test]
fn replace_whole_file_to_range() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file2.txt"])?;

    let out = repo.run_span(["replace", "test/race", "file2.txt", "file2.txt#L1-L5"])?;
    assert!(
        out.status.success(),
        "replace failed (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );

    let span = String::from_utf8(span_bytes(&repo, "test/race")?.unwrap())?;
    assert!(
        span.contains("file2.txt#L1-L5"),
        "new identity must be present:\n{span}"
    );
    assert!(
        !span.lines().any(|l| l.starts_with("file2.txt ")),
        "whole-file old identity must be retired:\n{span}"
    );
    Ok(())
}

/// Range → whole-file replacement.
#[test]
fn replace_range_to_whole_file() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt"])?;
    assert!(
        out.status.success(),
        "replace failed (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );

    let span = String::from_utf8(span_bytes(&repo, "test/race")?.unwrap())?;
    assert!(
        span.lines().any(|l| l.starts_with("file1.txt ")),
        "whole-file new identity must be present:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L5"),
        "old identity must be retired:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Prevalidation failures — declaration byte-for-byte unchanged
// ---------------------------------------------------------------------------

/// The exact-identity contract: replacing an anchor with its own address
/// is refused, with `git span add` named as the hash-refresh path.
#[test]
fn replace_same_identity_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;
    let before = span_bytes(&repo, "test/race")?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L1-L5"])?;
    assert_eq!(out.status.code(), Some(1), "same-identity replace must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("git span add"),
        "the refusal must name `git span add` as the refresh path, got: {stderr}"
    );
    assert_eq!(
        span_bytes(&repo, "test/race")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

/// A missing old identity is reported as such, never silently additive.
#[test]
fn replace_missing_old_anchor_fails_closed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;
    let before = span_bytes(&repo, "test/race")?;

    let out = repo.run_span(["replace", "test/race", "file2.txt#L10-L14", "file1.txt#L6-L10"])?;
    assert_eq!(out.status.code(), Some(1), "missing old anchor must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("file2.txt#L10-L14") && stderr.contains("test/race"),
        "the diagnostic must name the address and span, got: {stderr}"
    );
    assert_eq!(
        span_bytes(&repo, "test/race")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

/// Two records sharing the old identity (hand-edited or legacy file) are no
/// longer a dead end: the old identity is being *retired*, not read for
/// content, so `replace` removes every record at it — however many, whatever
/// their hashes — and installs the one new record. There is no survivor to
/// name and no hash to adjudicate, so there is nothing left to be ambiguous
/// about.
#[test]
fn replace_duplicate_old_records_resolved() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Hand-write a span with two same-identity records (different hashes).
    let span_p = span_path(&repo, "test/race");
    std::fs::create_dir_all(span_p.parent().unwrap())?;
    std::fs::write(
        span_path(&repo, "test/race"),
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\
         \n\
         why: duplicate records from a legacy edit.\n",
    )?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    assert!(
        out.status.success(),
        "a duplicate old identity must be resolved, not refused (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );

    let span = String::from_utf8(span_bytes(&repo, "test/race")?.expect("span file"))?;
    assert!(
        !span.contains("file1.txt#L1-L5"),
        "every record at the old identity must be gone, with no stray \
         survivor:\n{span}"
    );
    assert!(
        !span.contains("aaaaaaaaaaaaaaaa") && !span.contains("bbbbbbbbbbbbbbbb"),
        "neither duplicate's hash may survive anywhere in the file:\n{span}"
    );
    assert_eq!(
        span.lines()
            .filter(|l| l.starts_with("file1.txt#L6-L10 "))
            .count(),
        1,
        "the new identity must hold exactly one record:\n{span}"
    );
    assert!(
        span.contains("why: duplicate records from a legacy edit."),
        "the why block must be preserved:\n{span}"
    );
    Ok(())
}

/// An unparseable new address fails before any mutation.
#[test]
fn replace_invalid_new_address_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;
    let before = span_bytes(&repo, "test/race")?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L"])?;
    assert_eq!(out.status.code(), Some(1), "invalid new address must fail");
    assert_eq!(
        span_bytes(&repo, "test/race")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

/// The new target must pass the same filtered-content gate as `add`: a
/// gitignored path is permanently unresolvable through git's layers.
#[test]
fn replace_gitignored_new_anchor_rejected() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("doc.md", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("seed doc")?;
    repo.write_file("generated.ts", "gen1\ngen2\ngen3\ngen4\ngen5\n")?;
    repo.write_file(".gitignore", "generated.ts\n")?;
    repo.commit_all("ignore generated.ts")?;

    repo.span_stdout(["add", "ignored-demo", "doc.md#L1-L5"])?;
    let before = span_bytes(&repo, "ignored-demo")?;

    let out = repo.run_span(["replace", "ignored-demo", "doc.md#L1-L5", "generated.ts#L1-L5"])?;
    assert!(
        !out.status.success(),
        "replace must reject a gitignored new target; got {:?}",
        out.status.code()
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("gitignored"),
        "reject message must name the gitignore cause; stderr:\n{stderr}"
    );
    assert_eq!(
        span_bytes(&repo, "ignored-demo")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

/// A nonexistent new path is rejected up front.
#[test]
fn replace_nonexistent_new_path_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;
    let before = span_bytes(&repo, "test/race")?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "nope.txt#L1-L5"])?;
    assert_eq!(out.status.code(), Some(1), "nonexistent new path must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("nope.txt") && stderr.contains("does not exist"),
        "the diagnostic must name the path and the cause, got: {stderr}"
    );
    assert_eq!(
        span_bytes(&repo, "test/race")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

/// A swap onto an identity the span already tracks is refused: two
/// same-identity records (the writer sorts but does not dedupe) would be
/// *created* by the swap. That is a different concern from resolving a
/// duplicate that pre-exists at the old identity
/// (`replace_duplicate_old_records_resolved`) — this check keeps `replace`
/// from manufacturing the state that one repairs.
#[test]
fn replace_new_identity_already_tracked_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    let before = span_bytes(&repo, "test/race")?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    assert_eq!(out.status.code(), Some(1), "already-tracked new identity must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("file1.txt#L6-L10") && stderr.contains("test/race"),
        "the diagnostic must name the new identity and span, got: {stderr}"
    );
    assert_eq!(
        span_bytes(&repo, "test/race")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

/// A new range beyond the file's line count is rejected (the same
/// `add`-time extent check).
#[test]
fn replace_new_range_exceeds_line_count_rejected() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;
    let before = span_bytes(&repo, "test/race")?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L9-L11"])?;
    assert_eq!(out.status.code(), Some(1), "out-of-range new anchor must fail");
    assert_eq!(
        span_bytes(&repo, "test/race")?,
        before,
        "a rejected replace must not touch the declaration"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Concurrency — no lost update
// ---------------------------------------------------------------------------

/// A replace and an add racing on the same span both land: the span lock
/// serializes the read-modify-write cycles. Mirrors the
/// `concurrent_add_race` model (no Barrier — see that test's note about
/// the shared temp-file name).
#[test]
fn concurrent_replace_and_add_no_lost_update() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;

    let repo_path = repo.path().to_path_buf();

    // Worker 1: replaces file1.txt#L1-L5 with file1.txt#L6-L10.
    let rp1 = repo_path.clone();
    let t1 = std::thread::spawn(move || -> Result<()> {
        let gix_repo = gix::open(&rp1)?;
        let args = git_span::cli::ReplaceArgs {
            name: "test/race".into(),
            old_anchor: "file1.txt#L1-L5".into(),
            new_anchor: "file1.txt#L6-L10".into(),
            format: git_span::cli::ReplaceFormat::Human,
        };
        run_replace(&gix_repo, args, ".span")?;
        Ok(())
    });

    // Worker 2: adds file2.txt#L1-L5 to the same span.
    let rp2 = repo_path.clone();
    let t2 = std::thread::spawn(move || -> Result<()> {
        let gix_repo = gix::open(&rp2)?;
        let args = AddArgs {
            name: "test/race".into(),
            anchors: vec!["file2.txt#L1-L5".into()],
            at: None,
            format: AddFormat::Human,
        };
        run_add(&gix_repo, args, ".span")?;
        Ok(())
    });

    let r1 = t1.join().unwrap();
    let r2 = t2.join().unwrap();
    assert!(r1.is_ok(), "replace worker failed: {r1:?}");
    assert!(r2.is_ok(), "add worker failed: {r2:?}");

    let span = String::from_utf8(span_bytes(&repo, "test/race")?.unwrap())?;
    assert!(
        span.contains("file1.txt#L6-L10"),
        "replaced anchor missing after concurrent add:\n{span}"
    );
    assert!(
        span.contains("file2.txt#L1-L5"),
        "concurrent add missing after replace:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L5"),
        "superseded identity must be retired:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------

/// `--format json` carries the same state as the human report.
#[test]
fn replace_json_output_carries_state() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5"])?;

    let out = repo.run_span([
        "replace",
        "test/race",
        "file1.txt#L1-L5",
        "file1.txt#L6-L10",
        "--format",
        "json",
    ])?;
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let v: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(v["span"], "test/race");
    assert_eq!(v["retired"], "file1.txt#L1-L5");
    assert_eq!(v["installed"], "file1.txt#L6-L10");
    assert_eq!(v["drift_free"], true);
    Ok(())
}

/// Replacing one anchor preserves the other anchor's drift state, and the
/// structured drift report identifies that untouched anchor independently of
/// the replace command's human wording.
#[test]
fn replace_preserves_and_structurally_reports_other_anchor_drift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "test/race", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    // Drift the second anchor: change content inside its anchored range.
    repo.write_file(
        "file2.txt",
        "line1\nline2\nCHANGED\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\n",
    )?;

    let out = repo.run_span(["replace", "test/race", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    assert!(
        out.status.success(),
        "replace failed (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("file2.txt"),
        "the report must name the drifted anchor, got: {stdout}"
    );
    assert!(
        stdout.contains("drift"),
        "the report must say the span is not drift-free, got: {stdout}"
    );

    let declaration = String::from_utf8(span_bytes(&repo, "test/race")?.unwrap())?;
    assert!(declaration.contains("file1.txt#L6-L10"));
    assert!(!declaration.contains("file1.txt#L1-L5"));
    assert!(declaration.contains("file2.txt#L1-L5"));

    let drift = repo.run_span(["drift", "test/race", "--format=json"])?;
    assert_eq!(drift.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&drift.stdout)?;
    let findings = report["findings"].as_array().expect("findings array");
    assert!(findings.iter().any(|finding| {
        finding["status"]["code"] == "CHANGED"
            && finding["anchored"]["path"] == "file2.txt"
    }), "structured report must attribute drift to untouched file2 anchor: {report}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------

/// `replace` is a reserved token: it cannot be used as a span name, and
/// `git span replace` routes to the subcommand (clap usage error, not a
/// span-not-found).
#[test]
fn replace_is_reserved_span_name() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // As a span name, `replace` is refused.
    let out = repo.run_span(["add", "replace", "file1.txt#L1-L5"])?;
    assert_eq!(out.status.code(), Some(1), "span named `replace` must be refused");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.to_lowercase().contains("reserved"),
        "the refusal must say the name is reserved, got: {stderr}"
    );

    // As a subcommand, `replace` is clap-routed: missing required args is
    // a usage error (exit 2), not a missing span (exit 1).
    let out = repo.run_span(["replace"])?;
    assert_eq!(out.status.code(), Some(2), "bare `replace` must be a usage error");
    Ok(())
}
