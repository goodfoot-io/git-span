//! Reporting of content-identity supersession during `git span add`.
//!
//! `add` writes a record at the requested address and leaves any existing
//! record for the same logical region at its old address in place. The two
//! records are different identities, so every same-identity sweep is
//! structurally blind to the accumulation, and while both addresses read
//! clean the residue is reported nowhere. The card makes `add` *report*
//! when a requested anchor's freshly computed content hash equals the
//! stored hash of an existing (or co-requested) anchor at a *different*
//! address on the same path — the strongest available duplicate signal,
//! and the signature every observed superseded-address cluster exhibited.
//!
//! The report is a channel, not a refusal: two genuinely distinct blocks
//! with byte-identical content are a legitimate pairing (a span may
//! deliberately track two identical blocks), so the add still succeeds and
//! writes both records. The report names both canonical addresses and the
//! shell-quoted `git span replace` / `git span remove` remediation, so an
//! operator who *was* re-anchoring can collapse the pair immediately.
//!
//! Boundaries that must stay quiet: the same-address refresh (`unchanged`
//! / `resolved in-place`), a second range whose content hashes
//! differently, and identical content on a *different* path (a span may
//! deliberately couple the same contract text anchored in source and in
//! tests — a region lives in one file, so the report is same-path only).
//!
//! Modeled on `add_superseding_overlap_reject.rs` (the `TestRepo` harness).

use crate::support;

use anyhow::Result;
use std::fs;
use support::TestRepo;

/// Read `.span/<name>` from `repo` as text.
fn span_text(repo: &TestRepo, name: &str) -> Result<String> {
    Ok(fs::read_to_string(repo.path().join(".span").join(name))?)
}

/// The seed for the duplicated-content cases: 100 numbered lines with
/// `ALPHA BETA GAMMA` at L5-L7 and an identical copy at L50-L52, so both
/// addresses hash identically while each reads clean.
fn write_duplicated_seed(repo: &TestRepo) -> Result<String> {
    let mut lines: Vec<String> = (1..=100).map(|i| format!("line{i}")).collect();
    lines[4..7].clone_from_slice(&["ALPHA".to_string(), "BETA".to_string(), "GAMMA".to_string()]);
    lines[49..52].clone_from_slice(&["ALPHA".to_string(), "BETA".to_string(), "GAMMA".to_string()]);
    repo.write_file("src/a.rs", &format!("{}\n", lines.join("\n")))?;
    repo.commit_all("seed")
}

/// Assert `out` carries the existing-record pairing report: exit 0 (a
/// report, not a refusal), both canonical addresses named, the exact
/// shell-quoted `replace` and `remove` remediation commands, and the span
/// file recording both addresses afterwards.
fn assert_existing_pairing_report(
    repo: &TestRepo,
    out: &std::process::Output,
    requested: &str,
    existing: &str,
) {
    assert!(
        out.status.success(),
        "identical content at a second address is a legal pairing and must \
         succeed; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Content-identity pairing"),
        "stdout must report the pairing; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(&format!("`{requested}`")),
        "stdout must name the requested canonical address; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(&format!("`{existing}`")),
        "stdout must name the existing canonical address; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(&format!(
            "git span replace demo '{existing}' '{requested}'"
        )),
        "stdout must contain the exact quoted replace command; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(&format!("git span remove demo '{existing}'")),
        "stdout must contain the exact quoted remove command; stdout:\n{stdout}"
    );
    let span = span_text(repo, "demo").expect("span file must exist");
    assert!(
        span.contains(requested),
        "the span file must record the requested address; span:\n{span}"
    );
    assert!(
        span.contains(existing),
        "the span file must keep the existing address; span:\n{span}"
    );
}

// ---------------------------------------------------------------------------
// (1) Same path, same content hash, different address → reported
// ---------------------------------------------------------------------------

/// Re-anchoring a region to a second address whose content hashes
/// identically to an existing anchor's stored hash must still succeed —
/// twins are legal — but the output must report the pairing: both
/// canonical addresses, and the exact shell-quoted `git span replace` and
/// `git span remove` remediation commands, while the span file records
/// both addresses.
#[test]
fn add_superseded_address_reports_duplicate_content() -> Result<()> {
    let repo = TestRepo::new()?;
    write_duplicated_seed(&repo)?;

    let first = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );
    let first_stdout = String::from_utf8_lossy(&first.stdout);
    assert!(
        !first_stdout.contains("Content-identity pairing"),
        "a first add has nothing to pair against; stdout:\n{first_stdout}"
    );

    let out = repo.run_span(["add", "demo", "src/a.rs#L50-L52"])?;
    assert_existing_pairing_report(&repo, &out, "src/a.rs#L50-L52", "src/a.rs#L5-L7");
    Ok(())
}

// ---------------------------------------------------------------------------
// (2) Re-anchor after a content shift → reported
// ---------------------------------------------------------------------------

/// The observed failure shape: content shifts, the operator re-anchors the
/// same region at its new address, and the old record is left behind as
/// permanent residue. The new address's content hashes to the old record's
/// stored hash, so the add must report the pairing with the remediation
/// commands instead of writing the second record in silence. The old
/// address has also *drifted* (the region moved out from under it), so the
/// post-write reconcile check still exits 1 — the pairing report is the
/// new channel, the drift exit code is the existing one.
#[test]
fn add_superseded_address_reports_after_content_shift() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "src/a.rs",
        "l1\nl2\nl3\nl4\nALPHA\nBETA\nGAMMA\nl8\nl9\nl10\n",
    )?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    // Insert a line at the top; the region moves from L5-L7 to L6-L8.
    repo.write_file(
        "src/a.rs",
        "NEW\nl1\nl2\nl3\nl4\nALPHA\nBETA\nGAMMA\nl8\nl9\nl10\n",
    )?;
    repo.commit_all("shift")?;

    let out = repo.run_span(["add", "demo", "src/a.rs#L6-L8"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "the old address has drifted, so the reconcile check exits 1; stdout:\n{}",
        String::from_utf8_lossy(&out.stdout)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Content-identity pairing"),
        "stdout must report the pairing; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`src/a.rs#L6-L8`"),
        "stdout must name the requested canonical address; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`src/a.rs#L5-L7`"),
        "stdout must name the existing canonical address; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("git span replace demo 'src/a.rs#L5-L7' 'src/a.rs#L6-L8'"),
        "stdout must contain the exact quoted replace command; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("git span remove demo 'src/a.rs#L5-L7'"),
        "stdout must contain the exact quoted remove command; stdout:\n{stdout}"
    );
    let span = span_text(&repo, "demo")?;
    assert!(
        span.contains("src/a.rs#L6-L8"),
        "the span file must record the requested address; span:\n{span}"
    );
    assert!(
        span.contains("src/a.rs#L5-L7"),
        "the span file must keep the existing address; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (3) Both addresses in one invocation → both written, pairing reported
// ---------------------------------------------------------------------------

/// Two requested anchors for the same path whose content hashes collide
/// must both be written (twins are legal in one invocation too), with the
/// output naming both requested addresses in the pairing report.
#[test]
fn add_superseded_address_reports_co_requested_pair() -> Result<()> {
    let repo = TestRepo::new()?;
    write_duplicated_seed(&repo)?;

    let out = repo.run_span(["add", "demo", "src/a.rs#L5-L7", "src/a.rs#L50-L52"])?;
    assert!(
        out.status.success(),
        "a co-requested pair of identical-hash addresses is a legal pairing \
         and must succeed; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Content-identity pairing"),
        "stdout must report the pairing; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`src/a.rs#L5-L7`"),
        "stdout must name the first requested address; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`src/a.rs#L50-L52`"),
        "stdout must name the second requested address; stdout:\n{stdout}"
    );
    let span = span_text(&repo, "demo")?;
    assert!(
        span.contains("src/a.rs#L5-L7"),
        "the span file must record the first address; span:\n{span}"
    );
    assert!(
        span.contains("src/a.rs#L50-L52"),
        "the span file must record the second address; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (4) Exact identity → refresh stays quiet
// ---------------------------------------------------------------------------

/// Re-adding the identical anchor is the supported refresh operation and
/// must not produce a pairing report: unchanged content reports
/// `unchanged`, and mutated content resolves in place — both exit 0, both
/// silent about pairings.
#[test]
fn add_superseded_address_report_exact_identity_refresh_stays_quiet() -> Result<()> {
    let repo = TestRepo::new()?;
    write_duplicated_seed(&repo)?;

    let first = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    // Identical re-add — content unchanged → "unchanged".
    let second = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        second.status.success(),
        "an identical re-add must succeed; exit {:?}\nstderr:\n{}",
        second.status.code(),
        String::from_utf8_lossy(&second.stderr)
    );
    let stdout = String::from_utf8_lossy(&second.stdout);
    assert!(
        stdout.contains("unchanged"),
        "an identical re-add must report `unchanged`; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("Content-identity pairing"),
        "an exact-identity refresh is not a pairing; stdout:\n{stdout}"
    );

    // Mutate the region in place, re-add — identity refresh resolves.
    let mut lines: Vec<String> = (1..=100).map(|i| format!("line{i}")).collect();
    lines[4..7].clone_from_slice(&["ALPHA2".to_string(), "BETA2".to_string(), "GAMMA2".to_string()]);
    lines[49..52].clone_from_slice(&["ALPHA".to_string(), "BETA".to_string(), "GAMMA".to_string()]);
    repo.write_file("src/a.rs", &format!("{}\n", lines.join("\n")))?;
    let third = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        third.status.success(),
        "an identity refresh after mutation must succeed; exit {:?}\nstderr:\n{}",
        third.status.code(),
        String::from_utf8_lossy(&third.stderr)
    );
    let stdout = String::from_utf8_lossy(&third.stdout);
    assert!(
        stdout.contains("resolved in-place"),
        "an identity refresh after mutation must report `resolved in-place`; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("Content-identity pairing"),
        "an exact-identity refresh is not a pairing; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (5) Different content at a different address → stays quiet
// ---------------------------------------------------------------------------

/// A second range on the same path whose content hashes differently is a
/// legitimate additional anchor and must keep working without a report —
/// content identity, not overlap, is the signal.
#[test]
fn add_superseded_address_report_different_content_stays_quiet() -> Result<()> {
    let repo = TestRepo::new()?;
    let mut lines: Vec<String> = (1..=100).map(|i| format!("line{i}")).collect();
    lines[4..7].clone_from_slice(&["ALPHA".to_string(), "BETA".to_string(), "GAMMA".to_string()]);
    lines[49..52].clone_from_slice(&["XRAY".to_string(), "YANKEE".to_string(), "ZULU".to_string()]);
    repo.write_file("src/a.rs", &format!("{}\n", lines.join("\n")))?;
    repo.commit_all("seed")?;

    let first = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    let out = repo.run_span(["add", "demo", "src/a.rs#L50-L52"])?;
    assert!(
        out.status.success(),
        "distinct content at a second address must keep working; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("Content-identity pairing"),
        "distinct content is not a pairing; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (6) Identical content on a different path → stays quiet
// ---------------------------------------------------------------------------

/// Identical content at a different *path* is a legitimate coupling (the
/// same contract text anchored in source and in tests), not a superseded
/// address — a region lives in one file, so the report is same-path only.
#[test]
fn add_superseded_address_report_different_path_stays_quiet() -> Result<()> {
    let repo = TestRepo::new()?;
    write_duplicated_seed(&repo)?;
    repo.write_file("src/b.rs", "ALPHA\nBETA\nGAMMA\n")?;
    repo.commit_all("add b")?;

    let first = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );

    let out = repo.run_span(["add", "demo", "src/b.rs#L1-L3"])?;
    assert!(
        out.status.success(),
        "identical content on a second path must keep working; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("Content-identity pairing"),
        "identical content on a different path is not a pairing; stdout:\n{stdout}"
    );
    Ok(())
}
