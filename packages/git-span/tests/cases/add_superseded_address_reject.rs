//! Rejection of content-identity supersession during `git span add`.
//!
//! `add` writes a record at the requested address and leaves any existing
//! record for the same logical region at its old address in place. The two
//! records are different identities, so every same-identity sweep is
//! structurally blind to the accumulation, and while both addresses read
//! clean the residue is reported nowhere. The card makes `add` reject a
//! requested anchor whose freshly computed content hash equals the stored
//! hash of an existing (or co-requested) anchor at a *different* address on
//! the same path — the strongest available duplicate signal, and the
//! signature every observed superseded-address cluster exhibited.
//!
//! Boundaries that must keep working: the same-address refresh (`unchanged`
//! / `resolved in-place`), a second range whose content hashes differently,
//! and identical content on a *different* path (a span may deliberately
//! couple the same contract text anchored in source and in tests — a region
//! lives in one file, so the rejection is same-path only).
//!
//! Modeled on `add_superseding_overlap_reject.rs` (the `TestRepo` harness).

use crate::support;

use anyhow::Result;
use std::fs;
use support::TestRepo;

/// Read `.span/<name>` from `repo` as bytes.
fn span_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    Ok(fs::read(repo.path().join(".span").join(name))?)
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

// ---------------------------------------------------------------------------
// (1) Same path, same content hash, different address → rejected
// ---------------------------------------------------------------------------

/// Re-anchoring a region to a second address whose content hashes
/// identically to an existing anchor's stored hash must be rejected before
/// any write: exit 1, stderr names both canonical addresses and contains
/// the exact shell-quoted `git span replace` and `git span remove`
/// remediation commands, and the span file stays byte-identical.
#[test]
fn add_superseded_address_reject_duplicate_content() -> Result<()> {
    let repo = TestRepo::new()?;
    write_duplicated_seed(&repo)?;

    let first = repo.run_span(["add", "demo", "src/a.rs#L5-L7"])?;
    assert!(
        first.status.success(),
        "the first add must succeed; exit {:?}\nstderr:\n{}",
        first.status.code(),
        String::from_utf8_lossy(&first.stderr)
    );
    let before = span_bytes(&repo, "demo")?;

    let out = repo.run_span(["add", "demo", "src/a.rs#L50-L52"])?;
    assert!(
        !out.status.success(),
        "add must reject an address whose content hashes identically to an \
         existing anchor at a different address; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`src/a.rs#L50-L52`"),
        "stderr must name the requested canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("`src/a.rs#L5-L7`"),
        "stderr must name the existing canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span replace demo 'src/a.rs#L5-L7' 'src/a.rs#L50-L52'"),
        "stderr must contain the exact quoted replace command; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span remove demo 'src/a.rs#L5-L7'"),
        "stderr must contain the exact quoted remove command; stderr:\n{stderr}"
    );

    let after = span_bytes(&repo, "demo")?;
    assert_eq!(
        before, after,
        "a rejected add must leave `.span/demo` byte-identical"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (2) Re-anchor after a content shift → rejected
// ---------------------------------------------------------------------------

/// The observed failure shape: content shifts, the operator re-anchors the
/// same region at its new address, and the old record is left behind as
/// permanent residue. The new address's content hashes to the old record's
/// stored hash, so the add must be rejected with the remediation commands
/// instead of writing the second record.
#[test]
fn add_superseded_address_reject_after_content_shift() -> Result<()> {
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
    let before = span_bytes(&repo, "demo")?;

    // Insert a line at the top; the region moves from L5-L7 to L6-L8.
    repo.write_file(
        "src/a.rs",
        "NEW\nl1\nl2\nl3\nl4\nALPHA\nBETA\nGAMMA\nl8\nl9\nl10\n",
    )?;
    repo.commit_all("shift")?;

    let out = repo.run_span(["add", "demo", "src/a.rs#L6-L8"])?;
    assert!(
        !out.status.success(),
        "add must reject the re-anchored address instead of writing the \
         second record; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`src/a.rs#L6-L8`"),
        "stderr must name the requested canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("`src/a.rs#L5-L7`"),
        "stderr must name the existing canonical address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span replace demo 'src/a.rs#L5-L7' 'src/a.rs#L6-L8'"),
        "stderr must contain the exact quoted replace command; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git span remove demo 'src/a.rs#L5-L7'"),
        "stderr must contain the exact quoted remove command; stderr:\n{stderr}"
    );

    let after = span_bytes(&repo, "demo")?;
    assert_eq!(
        before, after,
        "a rejected add must leave `.span/demo` byte-identical"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (3) Both addresses in one invocation → rejected all-or-nothing
// ---------------------------------------------------------------------------

/// Two requested anchors for the same path whose content hashes collide must
/// fail the whole invocation: exit 1, both requested addresses named, and no
/// span file written at all.
#[test]
fn add_superseded_address_reject_co_requested_pair() -> Result<()> {
    let repo = TestRepo::new()?;
    write_duplicated_seed(&repo)?;

    let out = repo.run_span(["add", "demo", "src/a.rs#L5-L7", "src/a.rs#L50-L52"])?;
    assert!(
        !out.status.success(),
        "a co-requested pair of identical-hash addresses must be rejected; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "rejection must exit 1");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`src/a.rs#L5-L7`"),
        "stderr must name the first requested address; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("`src/a.rs#L50-L52`"),
        "stderr must name the second requested address; stderr:\n{stderr}"
    );
    assert!(
        !repo.path().join(".span").join("demo").exists(),
        "an all-or-nothing rejection must not create the span file"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// (4) Exact identity → refresh keeps working
// ---------------------------------------------------------------------------

/// Re-adding the identical anchor is the supported refresh operation and
/// must not be confused with a superseded address: unchanged content reports
/// `unchanged`, and mutated content resolves in place — both exit 0.
#[test]
fn add_superseded_address_reject_exact_identity_refresh_still_succeeds() -> Result<()> {
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
    Ok(())
}

// ---------------------------------------------------------------------------
// (5) Different content at a different address → keeps working
// ---------------------------------------------------------------------------

/// A second range on the same path whose content hashes differently is a
/// legitimate additional anchor and must keep working — content identity,
/// not overlap, is the signal.
#[test]
fn add_superseded_address_reject_different_content_succeeds() -> Result<()> {
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
    Ok(())
}

// ---------------------------------------------------------------------------
// (6) Identical content on a different path → keeps working
// ---------------------------------------------------------------------------

/// Identical content at a different *path* is a legitimate coupling (the
/// same contract text anchored in source and in tests), not a superseded
/// address — a region lives in one file, so the rejection is same-path only.
#[test]
fn add_superseded_address_reject_different_path_succeeds() -> Result<()> {
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
    Ok(())
}
