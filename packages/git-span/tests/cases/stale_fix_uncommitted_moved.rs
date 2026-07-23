//! Regression test for `git span stale --fix` silently skipping exact
//! in-file `Moved` anchors whose drift lives only in the worktree or
//! only in the index (uncommitted).
//!
//! `--help` for `stale --fix` promises "Re-anchor `Moved` anchors
//! unconditionally... Each surfacing anchor is re-hashed against the
//! deepest drifting layer" — i.e. `--fix` should reconcile a pure
//! in-file line-range shift regardless of which layer (worktree, index,
//! or HEAD) the shift lives in. Instead, `apply_fix`'s shallowest-layer
//! gate (`packages/git-span/src/cli/stale_fix.rs`, around L629-643)
//! `continue`s past the anchor whenever `resolved.layer_sources` is
//! empty — which is exactly what `compute_layer_sources` (in
//! `packages/git-span/src/resolver/engine/anchor.rs`) produces for an
//! exact in-file move: the tracked slices it compares between adjacent
//! layers are byte-identical (the content only moved, it didn't
//! change), so no per-layer "drift" is detected even though the
//! anchor's recorded position is stale. The branch that actually
//! performs the exact in-file `Moved` fix (stale_fix.rs, around
//! L648-680) reuses the anchor's already-stored `content_hash` and
//! never reads `layer` at all, so this gate incorrectly disqualifies an
//! anchor the fix path doesn't need a layer for.
//!
//! Once committed, the same shift resolves via a different code path
//! (`inferred_source` / `deepest_layer` are non-empty for a HEAD-layer
//! move), so `--fix` reconciles it correctly — see
//! `fix_rewrites_moved_anchor_at_worktree_layer` in `cli_stale_fix.rs`
//! for the committed-rename analogue. These tests cover the two
//! uncommitted cases the committed test does not.

use crate::support;

use anyhow::Result;
use support::TestRepo;

fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".span").join(name);
    Ok(std::fs::read_to_string(path)?)
}

/// Seed a committed span anchoring `file1.txt#L3-L5` (content
/// `line3\nline4\nline5`), then prepend two lines to `file1.txt` so the
/// same bytes now live at `L5-L7`. This is a pure in-file move: no
/// content changed, only position. The caller decides how far the edit
/// is committed (worktree-only vs staged-but-uncommitted).
fn seed_and_shift(repo: &TestRepo) -> Result<()> {
    repo.span_stdout(["add", "m", "file1.txt#L3-L5"])?;
    repo.span_stdout(["why", "m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span m"])?;

    repo.write_file(
        "file1.txt",
        "prefixA\nprefixB\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Scenario 1: worktree-only drift (not staged).
// ---------------------------------------------------------------------------

#[test]
fn fix_rewrites_moved_anchor_at_worktree_only_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_shift(&repo)?;

    // Sanity: the read-only scan sees this as Moved before --fix runs.
    let pre = repo.span_stdout(["stale", "--no-exit-code"])?;
    assert!(
        pre.contains("MOVED") || pre.contains("moved"),
        "expected the shifted anchor to surface as Moved pre-fix; stdout=\n{pre}"
    );

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected --fix to reconcile the worktree-only in-file move; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("file1.txt#L5-L7 rk64:"),
        "span must be rewritten to the shifted range L5-L7; got:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L3-L5"),
        "old anchor address must be gone; got:\n{span}"
    );

    // A following read-only `stale` must now be clean.
    let post = repo.run_span(["stale"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "stale must be clean after --fix reconciled the worktree-only move; stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

/// Secondary observable: the porcelain SRC column should read `W` for
/// this worktree-only drift, not `-`.
#[test]
fn porcelain_src_column_reads_worktree_for_worktree_only_move() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_shift(&repo)?;

    let out = repo.run_span(["stale", "--format", "porcelain", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let moved_line = stdout
        .lines()
        .find(|l| l.starts_with("MOVED\t"))
        .unwrap_or_else(|| panic!("expected a MOVED porcelain line; stdout=\n{stdout}"));
    let cols: Vec<&str> = moved_line.split('\t').collect();
    assert_eq!(
        cols.get(1).copied(),
        Some("W"),
        "SRC column must read W for worktree-only drift; line={moved_line}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Scenario 2: staged-but-uncommitted (index-only) drift.
// ---------------------------------------------------------------------------

#[test]
fn fix_rewrites_moved_anchor_at_index_only_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_shift(&repo)?;
    repo.run_git(["add", "file1.txt"])?;

    // Sanity: the read-only scan sees this as Moved before --fix runs.
    let pre = repo.span_stdout(["stale", "--no-exit-code"])?;
    assert!(
        pre.contains("MOVED") || pre.contains("moved"),
        "expected the shifted anchor to surface as Moved pre-fix; stdout=\n{pre}"
    );

    let out = repo.run_span(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected --fix to reconcile the index-only in-file move; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("file1.txt#L5-L7 rk64:"),
        "span must be rewritten to the shifted range L5-L7; got:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L3-L5"),
        "old anchor address must be gone; got:\n{span}"
    );

    // A following read-only `stale` must now be clean.
    let post = repo.run_span(["stale"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "stale must be clean after --fix reconciled the index-only move; stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

/// Secondary observable: the porcelain SRC column should read `I` for
/// this index-only drift, not `-`.
#[test]
fn porcelain_src_column_reads_index_for_index_only_move() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_shift(&repo)?;
    repo.run_git(["add", "file1.txt"])?;

    let out = repo.run_span(["stale", "--format", "porcelain", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let moved_line = stdout
        .lines()
        .find(|l| l.starts_with("MOVED\t"))
        .unwrap_or_else(|| panic!("expected a MOVED porcelain line; stdout=\n{stdout}"));
    let cols: Vec<&str> = moved_line.split('\t').collect();
    assert_eq!(
        cols.get(1).copied(),
        Some("I"),
        "SRC column must read I for index-only drift; line={moved_line}"
    );
    Ok(())
}
