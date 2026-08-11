//! Regression tests for card main-229: the bare (no-args) `git span drift`
//! scan omits a span entirely once it has zero `ActionableDrift` anchors —
//! every anchor `Fresh`, `ResolvedPendingCommit`, or a mix of the two — the
//! same way an all-`Fresh` span was already omitted. A span with at least
//! one genuine `ActionableDrift` anchor still prints in full, including any
//! sibling `ResolvedPendingCommit`/`Fresh` rows. Scoped (`drift <name>`)
//! queries and the other output modes (`--stat`, `--oneline`, JSON) stay
//! consistent with the new inclusion boundary.
//!
//! `ResolvedPendingCommit` setup is inherently a two-phase, whole-repo
//! operation: `git commit` commits the entire index, so leaving one span's
//! source edit deliberately uncommitted (phase 2) and then running another
//! helper that commits (phase 1 for a *different* span) would sweep the
//! first span's pending edit into HEAD and silently turn it `Fresh`. Every
//! test below therefore runs all phase-1 (committed) setup for every span
//! first, and only performs phase-2 (uncommitted re-anchor) edits last, with
//! no commits in between.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Phase 1: commit a fresh `path` (n lines) as its own commit, then anchor
/// `span` to `L1-L5` on it in a second, span-only commit — mirroring the
/// two-commit shape (content commit, then span commit)
/// `drift_resolved_pending_commit.rs` uses, which `ResolvedPendingCommit`
/// detection's HEAD-history walk relies on. Left alone, the anchor resolves
/// `Fresh`.
fn commit_anchor(repo: &TestRepo, span: &str, path: &str, lines: u32) -> Result<()> {
    repo.write_file_lines(path, lines)?;
    repo.commit_all(&format!("add {path}"))?;
    repo.run_span(["add", span, &format!("{path}#L1-L5")])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", format!("seed {span} anchor on {path}").as_str()])?;
    Ok(())
}

/// Phase 2: given an anchor already committed by [`commit_anchor`] on a
/// >=7-line `path`, re-anchor it against an unstaged, un-committed prepend
/// so it resolves `ResolvedPendingCommit` (the span file matches the
/// worktree; only the source commit is pending). Performs no commit, so it
/// is safe to call for several spans back-to-back as the last step of a
/// test's setup.
fn reanchor_to_pending_commit(repo: &TestRepo, span: &str, path: &str) -> Result<()> {
    let content = std::fs::read_to_string(repo.path().join(path))?;
    repo.write_file(path, &format!("prefix1\nprefix2\n{content}"))?;
    repo.run_span(["remove", span, &format!("{path}#L1-L5")])?;
    repo.run_span(["add", span, &format!("{path}#L3-L7")])?;
    repo.run_git(["add", ".span"])?;
    Ok(())
}

/// Phase 1 variant: commit a fresh 5-line `path`, anchor `span` to `L1-L5`,
/// then commit an in-place edit inside the anchored range (same position,
/// different bytes) so it resolves `Changed` — genuine `ActionableDrift`.
fn commit_actionable_changed_anchor(repo: &TestRepo, span: &str, path: &str) -> Result<()> {
    commit_anchor(repo, span, path, 5)?;
    repo.write_file(path, "line1\nCHANGED\nline3\nline4\nline5\n")?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", format!("edit {path}").as_str()])?;
    Ok(())
}

/// (a) A span whose only anchor is `ResolvedPendingCommit` is absent from a
/// bare scan; the scan reports "0 drift" and exits 0.
#[test]
fn bare_scan_omits_span_with_only_pending_commit_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    commit_anchor(&repo, "pending", "pending.txt", 10)?;
    reanchor_to_pending_commit(&repo, "pending", "pending.txt")?;

    // Sanity: confirm the scoped query really is ResolvedPendingCommit, not
    // vacuously Fresh, before trusting the bare-scan omission below.
    let scoped = repo.run_span(["drift", "pending"])?;
    assert!(
        String::from_utf8_lossy(&scoped.stdout).contains("resolved, pending commit"),
        "setup sanity check failed: `pending` must resolve ResolvedPendingCommit"
    );

    let out = repo.run_span(["drift"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("## pending"),
        "pending-only span must not print in a bare scan; got:\n{stdout}"
    );
    assert!(
        stdout.contains("0 drift"),
        "bare scan with no actionable drift must report '0 drift'; got:\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "exit code must be 0");
    Ok(())
}

/// (b) A span mixing one `Fresh` anchor and one `ResolvedPendingCommit`
/// anchor is also absent from the bare scan.
#[test]
fn bare_scan_omits_span_mixing_fresh_and_pending_commit_anchors() -> Result<()> {
    let repo = TestRepo::new()?;
    commit_anchor(&repo, "mixed", "mixed_fresh.txt", 5)?;
    commit_anchor(&repo, "mixed", "mixed_pending.txt", 10)?;
    reanchor_to_pending_commit(&repo, "mixed", "mixed_pending.txt")?;

    let out = repo.run_span(["drift"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.contains("## mixed"),
        "mixed Fresh+ResolvedPendingCommit span must not print in a bare scan; got:\n{stdout}"
    );
    assert!(
        stdout.contains("0 drift"),
        "bare scan with no actionable drift must report '0 drift'; got:\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "exit code must be 0");
    Ok(())
}

/// (c) Control: a span with one genuine `ActionableDrift` anchor plus
/// `ResolvedPendingCommit`/`Fresh` siblings still prints in full — heading
/// and every anchor row, including the informational and fresh ones — while
/// sibling pending/mixed spans stay omitted from the same bare scan. Exit
/// code reflects the remaining actionable drift.
#[test]
fn bare_scan_still_shows_full_span_with_actionable_drift_alongside_omitted_siblings() -> Result<()>
{
    let repo = TestRepo::new()?;
    // Phase 1 (committed) setup for every span first.
    commit_anchor(&repo, "pending", "pending.txt", 10)?;
    commit_anchor(&repo, "mixed", "mixed_fresh.txt", 5)?;
    commit_anchor(&repo, "mixed", "mixed_pending.txt", 10)?;
    commit_actionable_changed_anchor(&repo, "control", "control_changed.txt")?;
    commit_anchor(&repo, "control", "control_fresh.txt", 5)?;
    commit_anchor(&repo, "control", "control_pending.txt", 10)?;
    // Phase 2 (uncommitted) re-anchors last, nothing commits after this.
    reanchor_to_pending_commit(&repo, "pending", "pending.txt")?;
    reanchor_to_pending_commit(&repo, "mixed", "mixed_pending.txt")?;
    reanchor_to_pending_commit(&repo, "control", "control_pending.txt")?;

    let out = repo.run_span(["drift"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert!(
        !stdout.contains("## pending"),
        "pending-only span must stay omitted; got:\n{stdout}"
    );
    assert!(
        !stdout.contains("## mixed"),
        "mixed Fresh+ResolvedPendingCommit span must stay omitted; got:\n{stdout}"
    );
    assert!(
        stdout.contains("## control"),
        "control span with actionable drift must still print; got:\n{stdout}"
    );
    assert!(
        stdout.contains("control_changed.txt"),
        "control span's actionable anchor row must print; got:\n{stdout}"
    );
    assert!(
        stdout.contains("control_pending.txt") && stdout.contains("resolved, pending commit"),
        "control span's ResolvedPendingCommit sibling row must still print; got:\n{stdout}"
    );
    assert!(
        stdout.contains("control_fresh.txt"),
        "control span's Fresh sibling row must still print; got:\n{stdout}"
    );
    assert_eq!(
        out.status.code(),
        Some(1),
        "exit code must reflect the control span's actionable drift"
    );
    Ok(())
}

/// (d) Named/scoped queries (`drift <name>`) are unaffected: a
/// pending-only span and a fresh+pending mixed span both still show when
/// queried by name, regardless of drift state.
#[test]
fn scoped_named_query_still_shows_pending_and_mixed_spans() -> Result<()> {
    let repo = TestRepo::new()?;
    commit_anchor(&repo, "pending", "pending.txt", 10)?;
    commit_anchor(&repo, "mixed", "mixed_fresh.txt", 5)?;
    commit_anchor(&repo, "mixed", "mixed_pending.txt", 10)?;
    reanchor_to_pending_commit(&repo, "pending", "pending.txt")?;
    reanchor_to_pending_commit(&repo, "mixed", "mixed_pending.txt")?;

    let pending_out = repo.run_span(["drift", "pending"])?;
    let pending_stdout = String::from_utf8_lossy(&pending_out.stdout);
    assert!(
        pending_stdout.contains("resolved, pending commit"),
        "named query for a pending-only span must still show it; got:\n{pending_stdout}"
    );
    assert_eq!(
        pending_out.status.code(),
        Some(0),
        "ResolvedPendingCommit must not drive a non-zero exit"
    );

    let mixed_out = repo.run_span(["drift", "mixed"])?;
    let mixed_stdout = String::from_utf8_lossy(&mixed_out.stdout);
    assert!(
        mixed_stdout.contains("mixed_fresh.txt") && mixed_stdout.contains("mixed_pending.txt"),
        "named query for a mixed span must still show both anchors; got:\n{mixed_stdout}"
    );
    assert_eq!(mixed_out.status.code(), Some(0), "exit code must be 0");
    Ok(())
}

/// (e) The other bare-scan output modes stay consistent with the new
/// inclusion boundary: `--stat`, `--oneline`, and `--format json` all omit a
/// pending-only span from a bare scan too, since they derive from the same
/// filtered span set as the human renderer.
#[test]
fn bare_scan_other_formats_omit_pending_only_span() -> Result<()> {
    let repo = TestRepo::new()?;
    commit_anchor(&repo, "pending", "pending.txt", 10)?;
    commit_actionable_changed_anchor(&repo, "control", "control_changed.txt")?;
    reanchor_to_pending_commit(&repo, "pending", "pending.txt")?;

    let stat_out = repo.run_span(["drift", "--stat", "--no-exit-code"])?;
    let stat_stdout = String::from_utf8_lossy(&stat_out.stdout);
    assert!(
        !stat_stdout.contains("pending"),
        "--stat must omit the pending-only span; got:\n{stat_stdout}"
    );

    let oneline_out = repo.run_span(["drift", "--oneline", "--no-exit-code"])?;
    let oneline_stdout = String::from_utf8_lossy(&oneline_out.stdout);
    assert!(
        !oneline_stdout.contains("pending.txt"),
        "--oneline must omit the pending-only span's anchor; got:\n{oneline_stdout}"
    );

    let json_out = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json_stdout = String::from_utf8_lossy(&json_out.stdout);
    let json: serde_json::Value = serde_json::from_str(&json_stdout)?;
    let findings = json["findings"].as_array().expect("findings array");
    assert!(
        findings
            .iter()
            .all(|f| f["span"].as_str() != Some("pending")),
        "JSON findings must omit the pending-only span; got:\n{json_stdout}"
    );
    assert!(
        findings.iter().any(|f| f["span"].as_str() == Some("control")),
        "JSON findings must still include the control span; got:\n{json_stdout}"
    );

    Ok(())
}
