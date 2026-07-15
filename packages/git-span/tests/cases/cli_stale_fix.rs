//! CLI: `git span stale --fix` — re-anchor drifted Moved/Changed records
//! in place by editing the span worktree files. Plan §"Phase 2".

use crate::support;

use anyhow::Result;
use git_span_core::{cheap_fingerprint_with_extent, rk64_to_hex};
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".span").join(name);
    Ok(std::fs::read_to_string(path)?)
}

fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    rk64_to_hex(cheap_fingerprint_with_extent(
        slice.join("\n").as_bytes(),
        &git_span_core::AnchorExtent::WholeFile,
    ))
}

fn seed_span(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.span_stdout(["add", name, anchor])?;
    repo.span_stdout(["why", name, "-m", why])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Listing all anchors (Human format, no flag)
// ---------------------------------------------------------------------------

#[test]
fn fully_fresh_span_is_absent_from_scan() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "-m", "all fresh"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    let stdout = repo.span_stdout(["stale"])?;
    // A scan is a drift report: a fully-fresh span does not surface.
    assert!(
        !stdout.contains("## m"),
        "fully-fresh span must not surface in a scan; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("0 stale"),
        "summary line must appear; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn lists_all_anchors_in_mixed_span_in_stored_order() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Stored order: [file1#L1-L5 (will drift Changed), file2#L1-L5 (fresh),
    // file1#L6-L10 (fresh), file2#L11-L15 (will drift Changed)].
    repo.span_stdout([
        "add", "m",
        "file1.txt#L1-L5",
        "file2.txt#L1-L5",
        "file1.txt#L6-L10",
        "file2.txt#L11-L15",
    ])?;
    repo.span_stdout(["why", "m", "-m", "mixed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Drift file1 line 1 and file2 line 13.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file(
        "file2.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nlineTHIRTEEN\nline14\nline15\nline16\n",
    )?;

    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    // All four addresses appear, in canonical (path, start_line, end_line) order.
    let a = stdout.find("file1.txt#L1-L5").expect("first");
    let b = stdout.find("file1.txt#L6-L10").expect("second");
    let c = stdout.find("file2.txt#L1-L5").expect("third");
    let d = stdout.find("file2.txt#L11-L15").expect("fourth");
    assert!(a < b && b < c && c < d, "canonical order: stdout=\n{stdout}");
    // The drifted ones carry status prose.
    assert!(
        stdout.contains("file1.txt#L1-L5 — changed")
            || stdout.contains("file1.txt#L1-L5 — Changed"),
        "first anchor must carry changed prose; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn no_drift_scan_lists_no_spans() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "a", "file1.txt#L1-L5", "a")?;
    seed_span(&repo, "b", "file2.txt#L1-L5", "b")?;
    let out = repo.run_span(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // No span has drifted: the scan prints only the summary line.
    assert!(!stdout.contains("## a"), "span a must not surface; stdout=\n{stdout}");
    assert!(!stdout.contains("## b"), "span b must not surface; stdout=\n{stdout}");
    assert!(
        stdout.contains("0 stale"),
        "summary line must appear; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

// ---------------------------------------------------------------------------
// --fix behavior
// ---------------------------------------------------------------------------

/// Original 10-line `file1.txt` content seeded by `TestRepo::seeded`.
const ORIGINAL: &str =
    "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";

// Under the content-equivalence gate (card main-90) a *meaning-changing*
// `Changed` edit must NOT be re-anchored — the broken content would silence
// the coupling. `--fix` leaves the original recorded hash in place at every
// layer so the drift keeps surfacing.

#[test]
fn fix_leaves_changed_anchor_at_worktree_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Meaning-changing worktree edit (no commit, no stage).
    let new_content =
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    assert!(
        out.status.success() || out.status.code() == Some(0),
        "fix run; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );

    let span = read_span(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(new_content, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "meaning-changed anchor must keep its original hash; got:\n{span}"
    );
    assert!(
        !span.contains(&broken),
        "meaning-changed anchor must NOT be re-anchored; got:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_leaves_changed_at_index_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Stage a meaning-changing edit; leave worktree matching the index.
    let staged =
        "lineSTG\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", staged)?;
    repo.run_git(["add", "file1.txt"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(staged, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "meaning-changed anchor must keep its original hash; got:\n{span}"
    );
    assert!(
        !span.contains(&broken),
        "meaning-changed anchor must NOT be re-anchored; got:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_leaves_changed_at_head_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Commit a meaning-changing edit to file1.
    let new_content =
        "lineHEAD\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "edit file1"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(new_content, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "meaning-changed anchor must keep its original hash; got:\n{span}"
    );
    assert!(
        !span.contains(&broken),
        "meaning-changed anchor must NOT be re-anchored; got:\n{span}"
    );
    Ok(())
}

// Whitespace-only `Changed` edits ARE content-equivalent and must still be
// re-anchored (the gate's GREEN path) at the worktree and index layers.

#[test]
fn fix_reanchors_whitespace_only_changed_at_worktree_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Whitespace-only worktree edit: reindent line 1.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let expected = line_slice_hash(reindented, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{expected}")),
        "whitespace-only change must be re-anchored to current content; got:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_reanchors_whitespace_only_changed_at_index_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Whitespace-only edit, staged; worktree matches the index.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;
    repo.run_git(["add", "file1.txt"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let expected = line_slice_hash(reindented, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{expected}")),
        "whitespace-only staged change must be re-anchored; got:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_reanchors_whitespace_only_changed_at_head_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Commit a whitespace-only edit. The visible text is a pure reshaping
    // of the original — no meaning changed — so `--fix` must re-anchor it
    // just as it does at the worktree/index layers, not silently no-op.
    // The genuine original bytes are still recoverable one commit back
    // (HEAD~1), so the resolver can walk back to prove equivalence even
    // though HEAD itself now carries the edited content.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "reindent file1"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let reanchored = line_slice_hash(reindented, 1, 5);
    assert!(
        !span.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "HEAD-layer whitespace-only change must not keep the stale original hash; got:\n{span}"
    );
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{reanchored}")),
        "HEAD-layer whitespace-only change must be re-anchored to current content; got:\n{span}"
    );

    // A follow-up scan reports no drift.
    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("0 stale"),
        "anchor must be clean after re-anchoring; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_reanchors_whitespace_only_changed_several_commits_back_at_head_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Three successive whitespace-only reshapes of line 1, each a distinct
    // indentation from the last and from the genuine original — so only the
    // very first commit (three commits back) still hashes to `stored_hash`.
    // This forces `find_original_line_slice_in_history`'s walk past
    // `HEAD~1` and `HEAD~2` (neither matches) before it finds the original
    // at `HEAD~3`, exercising the first-parent ancestor chain, the
    // per-(commit,path) blob memo, and the per-(blob,start,end) fingerprint
    // memo across multiple distinct ancestors rather than just the first.
    let v1 = "\tline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", v1)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "reindent v1"])?;

    let v2 = "  line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", v2)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "reindent v2"])?;

    let v3 = "      line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", v3)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "reindent v3"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let reanchored = line_slice_hash(v3, 1, 5);
    assert!(
        !span.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "multi-commit-back whitespace-only change must not keep the stale original hash; got:\n{span}"
    );
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{reanchored}")),
        "multi-commit-back whitespace-only change must be re-anchored to current content; got:\n{span}"
    );

    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("0 stale"),
        "anchor must be clean after re-anchoring; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_leaves_changed_anchor_when_history_walk_is_exhausted() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // A meaning-changing HEAD-layer edit never hash-matches `stored_hash` at
    // ANY ancestor, so `find_original_line_slice_in_history`'s walk runs
    // all the way past the last real commit and off the root — exhausting
    // the first-parent ancestor chain (this repo has only a handful of
    // commits, far short of `HISTORY_WALK_LIMIT`). The walk must fail
    // closed (leave the anchor `Changed`, keep the original hash) rather
    // than panicking or hanging when the chain runs out of parents.
    let new_content =
        "lineHEAD\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "meaning-changing edit"])?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    assert!(
        out.status.success() || out.status.code() == Some(0),
        "fix run must complete without crashing once the history walk is exhausted; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );

    let span = read_span(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(new_content, 1, 5);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "exhausted-walk anchor must keep its original hash; got:\n{span}"
    );
    assert!(
        !span.contains(&broken),
        "exhausted-walk anchor must NOT be re-anchored; got:\n{span}"
    );

    let out2 = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out2.stdout);
    assert!(
        stdout.contains("## m"),
        "anchor must still surface as stale after an exhausted walk; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_rewrites_moved_anchor_at_worktree_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Rename file1.txt → renamed.txt without touching content. Resolver
    // sees the original path missing and the stored hash at the new path
    // → Moved.
    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename"])?;

    let _ = original;
    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("renamed.txt#L1-L5 rk64:"),
        "span must reference renamed path; got:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L5"),
        "old anchor address gone; got:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_skips_deleted_anchor_and_keeps_in_listing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Delete the source path.
    std::fs::remove_file(repo.path().join("file1.txt"))?;

    let before = read_span(&repo, "m")?;
    let out = repo.run_span(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_span(&repo, "m")?;
    assert_eq!(before, after, "Deleted anchor must not be rewritten");
    assert!(
        stdout.contains("file1.txt#L1-L5"),
        "anchor still listed; stdout=\n{stdout}"
    );
    assert_ne!(out.status.code(), Some(0), "non-zero exit for remaining drift");
    Ok(())
}

#[test]
fn fix_exit_code_reflects_post_fix_drift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "-m", "mix"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // file1: fixable Changed (worktree edit).
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // file2: unfixable Deleted.
    std::fs::remove_file(repo.path().join("file2.txt"))?;

    let out = repo.run_span(["stale", "--fix"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "one drifted (deleted) anchor remains; stdout={}, stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

#[test]
fn fix_rejected_with_json_format() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;
    let out = repo.run_span(["stale", "--fix", "--format", "json"])?;
    assert_ne!(out.status.code(), Some(0));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--fix") || stderr.contains("human"),
        "stderr should mention the guardrail; stderr={stderr}"
    );
    Ok(())
}

#[test]
fn fix_no_commit_produced() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;
    // Whitespace-only edit so the anchor is re-anchored (content-equivalent)
    // and the span file actually changes on disk.
    repo.write_file(
        "file1.txt",
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let head_before = repo.head_sha()?;
    repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let head_after = repo.head_sha()?;
    assert_eq!(head_before, head_after, "no commit produced");
    // Worktree diff should show span file change.
    let diff = repo.git_stdout(["diff", "--name-only"])?;
    assert!(
        diff.contains(".span/m"),
        "span file is in worktree diff; diff={diff}"
    );
    Ok(())
}

#[test]
fn fix_preserves_span_file_anchor_order() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout([
        "add", "m",
        "file2.txt#L1-L5",
        "file1.txt#L1-L5",
        "file2.txt#L11-L15",
    ])?;
    repo.span_stdout(["why", "m", "-m", "order"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Drift line 1 of both files (so two of three anchors are Changed).
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file(
        "file2.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\n",
    )?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    // Canonical order: (path, start_line, end_line) ascending.
    let a = span.find("file1.txt#L1-L5").expect("first");
    let b = span.find("file2.txt#L1-L5").expect("second");
    let c = span.find("file2.txt#L11-L15").expect("third");
    assert!(a < b && b < c, "canonical order expected; span:\n{span}");
    Ok(())
}

#[test]
fn fix_skips_terminal_statuses() -> Result<()> {
    // Currently exercised via deleted (other terminal statuses — ContentUnavailable,
    // MergeConflict, Submodule, Orphaned — require more elaborate setup; deleted is
    // representative because all terminal statuses are handled by the same
    // `!matches!(status, Moved | Changed)` skip).
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;
    std::fs::remove_file(repo.path().join("file1.txt"))?;
    let before = read_span(&repo, "m")?;
    repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let after = read_span(&repo, "m")?;
    assert_eq!(before, after);
    Ok(())
}

// ---------------------------------------------------------------------------
// Machine-format parity (drifted input)
// ---------------------------------------------------------------------------

#[test]
fn json_porcelain_unchanged_for_drifted_input() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // JSON: should still report the single drifted finding only (no Fresh entries).
    let out = repo.run_span(["stale", "--format", "json", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("CHANGED") || stdout.to_lowercase().contains("changed"),
        "json output mentions changed status; got:\n{stdout}"
    );
    // Porcelain
    let out = repo.run_span(["stale", "--format", "porcelain", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("CHANGED"),
        "porcelain output mentions CHANGED; got:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// --fix line-range coalescing (card main-88)
// ---------------------------------------------------------------------------

/// Two contiguous line ranges authored on the same path — with no drift at
/// all — collapse into a single anchor covering their union, carrying one
/// freshly recomputed hash. Normalization is total, not fix-scoped.
#[test]
fn fix_coalesces_contiguous_authored_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", "m", "-m", "adjacent"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    let out = repo.run_span(["stale", "--fix"])?;
    assert_eq!(out.status.code(), Some(0), "no residual drift after merge");

    let span = read_span(&repo, "m")?;
    let file1 =
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    let expected = line_slice_hash(file1, 1, 10);
    assert!(
        span.contains(&format!("file1.txt#L1-L10 rk64:{expected}")),
        "ranges must collapse into L1-L10 with recomputed hash; span:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L5") && !span.contains("file1.txt#L6-L10"),
        "original fragmented ranges must be gone; span:\n{span}"
    );
    Ok(())
}

/// Overlapping ranges collapse into the union of their lines.
#[test]
fn fix_coalesces_overlapping_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file2.txt#L1-L10", "file2.txt#L5-L15"])?;
    repo.span_stdout(["why", "m", "-m", "overlap"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    repo.run_span(["stale", "--fix"])?;

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("file2.txt#L1-L15"),
        "overlapping ranges collapse to L1-L15; span:\n{span}"
    );
    assert!(
        !span.contains("file2.txt#L1-L10") && !span.contains("file2.txt#L5-L15"),
        "original overlapping ranges must be gone; span:\n{span}"
    );
    Ok(())
}

/// A gap larger than one line between ranges is not contiguous: the ranges
/// stay distinct.
#[test]
fn fix_leaves_non_contiguous_ranges_separate() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file2.txt#L1-L5", "file2.txt#L8-L12"])?;
    repo.span_stdout(["why", "m", "-m", "gap"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    repo.run_span(["stale", "--fix"])?;

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("file2.txt#L1-L5") && span.contains("file2.txt#L8-L12"),
        "non-contiguous ranges (gap > 1) stay separate; span:\n{span}"
    );
    Ok(())
}

/// Ranges on a deleted (terminal) path are never coalesced — the merge must
/// not paper over drift the operator still needs to see.
#[test]
fn fix_does_not_coalesce_terminal_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", "m", "-m", "terminal"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    std::fs::remove_file(repo.path().join("file1.txt"))?;
    let before = read_span(&repo, "m")?;
    repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let after = read_span(&repo, "m")?;
    assert_eq!(
        before, after,
        "contiguous ranges on a deleted path must remain untouched"
    );
    Ok(())
}

/// A whole-file anchor never merges with a line-range anchor on the same
/// path, and is never split or absorbed.
#[test]
fn fix_leaves_whole_file_anchor_inert() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "-m", "mixed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    assert!(
        span.lines().any(|l| l.starts_with("file1.txt rk64:")),
        "whole-file anchor stays inert; span:\n{span}"
    );
    assert!(
        span.contains("file1.txt#L1-L5"),
        "line-range anchor with no contiguous partner is left as-is; span:\n{span}"
    );
    Ok(())
}

/// Three contiguous ranges collapse transitively into one anchor.
#[test]
fn fix_coalesces_chain_of_three() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout([
        "add", "m",
        "file2.txt#L1-L5",
        "file2.txt#L6-L10",
        "file2.txt#L11-L15",
    ])?;
    repo.span_stdout(["why", "m", "-m", "chain"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    repo.run_span(["stale", "--fix"])?;

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("file2.txt#L1-L15"),
        "three contiguous ranges collapse to L1-L15; span:\n{span}"
    );
    Ok(())
}

/// Two contiguous ranges whose drift surfaced at a non-worktree layer
/// (committed meaning-change, worktree clean) must NOT merge. Under the
/// content-equivalence gate these meaning-changed Head-layer anchors are not
/// re-anchored at all (the original bytes are gone from HEAD, so the change
/// cannot be proven whitespace-equivalent): both records are left drifting
/// with their original hashes and the coalesce pass treats them as barriers,
/// so the ranges stay distinct.
#[test]
fn fix_does_not_coalesce_non_worktree_layer_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", "m", "-m", "head-layer"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // Commit a change touching both ranges, leaving the worktree clean: the
    // drift surfaces at the Head layer, not the worktree.
    let new_content =
        "lineHEAD\nline2\nline3\nline4\nline5\nlineSIX\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "edit file1"])?;

    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    let span = read_span(&repo, "m")?;
    let orig1 = line_slice_hash(ORIGINAL, 1, 5);
    let orig2 = line_slice_hash(ORIGINAL, 6, 10);
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{orig1}")),
        "first range left drifting with its original hash; span:\n{span}"
    );
    assert!(
        span.contains(&format!("file1.txt#L6-L10 rk64:{orig2}")),
        "second range left drifting with its original hash; span:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L10"),
        "non-worktree-layer ranges must not collapse into L1-L10; span:\n{span}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// --fix conflict resolution
// ---------------------------------------------------------------------------

/// Original 16-line `file2.txt` content seeded by `TestRepo::seeded`.
const FILE2: &str =
    "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n\
     line11\nline12\nline13\nline14\nline15\nline16\n";

#[test]
fn fix_resolves_conflict_markers_cleanly() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Span with standard conflict markers.  Ours has file1.txt#L1-L5,
    // theirs has file2.txt#L1-L5.  Both source files exist and are clean
    // => each anchor is only on one side, merge resolves via re-hash.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let span_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("resolved conflict") && stdout.contains("all anchors merged clean"),
        "expected clean resolution message; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "clean resolution must exit 0");

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "file1 anchor; span:\n{span}"
    );
    assert!(
        span.contains(&format!("file2.txt#L1-L5 rk64:{h2}")),
        "file2 anchor; span:\n{span}"
    );
    assert!(
        !span.contains("<<<<<<<"),
        "conflict markers must be removed; span:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_clean_source_precondition() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Span conflict referencing file1.txt.  Overwrite file1.txt itself
    // with conflict markers so read_clean_source_files fails closed.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let span_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file1.txt#L1-L5 rk64:{h1}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    // Make the referenced source file carry conflict markers.
    repo.write_file(
        "file1.txt",
        "<<<<<<< HEAD\nline1\n=======\nline1 changed\n>>>>>>> branch\n",
    )?;

    let out = repo.run_span(["stale", "--fix"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("source file") && stderr.contains("conflict markers"),
        "stderr must warn about the conflicted source file; stderr=\n{stderr}"
    );
    // The span file must still carry markers (not resolved).
    let raw = read_span(&repo, "m")?;
    assert!(
        raw.contains("<<<<<<<"),
        "span must remain conflicted; raw:\n{raw}"
    );
    // Without --no-exit-code, the unresolved conflict drives exit 1.
    assert_ne!(
        out.status.code(),
        Some(0),
        "unresolved conflict must give non-zero exit; got {:?}",
        out.status.code()
    );
    Ok(())
}

#[test]
fn fix_why_divergence_fails_closed() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Both sides have the same anchor but different why text, and no base
    // (textual markers).  resolve_why_text fails closed => partial residue.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let span_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}

our rationale
=======
file1.txt#L1-L5 rk64:{h1}

their rationale
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("partial resolution"),
        "expected partial resolution; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("why text diverged"),
        "expected why-divergence mention; stdout=\n{stdout}"
    );

    // The anchor line should be written cleanly; the why block wrapped in
    // conflict markers.
    let span = read_span(&repo, "m")?;
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "anchor must appear clean; span:\n{span}"
    );
    assert!(
        span.contains("<<<<<<<"),
        "why conflict markers must remain; span:\n{span}"
    );
    assert!(span.contains("our rationale"), "our why; span:\n{span}");
    assert!(span.contains("their rationale"), "their why; span:\n{span}");
    Ok(())
}

#[test]
fn fix_union_of_divergent_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Ours has file1.txt#L1-L3, theirs has file1.txt#L5-L7.
    // Different ranges on the same path -- no hash conflict => clean union.
    let h_a = line_slice_hash(ORIGINAL, 1, 3);
    let h_b = line_slice_hash(ORIGINAL, 5, 7);
    let span_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L3 rk64:{h_a}
=======
file1.txt#L5-L7 rk64:{h_b}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("resolved conflict"),
        "expected clean resolution; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "clean union must exit 0");

    // Both anchors appear, in canonical (path, start, end) order.
    let span = read_span(&repo, "m")?;
    let pos_a = span.find(&format!("file1.txt#L1-L3 rk64:{h_a}"));
    let pos_b = span.find(&format!("file1.txt#L5-L7 rk64:{h_b}"));
    assert!(pos_a.is_some() && pos_b.is_some(), "both anchors present");
    assert!(
        pos_a.unwrap() < pos_b.unwrap(),
        "canonical order L1-L3 before L5-L7; span:\n{span}"
    );
    assert!(
        !span.contains("<<<<<<<"),
        "no conflict markers; span:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_partial_residue_with_mixed_resolved_and_why_conflict() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // One anchor outside markers (common to both sides), plus a narrower
    // anchor inside markers (both sides have the same hash).  The why text
    // inside markers diverges => partial residue (resolved anchors written
    // clean, why block remains as minimal conflict).
    let h_out = line_slice_hash(ORIGINAL, 1, 5);
    let h_in = line_slice_hash(FILE2, 1, 3);
    let span_content = format!(
        "\
file1.txt#L1-L5 rk64:{h_out}
<<<<<<< ours
file2.txt#L1-L3 rk64:{h_in}

our refined purpose
=======
file2.txt#L1-L3 rk64:{h_in}

their refined purpose
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("partial resolution"),
        "expected partial resolution; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    // Both anchors appear clean (outside marker lines go to both sides,
    // inside anchor is identical on both sides).
    assert!(
        span.contains(&format!("file1.txt#L1-L5 rk64:{h_out}")),
        "outside anchor appears; span:\n{span}"
    );
    assert!(
        span.contains(&format!("file2.txt#L1-L3 rk64:{h_in}")),
        "inside anchor appears; span:\n{span}"
    );
    // Why conflict block remains.
    assert!(
        span.contains("<<<<<<<"),
        "why conflict block present; span:\n{span}"
    );
    assert!(
        span.contains("our refined purpose"),
        "our why preserved; span:\n{span}"
    );
    assert!(
        span.contains("their refined purpose"),
        "their why preserved; span:\n{span}"
    );
    Ok(())
}

#[test]
fn fix_no_restage_for_residue() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Commit a clean span first so we have a HEAD/index baseline.
    seed_span(&repo, "m", "file1.txt#L1-L5", "original why")?;

    // Overwrite with conflict markers where anchors match but why
    // diverges => partial resolution (residue).  The resolved anchors
    // must NOT be staged by --fix.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let span_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}

our new why
=======
file1.txt#L1-L5 rk64:{h1}

their new why
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("partial resolution"),
        "expected partial resolution; stdout=\n{stdout}"
    );

    // The span file must NOT be staged (cached diff).
    let cached = repo.git_stdout(["diff", "--cached", "--name-only"])?;
    assert!(
        !cached.contains(".span/m"),
        "span must not be staged; cached=[{cached}]"
    );

    // The worktree diff SHOULD show the span was modified.
    let wt_diff = repo.git_stdout(["diff", "--name-only"])?;
    assert!(
        wt_diff.contains(".span/m"),
        "span must appear in worktree diff; diff=[{wt_diff}]"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// MOVED with uncommitted worktree line-shift: re-anchor against HEAD
// (card main-148)
// ---------------------------------------------------------------------------

/// When a MOVED anchor has both committed (HEAD) and uncommitted (worktree)
/// line-shifting edits, `--fix` must re-anchor against the shallowest drifting
/// layer (HEAD) so the hash and position share provenance.  Before the fix,
/// `--fix` re-hashed against the deepest layer (worktree), producing an anchor
/// whose hash reflects worktree content while the position comes from HEAD —
/// an internally inconsistent span file that cannot converge.
///
/// This test sets up the exact scenario from main-148's reproduction script
/// Variant B: committed line insertion + uncommitted line insertion both above
/// the anchored range.  The assertion is that after `--fix` the span file's
/// hash matches HEAD content at the written position.
#[test]
fn fix_moved_with_worktree_shifts_reanchors_against_head() -> Result<()> {
    let repo = TestRepo::new()?;

    // 15 numbered lines so anchored content is easy to identify after shifts.
    let initial = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\n";
    repo.write_file("file1.txt", initial)?;
    repo.commit_all("initial commit")?;

    // Span lines 7-10 (line7 .. line10).
    seed_span(&repo, "m", "file1.txt#L7-L10", "anchored block")?;
    repo.write_commit_graph()?;

    // Committed line insertion above the anchored range → MOVED at HEAD.
    // The anchored bytes (line7–line10) shift from L7-L10 to L9-L12.
    let after_head = "prefix1\nprefix2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\n";
    repo.write_file("file1.txt", after_head)?;
    repo.commit_all("add prefix lines")?;

    // Sanity: the span reports MOVED (exit code 1 is expected when stale).
    let stale_out = repo.run_span(["stale"])?;
    let stale = String::from_utf8_lossy(&stale_out.stdout);
    assert!(
        stale.contains("moved to"),
        "stale must report MOVED; got:\n{stale}"
    );

    // Uncommitted line insertion above the anchored range → worktree shift.
    let after_wt = "extra1\nextra2\nprefix1\nprefix2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\n";
    repo.write_file("file1.txt", after_wt)?;

    // Run --fix.
    repo.run_span(["stale", "--fix", "--no-exit-code"])?;

    // Read the fixed span.
    let span = read_span(&repo, "m")?;
    let anchor_line = span
        .lines()
        .find(|l| l.starts_with("file1.txt"))
        .expect("anchor line must exist");

    // After the fix, MOVED anchors preserve their original hash — the
    // anchored content hasn't changed, only its position.  The position is
    // updated to the tracked location.
    let original_hash = line_slice_hash(initial, 7, 10);
    assert!(
        anchor_line.contains(&format!("rk64:{original_hash}")),
        "MOVED anchor must preserve original hash rk64:{original_hash}; got: {anchor_line}"
    );

    // The stale output reports ResolvedPendingCommit: the span file is
    // consistent with the worktree, but HEAD still has the old location.
    // Exit code 0 with --no-exit-code confirms no remaining drift.
    let stale_after_out = repo.run_span(["stale", "--no-exit-code"])?;
    let stale_after = String::from_utf8_lossy(&stale_after_out.stdout);
    assert!(
        stale_after.contains("resolved, pending commit")
            || stale_after.contains("0 stale"),
        "span must be clean after fix; got:\n{stale_after}"
    );
    assert_eq!(
        stale_after_out.status.code(),
        Some(0),
        "exit code must be 0 after fix"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// --fix reconciled summary
// ---------------------------------------------------------------------------

#[test]
fn fix_prints_reconciled_summary_for_updated_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Whitespace-only worktree edit → content-equivalent Changed → re-anchored.
    repo.write_file(
        "file1.txt",
        "  line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected summary for one re-anchored anchor; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_prints_zero_summary_on_clean_tree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // No drift at all — clean tree.
    let out = repo.run_span(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 0 spans, 0 anchors (0 updated, 0 removed)."),
        "expected zero summary on clean tree; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_prints_summary_with_remaining_drift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "-m", "mixed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // file1: fixable whitespace-only Changed.
    repo.write_file(
        "file1.txt",
        "  line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // file2: unfixable Deleted.
    std::fs::remove_file(repo.path().join("file2.txt"))?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // The summary counts only the reconciled anchor despite remaining drift.
    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected summary with remaining drift; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_prints_removed_count_for_interior_anchor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Inject an interior anchor whose path is under .span/.
    // Write the span file raw to bypass `git span add` validation.
    let h = line_slice_hash(ORIGINAL, 1, 5);
    let interior = format!(
        ".span/m rk64:{h}\nfile1.txt#L1-L5 rk64:{h}\n\ninterior anchor test\n"
    );
    repo.write_file(".span/m", &interior)?;
    repo.run_git(["add", ".span/m"])?;
    repo.run_git(["commit", "-m", "add interior anchor"])?;

    // --fix must remove the interior anchor and re-anchor the valid one.
    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("1 removed") || stdout.contains("Reconciled"),
        "expected summary mentioning removed interior anchor; stdout=\n{stdout}"
    );
    // With interior anchor removal (1 removed) plus 0 re-anchored (the
    // interior-anchor path is unresolvable so the valid anchor may or may
    // not drift — just verify the removed count is non-zero).
    assert!(
        stdout.contains("(0 updated, 1 removed)")
            || stdout.contains("(1 updated, 1 removed)"),
        "expected removed count > 0; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn fix_conflict_resolved_summary() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Span conflict: ours has file1.txt#L1-L5, theirs has file2.txt#L1-L5.
    // Both source files are clean => merge resolves both anchors.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let span_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 2 anchors (2 updated, 0 removed)."),
        "expected summary for fully-resolved conflict; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "clean resolution must exit 0");
    Ok(())
}

#[test]
fn fix_partial_conflict_summary() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // One anchor outside markers (common), one inside (same hash on both
    // sides), why text diverges => partial resolution: resolved anchors
    // written clean, why residue wrapped in conflict markers.
    let h_out = line_slice_hash(ORIGINAL, 1, 5);
    let h_in = line_slice_hash(FILE2, 1, 3);
    let span_content = format!(
        "\
file1.txt#L1-L5 rk64:{h_out}
<<<<<<< ours
file2.txt#L1-L3 rk64:{h_in}

our refined purpose
=======
file2.txt#L1-L3 rk64:{h_in}

their refined purpose
>>>>>>> theirs
"
    );
    repo.write_file(".span/m", &span_content)?;

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 2 anchors (2 updated, 0 removed)."),
        "expected summary for partially-resolved conflict; stdout=\n{stdout}"
    );
    Ok(())
}
