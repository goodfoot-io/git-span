//! CLI: positional `git span stale <path>` visibility for clean spans.
//!
//! Every `git span stale` invocation is a drift report, scoped or not. A
//! no-argument workspace scan omits fully-clean spans, and a scoped query
//! (a path, glob, or an explicit span name) does the same: only stale spans
//! render, in every format. A scoped query that finds nothing stale prints a
//! "0 stale across N spans (A anchors checked)" summary so the operator gets
//! explicit "checked, all clean" feedback instead of empty output.
//!
//! The machine formats (JSON, porcelain, …) likewise carry only drift
//! findings. The leak this suite also guards is the JSON envelope's top-level
//! `span` field, which is `spans.first()`: when a clean path-resolved span
//! sorts ahead of the drifted one, the machine envelope must still name the
//! drifted span, never the clean one.

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

/// Build a fixture where, for `file1.txt`, the path index resolves two
/// spans:
///   * `clean-span` — anchors `aaa.txt#L1-L5` and `file1.txt#L6-L10`; both
///     stay Fresh under `drift`. The `aaa.txt` anchor makes its sorted path
///     tuple `[aaa.txt, file1.txt]`, which sorts ahead of `drifted-span`'s
///     `[file1.txt]`, so `clean-span` becomes `spans.first()`.
///   * `drifted-span` — anchors `file1.txt#L1-L5`; drifts when line 1 is
///     edited.
fn seed_fixture(repo: &TestRepo) -> Result<()> {
    // A file that sorts before file1.txt, anchored only by the clean span.
    repo.write_file("aaa.txt", "a1\na2\na3\na4\na5\n")?;
    repo.run_git(["add", "aaa.txt"])?;
    repo.run_git(["commit", "-m", "add aaa.txt"])?;

    repo.span_stdout(["add", "clean-span", "aaa.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", "clean-span", "clean across two files"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "clean-span commit"])?;

    repo.span_stdout(["add", "drifted-span", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "drifted-span", "will drift"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "drifted-span commit"])?;
    Ok(())
}

/// File-backed drift: edit line 1 of file1.txt in the working tree. Only
/// `drifted-span`'s L1-L5 anchor drifts; `clean-span`'s L6-L10 and the
/// `aaa.txt` anchor stay Fresh.
fn drift(repo: &TestRepo) -> Result<()> {
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    Ok(())
}

/// A full-scan Human view is a drift report: it lists the drifted span and
/// omits the fully-clean one (main-92).
#[test]
fn full_scan_human_lists_only_drifted() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_span(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("drifted-span"),
        "full-scan Human must list the drifted span; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("clean-span"),
        "full-scan Human must omit the fully-clean span; stdout=\n{stdout}"
    );
    Ok(())
}

/// Positional Human mirrors the full-scan Human view: it is a drift report,
/// listing the drifted span and omitting the clean one.
#[test]
fn positional_human_drops_clean_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "file1.txt"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("drifted-span"),
        "positional Human must list the drifted span; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("clean-span"),
        "positional Human must omit the clean span; stdout=\n{stdout}"
    );
    Ok(())
}

/// Positional JSON filters clean spans: the envelope must name the drifted
/// span, never the clean one. This is the leak the card targets — a clean
/// path-resolved span that sorts first surfaces as `spans.first()` in the
/// JSON envelope.
#[test]
fn positional_json_drops_clean_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "file1.txt", "--format=json"])?;
    assert_eq!(out.status.code(), Some(1), "drift present → exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid json");
    assert_eq!(
        v["span"], "drifted-span",
        "JSON envelope must name the drifted span, not a clean one; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("clean-span"),
        "positional JSON must not mention the clean span; stdout=\n{stdout}"
    );
    Ok(())
}

/// Positional porcelain carries only drift findings — no clean span.
#[test]
fn positional_porcelain_drops_clean_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "file1.txt", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(1), "drift present → exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("file1.txt"),
        "porcelain must report the drifted anchor; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("clean-span"),
        "positional porcelain must not mention the clean span; stdout=\n{stdout}"
    );
    Ok(())
}

/// A direct span-name request is a drift report too: `stale clean-span`
/// renders no span block for a fully-Fresh span, prints the "0 stale"
/// summary instead, and exits 0.
#[test]
fn direct_named_clean_span_reports_zero_stale() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "clean-span"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("## clean-span"),
        "clean named span must not render a span block; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("0 stale across"),
        "clean named span must print the 0-stale summary; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "named clean span → exit 0");
    Ok(())
}
