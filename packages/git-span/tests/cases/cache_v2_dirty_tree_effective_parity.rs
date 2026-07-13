//! Regression: on a DIRTY working tree the `cache_v2` warm-DIRTY /
//! dirty-overlay render diverged from the effective cache-off resolver
//! (`stale_spans_inner`) for spans NOT in the dirty set.
//!
//! The warm-CLEAN early-return routes the render through
//! `build_clean_whole_result` (an EFFECTIVE resolution), so a clean tree is
//! byte-identical to cache-off. But when the tree is DIRTY that early-return
//! is skipped: the dirty path rendered `apply_overlay(&baseline.spans,
//! &overlay)`, where `baseline.spans` is the row-level COMMITTED-ONLY baseline
//! and only spans touched by a dirty path receive the effective overlay. Every
//! UNAFFECTED span was rendered straight from the `committed_only` baseline,
//! which diverges from the effective resolver in two observable ways:
//!
//!   1. JSON `current.blob`: for a CHANGED/MOVED anchor `committed_only` fills
//!      `current.blob` with the HEAD blob; the effective resolver leaves it
//!      `null`. (`--format json` is the only format exposing `current.blob`.)
//!   2. Human drift LABEL: for an interior anchor `committed_only` labels drift
//!      "changed" while the effective resolver labels it "changed in the
//!      working tree".
//!
//! Additionally the committed_only baseline can order a span's anchors
//! differently from the effective resolver, so a multi-finding corpus could
//! diverge in finding ORDER even when the set matches.
//!
//! The fix routes the dirty path's non-affected committed spans through the
//! same effective resolution `build_clean_whole_result` produces, then overlays
//! the authoritative dirty re-resolution on top. Both manifestations and the
//! ordering then match cache-off byte-for-byte across every format.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Run cache-off (ground truth), then a COLD cache build and a WARM cache hit,
/// and assert both cache-on runs are byte-identical to the ground truth.
fn assert_format_parity(repo: &TestRepo, format: &str) -> Result<()> {
    let off = repo.run_span_with_env(
        ["stale", "--no-exit-code", "--format", format],
        "GIT_SPAN_CACHE_V2",
        "0",
    )?;
    let off_text = stdout(&off);

    let cold = repo.run_span(["stale", "--no-exit-code", "--format", format])?;
    let warm = repo.run_span(["stale", "--no-exit-code", "--format", format])?;

    assert_eq!(
        stdout(&cold),
        off_text,
        "[{format}] cold cache-on output diverged from cache-off ground truth on a dirty tree"
    );
    assert_eq!(
        stdout(&warm),
        off_text,
        "[{format}] warm cache-on output diverged from cache-off ground truth on a dirty tree"
    );
    Ok(())
}

/// Multi-span corpus with a MOVED finding and a CHANGED finding, made dirty by
/// touching an UNRELATED tracked file. The moved/changed spans are NOT in the
/// dirty set, so they are rendered from the committed baseline on the dirty
/// path — exercising both the `current.blob` (json) and the finding-order
/// divergence.
fn seed_moved_multi_span_dirty(repo: &TestRepo) -> Result<()> {
    repo.write_file("a.txt", "AAA\nBBB\nMOVED_X\nMOVED_Y\nCCC\n")?;
    repo.write_file("z.txt", "ZZZ\nQQQ\nWWW\n")?;
    repo.write_file("unrelated.txt", "u1\nu2\nu3\n")?;
    repo.commit_all("seed")?;

    repo.run_span(["add", "aaa", "a.txt#L3-L4"])?;
    repo.run_span(["why", "aaa", "-m", "moved content tracker"])?;
    repo.run_span(["add", "zzz", "z.txt#L1-L2"])?;
    repo.run_span(["why", "zzz", "-m", "changed content tracker"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Relocate the anchored region of a.txt (a MOVED finding) and change the
    // anchored region of z.txt (a CHANGED finding), via COMMITS so the tree is
    // clean before we dirty an unrelated file.
    repo.write_file("a.txt", "NEWTOP\nAAA\nBBB\nMOVED_X\nMOVED_Y\nCCC\nEXTRA\n")?;
    repo.write_file("z.txt", "ZZZ_CHANGED\nQQQ_CHANGED\nWWW\n")?;
    repo.commit_all("move and change")?;
    repo.write_commit_graph()?;

    // DIRTY the tree by editing an UNRELATED tracked file (no span anchors it),
    // so `aaa`/`zzz` stay out of the dirty set and render from the baseline.
    repo.write_file("unrelated.txt", "u1\nDIRTY\nu3\n")?;
    Ok(())
}

#[test]
fn dirty_tree_moved_multi_span_matches_cache_off_all_formats() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_moved_multi_span_dirty(&repo)?;

    // Sanity: the cache-off ground truth leaves `current.blob` null for the
    // out-of-dirty-set findings — otherwise this would not exercise the bug.
    let off_json = repo.run_span_with_env(
        ["stale", "--no-exit-code", "--format", "json"],
        "GIT_SPAN_CACHE_V2",
        "0",
    )?;
    let off_json_text = stdout(&off_json);
    assert!(
        off_json_text.contains("\"blob\": null"),
        "ground truth unexpectedly has no null current.blob — bug not exercised:\n{off_json_text}"
    );

    assert_format_parity(&repo, "json")?;
    assert_format_parity(&repo, "human")?;
    assert_format_parity(&repo, "porcelain")?;
    Ok(())
}

/// Interior-anchor ("poison") corpus made dirty by touching an UNRELATED file.
/// The interior-anchor span is NOT in the dirty set, so it renders from the
/// committed baseline on the dirty path — the path that labeled its drift
/// "changed" instead of the effective "changed in the working tree". This gates
/// the Human-format manifestation the json/MOVED test above does not.
fn seed_interior_anchor_dirty(repo: &TestRepo) -> Result<()> {
    repo.write_file("a.txt", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("unrelated.txt", "u1\nu2\nu3\n")?;
    repo.commit_all("seed")?;

    repo.run_span(["add", "normal", "a.txt#L1-L3"])?;
    repo.run_span(["why", "normal", "-m", "normal span"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span normal"])?;

    // Interior-anchor span whose anchor path is under `.span/`.
    repo.run_span(["add", "interior", ".span/normal#L1-L2"])?;
    repo.run_span(["why", "interior", "-m", "interior anchor watches normal"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span interior"])?;
    repo.write_commit_graph()?;

    // Drift the normal span's anchored region via a COMMIT (clean tree), so the
    // interior anchor over `.span/normal` is itself drifted at HEAD.
    repo.write_file("a.txt", "A1\nA2\nA3\na4\na5\n")?;
    repo.commit_all("drift a")?;
    repo.write_commit_graph()?;

    // DIRTY an UNRELATED tracked file: the poison (interior) span is unaffected
    // and renders from the committed baseline on the warm-dirty path.
    repo.write_file("unrelated.txt", "u1\nDIRTY\nu3\n")?;
    Ok(())
}

#[test]
fn dirty_tree_interior_anchor_matches_cache_off_human() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_interior_anchor_dirty(&repo)?;

    // Sanity: the ground truth surfaces drift — otherwise nothing is exercised.
    let off = repo.run_span_with_env(["stale", "--no-exit-code"], "GIT_SPAN_CACHE_V2", "0")?;
    assert!(
        stdout(&off).contains("changed"),
        "ground truth missing a drift label — bug not exercised:\n{}",
        stdout(&off)
    );

    assert_format_parity(&repo, "human")?;
    assert_format_parity(&repo, "json")?;
    assert_format_parity(&repo, "porcelain")?;
    Ok(())
}
