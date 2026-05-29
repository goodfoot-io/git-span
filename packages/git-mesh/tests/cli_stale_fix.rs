//! CLI: `git mesh stale --fix` — re-anchor drifted Moved/Changed records
//! in place by editing the mesh worktree files. Plan §"Phase 2".

mod support;

use anyhow::Result;
use sha2::{Digest, Sha256};
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_mesh(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".mesh").join(name);
    Ok(std::fs::read_to_string(path)?)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    sha256_hex(slice.join("\n").as_bytes())
}

fn seed_mesh(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.mesh_stdout(["add", name, anchor])?;
    repo.mesh_stdout(["why", name, "-m", why])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Listing all anchors (Human format, no flag)
// ---------------------------------------------------------------------------

#[test]
fn lists_all_anchors_in_all_fresh_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "all fresh"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    let stdout = repo.mesh_stdout(["stale"])?;
    assert!(stdout.contains("## m"), "block heading; stdout=\n{stdout}");
    assert!(
        stdout.contains("file1.txt#L1-L5"),
        "first fresh anchor must render as bare bullet; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("file2.txt#L1-L5"),
        "second fresh anchor must render as bare bullet; stdout=\n{stdout}"
    );
    // Stored order: file1 then file2.
    let p1 = stdout.find("file1.txt#L1-L5").unwrap();
    let p2 = stdout.find("file2.txt#L1-L5").unwrap();
    assert!(p1 < p2, "stored order preserved; stdout=\n{stdout}");
    Ok(())
}

#[test]
fn lists_all_anchors_in_mixed_mesh_in_stored_order() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Stored order: [file1#L1-L5 (will drift Changed), file2#L1-L5 (fresh),
    // file1#L6-L10 (fresh), file2#L11-L15 (will drift Changed)].
    repo.mesh_stdout([
        "add", "m",
        "file1.txt#L1-L5",
        "file2.txt#L1-L5",
        "file1.txt#L6-L10",
        "file2.txt#L11-L15",
    ])?;
    repo.mesh_stdout(["why", "m", "-m", "mixed"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // Drift file1 line 1 and file2 line 13.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file(
        "file2.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nlineTHIRTEEN\nline14\nline15\nline16\n",
    )?;

    let out = repo.run_mesh(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    // All four addresses appear, in stored order.
    let a = stdout.find("file1.txt#L1-L5").expect("first");
    let b = stdout.find("file2.txt#L1-L5").expect("second");
    let c = stdout.find("file1.txt#L6-L10").expect("third");
    let d = stdout.find("file2.txt#L11-L15").expect("fourth");
    assert!(a < b && b < c && c < d, "stored order: stdout=\n{stdout}");
    // The drifted ones carry status prose.
    assert!(
        stdout.contains("file1.txt#L1-L5 — changed")
            || stdout.contains("file1.txt#L1-L5 — Changed"),
        "first anchor must carry changed prose; stdout=\n{stdout}"
    );
    Ok(())
}

#[test]
fn lists_all_anchors_with_no_drift_at_all() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "a", "file1.txt#L1-L5", "a")?;
    seed_mesh(&repo, "b", "file2.txt#L1-L5", "b")?;
    let out = repo.run_mesh(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("## a"), "mesh a; stdout=\n{stdout}");
    assert!(stdout.contains("## b"), "mesh b; stdout=\n{stdout}");
    assert!(
        stdout.contains("file1.txt#L1-L5"),
        "anchor a; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("file2.txt#L1-L5"),
        "anchor b; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

// ---------------------------------------------------------------------------
// --fix behavior
// ---------------------------------------------------------------------------

#[test]
fn fix_rewrites_changed_anchor_at_worktree_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Edit the worktree only (no commit, no stage).
    let new_content =
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;

    let out = repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    assert!(
        out.status.success() || out.status.code() == Some(0),
        "fix run; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );

    let mesh = read_mesh(&repo, "m")?;
    let expected = line_slice_hash(new_content, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 sha256:{expected}")),
        "mesh file must carry rewritten hash; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_rewrites_changed_at_index_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Stage an edit but do not commit; leave worktree matching the index.
    let staged =
        "lineSTG\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", staged)?;
    repo.run_git(["add", "file1.txt"])?;
    // Worktree clean of further edits (matches index).

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let expected = line_slice_hash(staged, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 sha256:{expected}")),
        "mesh must hash staged content; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_rewrites_changed_at_head_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Commit a change to file1, then re-anchor.
    let new_content =
        "lineHEAD\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "edit file1"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let expected = line_slice_hash(new_content, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 sha256:{expected}")),
        "mesh must hash HEAD content; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_rewrites_moved_anchor_at_worktree_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Rename file1.txt → renamed.txt without touching content. Resolver
    // sees the original path missing and the stored hash at the new path
    // → Moved.
    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename"])?;

    let _ = original;
    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.contains("renamed.txt#L1-L5 sha256:"),
        "mesh must reference renamed path; got:\n{mesh}"
    );
    assert!(
        !mesh.contains("file1.txt#L1-L5"),
        "old anchor address gone; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_skips_deleted_anchor_and_keeps_in_listing() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Delete the source path.
    std::fs::remove_file(repo.path().join("file1.txt"))?;

    let before = read_mesh(&repo, "m")?;
    let out = repo.run_mesh(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_mesh(&repo, "m")?;
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
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "mix"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // file1: fixable Changed (worktree edit).
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // file2: unfixable Deleted.
    std::fs::remove_file(repo.path().join("file2.txt"))?;

    let out = repo.run_mesh(["stale", "--fix"])?;
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
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;
    let out = repo.run_mesh(["stale", "--fix", "--format", "json"])?;
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
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let head_before = repo.head_sha()?;
    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let head_after = repo.head_sha()?;
    assert_eq!(head_before, head_after, "no commit produced");
    // Worktree diff should show mesh file change.
    let diff = repo.git_stdout(["diff", "--name-only"])?;
    assert!(
        diff.contains(".mesh/m"),
        "mesh file is in worktree diff; diff={diff}"
    );
    Ok(())
}

#[test]
fn fix_preserves_mesh_file_anchor_order() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout([
        "add", "m",
        "file2.txt#L1-L5",
        "file1.txt#L1-L5",
        "file2.txt#L11-L15",
    ])?;
    repo.mesh_stdout(["why", "m", "-m", "order"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // Drift line 1 of both files (so two of three anchors are Changed).
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file(
        "file2.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\n",
    )?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let a = mesh.find("file2.txt#L1-L5").expect("first");
    let b = mesh.find("file1.txt#L1-L5").expect("second");
    let c = mesh.find("file2.txt#L11-L15").expect("third");
    assert!(a < b && b < c, "anchor order preserved; mesh:\n{mesh}");
    Ok(())
}

#[test]
fn fix_skips_terminal_statuses() -> Result<()> {
    // Currently exercised via deleted (other terminal statuses — ContentUnavailable,
    // MergeConflict, Submodule, Orphaned — require more elaborate setup; deleted is
    // representative because all terminal statuses are handled by the same
    // `!matches!(status, Moved | Changed)` skip).
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;
    std::fs::remove_file(repo.path().join("file1.txt"))?;
    let before = read_mesh(&repo, "m")?;
    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let after = read_mesh(&repo, "m")?;
    assert_eq!(before, after);
    Ok(())
}

// ---------------------------------------------------------------------------
// Machine-format parity (drifted input)
// ---------------------------------------------------------------------------

#[test]
fn json_porcelain_unchanged_for_drifted_input() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // JSON: should still report the single drifted finding only (no Fresh entries).
    let out = repo.run_mesh(["stale", "--format", "json", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("CHANGED") || stdout.to_lowercase().contains("changed"),
        "json output mentions changed status; got:\n{stdout}"
    );
    // Porcelain
    let out = repo.run_mesh(["stale", "--format", "porcelain", "--no-exit-code"])?;
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
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.mesh_stdout(["why", "m", "-m", "adjacent"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    let out = repo.run_mesh(["stale", "--fix"])?;
    assert_eq!(out.status.code(), Some(0), "no residual drift after merge");

    let mesh = read_mesh(&repo, "m")?;
    let file1 =
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    let expected = line_slice_hash(file1, 1, 10);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L10 sha256:{expected}")),
        "ranges must collapse into L1-L10 with recomputed hash; mesh:\n{mesh}"
    );
    assert!(
        !mesh.contains("file1.txt#L1-L5") && !mesh.contains("file1.txt#L6-L10"),
        "original fragmented ranges must be gone; mesh:\n{mesh}"
    );
    Ok(())
}

/// Overlapping ranges collapse into the union of their lines.
#[test]
fn fix_coalesces_overlapping_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file2.txt#L1-L10", "file2.txt#L5-L15"])?;
    repo.mesh_stdout(["why", "m", "-m", "overlap"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    repo.run_mesh(["stale", "--fix"])?;

    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.contains("file2.txt#L1-L15"),
        "overlapping ranges collapse to L1-L15; mesh:\n{mesh}"
    );
    assert!(
        !mesh.contains("file2.txt#L1-L10") && !mesh.contains("file2.txt#L5-L15"),
        "original overlapping ranges must be gone; mesh:\n{mesh}"
    );
    Ok(())
}

/// A gap larger than one line between ranges is not contiguous: the ranges
/// stay distinct.
#[test]
fn fix_leaves_non_contiguous_ranges_separate() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file2.txt#L1-L5", "file2.txt#L8-L12"])?;
    repo.mesh_stdout(["why", "m", "-m", "gap"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    repo.run_mesh(["stale", "--fix"])?;

    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.contains("file2.txt#L1-L5") && mesh.contains("file2.txt#L8-L12"),
        "non-contiguous ranges (gap > 1) stay separate; mesh:\n{mesh}"
    );
    Ok(())
}

/// Ranges on a deleted (terminal) path are never coalesced — the merge must
/// not paper over drift the operator still needs to see.
#[test]
fn fix_does_not_coalesce_terminal_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.mesh_stdout(["why", "m", "-m", "terminal"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    std::fs::remove_file(repo.path().join("file1.txt"))?;
    let before = read_mesh(&repo, "m")?;
    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let after = read_mesh(&repo, "m")?;
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
    repo.mesh_stdout(["add", "m", "file1.txt", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "mixed"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.lines().any(|l| l.starts_with("file1.txt sha256:")),
        "whole-file anchor stays inert; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains("file1.txt#L1-L5"),
        "line-range anchor with no contiguous partner is left as-is; mesh:\n{mesh}"
    );
    Ok(())
}

/// Three contiguous ranges collapse transitively into one anchor.
#[test]
fn fix_coalesces_chain_of_three() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout([
        "add", "m",
        "file2.txt#L1-L5",
        "file2.txt#L6-L10",
        "file2.txt#L11-L15",
    ])?;
    repo.mesh_stdout(["why", "m", "-m", "chain"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    repo.run_mesh(["stale", "--fix"])?;

    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.contains("file2.txt#L1-L15"),
        "three contiguous ranges collapse to L1-L15; mesh:\n{mesh}"
    );
    Ok(())
}
