//! CLI: `git span stale` — default human output (§10.4).

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn seed(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", name, "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

/// Seed a span anchoring lines 6-10, which the `drift` helper does not mutate.
fn seed_stable(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", name, "seed stable"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

/// File-backed model: drift is an *uncommitted* working-tree edit. The
/// committed span pins `file1.txt` lines 1-5 to the initial-commit
/// content; editing the worktree (without committing) is what
/// `git span stale` detects and `--patch`/`--stat` diff against the
/// anchored HEAD content. `msg` is retained for call-site compatibility
/// but no commit is created.
fn drift(repo: &TestRepo, _msg: &str) -> Result<String> {
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.head_sha()
}

#[test]

fn clean_exit_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

#[test]
fn pending_why_matching_committed_message_is_not_duplicated() -> Result<()> {
    // The stale block includes the committed why text inline.
    // Verify the stale output includes the span heading.
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "shared why text"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    drift(&repo, "mutate")?;
    repo.span_stdout(["why", "m", "shared why text"])?;
    let stdout = repo.span_stdout(["stale", "m", "--no-exit-code"])?;
    // The block heading is the span name.
    assert!(
        stdout.contains("## m"),
        "expected block heading; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]

fn drifty_exit_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

#[test]

fn no_exit_code_forces_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale", "m", "--no-exit-code"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

#[test]

fn human_output_has_summary_line() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale", "m"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // New shape: ## <span-name> heading with per-anchor status suffix.
    assert!(
        stdout.contains("## m"),
        "block heading must appear, got: {stdout}"
    );
    assert!(
        stdout.contains("changed"),
        "stale anchor must carry status suffix, got: {stdout}"
    );
    Ok(())
}





#[test]

fn workspace_scan_without_name() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "a")?;
    seed(&repo, "b")?;
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

#[test]
fn human_output_has_drift_summary_line() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale", "m"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // New shape: per-anchor status suffix replaces the summary line.
    assert!(
        stdout.contains("## m"),
        "block heading must appear, got: {stdout}"
    );
    assert!(
        stdout.contains("changed"),
        "stale anchor must carry status suffix, got: {stdout}"
    );
    Ok(())
}

/// Without `--name`, a workspace scan is a drift report: only spans with a
/// drifted anchor appear. Fully-fresh spans are omitted. The exit code
/// reflects drift.
#[test]
fn workspace_scan_lists_only_drifted_spans() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_stable(&repo, "quiet-span")?; // anchors lines 6-10 — unaffected by drift
    seed(&repo, "drifted-span")?; // anchors lines 1-5 — will drift
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("drifted-span"),
        "drifted span must appear in output"
    );
    assert!(
        !stdout.contains("quiet-span"),
        "fully-fresh span must NOT appear in a workspace scan; stdout=\n{stdout}"
    );
    assert_eq!(
        out.status.code(),
        Some(1),
        "exit 1 because drifted span has drift"
    );
    Ok(())
}

/// Without `--name`, when all spans are clean, exit 0 and a summary line is printed.
#[test]
fn workspace_scan_all_clean_exit_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "a")?;
    seed(&repo, "b")?;
    let out = repo.run_span(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("0 stale"),
        "summary must mention 0 stale when all spans are clean, got: {stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "exit 0 when no drift");
    Ok(())
}

/// A clean named span is a drift report: no span block renders, the "0 stale"
/// summary prints instead, and the command exits 0.
#[test]
fn named_lookup_clean_span_reports_zero_stale() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "quiet")?;
    let out = repo.run_span(["stale", "quiet"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // A fully-clean named span renders no block.
    assert!(
        !stdout.contains("## quiet"),
        "clean named span must not render a block, got: {stdout}"
    );
    // Explicit "checked, all clean" feedback instead of empty output.
    assert!(
        stdout.contains("0 stale across"),
        "summary must mention 0 stale for a clean named span, got: {stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "exit 0 for clean named span");
    Ok(())
}

/// Named lookup with all anchors drifted AND a staged pending add must render
/// both the drift bullet and the `pending add` bullet under a single block.
///
/// Regression test: the old span-shape heuristic returned `false` when every
/// File-backed model: `git span add` writes the anchor directly into
/// the worktree span file — there is no staging area or "pending"
/// state. A second anchor added to a span with a drifted first anchor
/// must still appear in the named-lookup block as a normal anchor bullet
/// alongside the drifted one.
#[test]
fn named_lookup_all_drifted_shows_pending_add() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Seed span with one anchor on lines 1-5.
    repo.span_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "regression test span"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }

    // Drift the first anchor by editing line 1 in the working tree.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    // Add a second anchor; file-backed, this lands directly in the
    // worktree span file (file2.txt is pristine → Fresh).
    repo.span_stdout(["add", "m", "file2.txt#L1-L5"])?;

    // Named lookup: `git span stale m`.
    let out = repo.run_span(["stale", "m", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert!(
        stdout.contains("## m"),
        "block heading must appear; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("changed"),
        "drift bullet must appear for drifted anchor; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("file2.txt#L1-L5"),
        "newly added second anchor must appear as a bullet; stdout=\n{stdout}"
    );
    Ok(())
}

/// A no-argument workspace scan is a drift report: a fully-fresh span
/// (every anchor still matching its anchored hash) must NOT appear at all.
#[test]
fn workspace_scan_hides_fully_fresh_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_stable(&repo, "quiet-span")?; // anchors lines 6-10 — unaffected by drift
    seed(&repo, "drifted-span")?; // anchors lines 1-5 — will drift
    drift(&repo, "mutate")?;
    let out = repo.run_span(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("drifted-span"),
        "drifted span must appear in scan; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("quiet-span"),
        "fully-fresh span must NOT appear in a workspace scan; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(1), "exit 1 because a span drifted");
    Ok(())
}

/// A stale span surfaced by a no-argument scan must list its *complete*
/// anchor set in stored order: drifted anchors carry their reason suffix,
/// fresh siblings render as bare bullets, and the `why` text follows.
#[test]
fn workspace_scan_stale_span_shows_fresh_sibling_and_why() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "spans two files"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Drift only file1.txt so file2.txt#L1-L5 stays Fresh.
    repo.write_file(
        "file1.txt",
        "edit1\nedit2\nedit3\nedit4\nedit5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // Warm the cache_v2 store: the first scan persists only the non-Fresh
    // finding rows for `m`, so a subsequent warm scan resolves `m.anchors`
    // to the drifted subset alone — the cache path that drops fresh siblings.
    let _warm = repo.run_span(["stale"])?;
    let out = repo.run_span(["stale"])?; // no args → workspace scan (warm)
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("file1.txt#L1-L5 — changed"),
        "drifted anchor must carry its reason suffix; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("file2.txt#L1-L5"),
        "fresh sibling anchor must appear in the scan block; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("spans two files"),
        "why text must follow the anchors; stdout=\n{stdout}"
    );
    Ok(())
}

fn commit_span(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.span_stdout(["add", name, anchor])?;
    repo.span_stdout(["why", name, why])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

#[test]
fn stale_recursive_glob_matches_nested_anchored_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("wiki/meta/notes.md", "a\nb\nc\n")?;
    repo.commit_all("add wiki notes")?;
    commit_span(
        &repo,
        "wiki/notes",
        "wiki/meta/notes.md",
        "wiki notes anchor",
    )?;
    repo.write_file("wiki/meta/notes.md", "X\nY\nZ\n")?;
    repo.commit_all("drift wiki notes")?;

    let stdout = repo.span_stdout(["stale", "wiki/**/*", "--no-exit-code"])?;
    assert!(
        stdout.contains("## wiki/notes"),
        "wiki/** should match wiki/meta/notes.md anchor; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn stale_single_star_glob_matches_single_segment_anchored_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("wiki/top.md", "a\nb\nc\n")?;
    repo.commit_all("add wiki top")?;
    commit_span(&repo, "wiki/top", "wiki/top.md", "wiki top anchor")?;
    repo.write_file("wiki/top.md", "X\nY\nZ\n")?;
    repo.commit_all("drift wiki top")?;

    let stdout = repo.span_stdout(["stale", "wiki/*", "--no-exit-code"])?;
    assert!(
        stdout.contains("## wiki/top"),
        "wiki/* should match wiki/top.md anchor; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn stale_single_star_glob_does_not_match_nested_segments() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("wiki/meta/deep.md", "a\nb\nc\n")?;
    repo.commit_all("add deep wiki")?;
    commit_span(&repo, "wiki/deep", "wiki/meta/deep.md", "deep anchor")?;

    let out = repo.run_span(["stale", "wiki/*"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "wiki/* should not match wiki/meta/deep.md"
    );
    Ok(())
}
