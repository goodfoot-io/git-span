//! CLI: `git mesh stale --fix` — re-anchor drifted Moved/Changed records
//! in place by editing the mesh worktree files. Plan §"Phase 2".

use crate::support;

use anyhow::Result;
use git_mesh_core::{cheap_fingerprint_with_extent, rk64_to_hex};
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_mesh(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".mesh").join(name);
    Ok(std::fs::read_to_string(path)?)
}

fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    rk64_to_hex(cheap_fingerprint_with_extent(
        slice.join("\n").as_bytes(),
        &git_mesh_core::AnchorExtent::WholeFile,
    ))
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
fn fully_fresh_mesh_is_absent_from_scan() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "all fresh"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    let stdout = repo.mesh_stdout(["stale"])?;
    // A scan is a drift report: a fully-fresh mesh does not surface.
    assert!(
        !stdout.contains("## m"),
        "fully-fresh mesh must not surface in a scan; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("0 stale"),
        "summary line must appear; stdout=\n{stdout}"
    );
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
fn no_drift_scan_lists_no_meshes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "a", "file1.txt#L1-L5", "a")?;
    seed_mesh(&repo, "b", "file2.txt#L1-L5", "b")?;
    let out = repo.run_mesh(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // No mesh has drifted: the scan prints only the summary line.
    assert!(!stdout.contains("## a"), "mesh a must not surface; stdout=\n{stdout}");
    assert!(!stdout.contains("## b"), "mesh b must not surface; stdout=\n{stdout}");
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
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Meaning-changing worktree edit (no commit, no stage).
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
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(new_content, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "meaning-changed anchor must keep its original hash; got:\n{mesh}"
    );
    assert!(
        !mesh.contains(&broken),
        "meaning-changed anchor must NOT be re-anchored; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_leaves_changed_at_index_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Stage a meaning-changing edit; leave worktree matching the index.
    let staged =
        "lineSTG\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", staged)?;
    repo.run_git(["add", "file1.txt"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(staged, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "meaning-changed anchor must keep its original hash; got:\n{mesh}"
    );
    assert!(
        !mesh.contains(&broken),
        "meaning-changed anchor must NOT be re-anchored; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_leaves_changed_at_head_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Commit a meaning-changing edit to file1.
    let new_content =
        "lineHEAD\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "edit file1"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let broken = line_slice_hash(new_content, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "meaning-changed anchor must keep its original hash; got:\n{mesh}"
    );
    assert!(
        !mesh.contains(&broken),
        "meaning-changed anchor must NOT be re-anchored; got:\n{mesh}"
    );
    Ok(())
}

// Whitespace-only `Changed` edits ARE content-equivalent and must still be
// re-anchored (the gate's GREEN path) at the worktree and index layers.

#[test]
fn fix_reanchors_whitespace_only_changed_at_worktree_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Whitespace-only worktree edit: reindent line 1.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let expected = line_slice_hash(reindented, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{expected}")),
        "whitespace-only change must be re-anchored to current content; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_reanchors_whitespace_only_changed_at_index_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Whitespace-only edit, staged; worktree matches the index.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;
    repo.run_git(["add", "file1.txt"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let expected = line_slice_hash(reindented, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{expected}")),
        "whitespace-only staged change must be re-anchored; got:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_leaves_whitespace_only_changed_at_head_layer() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Commit a whitespace-only edit. Even though it is content-equivalent,
    // the equivalence gate is fail-closed at the HEAD layer: once the change
    // is committed, the *original* anchored bytes are gone from HEAD, so the
    // resolver cannot prove `a_slice` is the genuine original (its hash will
    // not match the recorded `stored_hash`). The anchor is therefore left
    // drifting rather than re-anchored to content we cannot verify is a pure
    // reshaping of the original.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "reindent file1"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let original = line_slice_hash(ORIGINAL, 1, 5);
    let reanchored = line_slice_hash(reindented, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{original}")),
        "HEAD-layer whitespace change is fail-closed: original hash retained; got:\n{mesh}"
    );
    assert!(
        !mesh.contains(&reanchored),
        "HEAD-layer whitespace change must NOT be re-anchored; got:\n{mesh}"
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
        mesh.contains("renamed.txt#L1-L5 rk64:"),
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
    // Whitespace-only edit so the anchor is re-anchored (content-equivalent)
    // and the mesh file actually changes on disk.
    repo.write_file(
        "file1.txt",
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
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
    // Canonical order: (path, start_line, end_line) ascending.
    let a = mesh.find("file1.txt#L1-L5").expect("first");
    let b = mesh.find("file2.txt#L1-L5").expect("second");
    let c = mesh.find("file2.txt#L11-L15").expect("third");
    assert!(a < b && b < c, "canonical order expected; mesh:\n{mesh}");
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
        mesh.contains(&format!("file1.txt#L1-L10 rk64:{expected}")),
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
        mesh.lines().any(|l| l.starts_with("file1.txt rk64:")),
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
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.mesh_stdout(["why", "m", "-m", "head-layer"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // Commit a change touching both ranges, leaving the worktree clean: the
    // drift surfaces at the Head layer, not the worktree.
    let new_content =
        "lineHEAD\nline2\nline3\nline4\nline5\nlineSIX\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", new_content)?;
    repo.run_git(["add", "file1.txt"])?;
    repo.run_git(["commit", "-m", "edit file1"])?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let orig1 = line_slice_hash(ORIGINAL, 1, 5);
    let orig2 = line_slice_hash(ORIGINAL, 6, 10);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{orig1}")),
        "first range left drifting with its original hash; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains(&format!("file1.txt#L6-L10 rk64:{orig2}")),
        "second range left drifting with its original hash; mesh:\n{mesh}"
    );
    assert!(
        !mesh.contains("file1.txt#L1-L10"),
        "non-worktree-layer ranges must not collapse into L1-L10; mesh:\n{mesh}"
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

    // Mesh with standard conflict markers.  Ours has file1.txt#L1-L5,
    // theirs has file2.txt#L1-L5.  Both source files exist and are clean
    // => each anchor is only on one side, merge resolves via re-hash.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let h2 = line_slice_hash(FILE2, 1, 5);
    let mesh_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file2.txt#L1-L5 rk64:{h2}
>>>>>>> theirs
"
    );
    repo.write_file(".mesh/m", &mesh_content)?;

    let out = repo.run_mesh(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("resolved conflict") && stdout.contains("all anchors merged clean"),
        "expected clean resolution message; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "clean resolution must exit 0");

    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "file1 anchor; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains(&format!("file2.txt#L1-L5 rk64:{h2}")),
        "file2 anchor; mesh:\n{mesh}"
    );
    assert!(
        !mesh.contains("<<<<<<<"),
        "conflict markers must be removed; mesh:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_clean_source_precondition() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Mesh conflict referencing file1.txt.  Overwrite file1.txt itself
    // with conflict markers so read_clean_source_files fails closed.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let mesh_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L5 rk64:{h1}
=======
file1.txt#L1-L5 rk64:{h1}
>>>>>>> theirs
"
    );
    repo.write_file(".mesh/m", &mesh_content)?;

    // Make the referenced source file carry conflict markers.
    repo.write_file(
        "file1.txt",
        "<<<<<<< HEAD\nline1\n=======\nline1 changed\n>>>>>>> branch\n",
    )?;

    let out = repo.run_mesh(["stale", "--fix"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("source file") && stderr.contains("conflict markers"),
        "stderr must warn about the conflicted source file; stderr=\n{stderr}"
    );
    // The mesh file must still carry markers (not resolved).
    let raw = read_mesh(&repo, "m")?;
    assert!(
        raw.contains("<<<<<<<"),
        "mesh must remain conflicted; raw:\n{raw}"
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
    let mesh_content = format!(
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
    repo.write_file(".mesh/m", &mesh_content)?;

    let out = repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
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
    let mesh = read_mesh(&repo, "m")?;
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{h1}")),
        "anchor must appear clean; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains("<<<<<<<"),
        "why conflict markers must remain; mesh:\n{mesh}"
    );
    assert!(mesh.contains("our rationale"), "our why; mesh:\n{mesh}");
    assert!(mesh.contains("their rationale"), "their why; mesh:\n{mesh}");
    Ok(())
}

#[test]
fn fix_union_of_divergent_anchors() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Ours has file1.txt#L1-L3, theirs has file1.txt#L5-L7.
    // Different ranges on the same path -- no hash conflict => clean union.
    let h_a = line_slice_hash(ORIGINAL, 1, 3);
    let h_b = line_slice_hash(ORIGINAL, 5, 7);
    let mesh_content = format!(
        "\
<<<<<<< ours
file1.txt#L1-L3 rk64:{h_a}
=======
file1.txt#L5-L7 rk64:{h_b}
>>>>>>> theirs
"
    );
    repo.write_file(".mesh/m", &mesh_content)?;

    let out = repo.run_mesh(["stale", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("resolved conflict"),
        "expected clean resolution; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "clean union must exit 0");

    // Both anchors appear, in canonical (path, start, end) order.
    let mesh = read_mesh(&repo, "m")?;
    let pos_a = mesh.find(&format!("file1.txt#L1-L3 rk64:{h_a}"));
    let pos_b = mesh.find(&format!("file1.txt#L5-L7 rk64:{h_b}"));
    assert!(pos_a.is_some() && pos_b.is_some(), "both anchors present");
    assert!(
        pos_a.unwrap() < pos_b.unwrap(),
        "canonical order L1-L3 before L5-L7; mesh:\n{mesh}"
    );
    assert!(
        !mesh.contains("<<<<<<<"),
        "no conflict markers; mesh:\n{mesh}"
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
    let mesh_content = format!(
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
    repo.write_file(".mesh/m", &mesh_content)?;

    let out = repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("partial resolution"),
        "expected partial resolution; stdout=\n{stdout}"
    );

    let mesh = read_mesh(&repo, "m")?;
    // Both anchors appear clean (outside marker lines go to both sides,
    // inside anchor is identical on both sides).
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{h_out}")),
        "outside anchor appears; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains(&format!("file2.txt#L1-L3 rk64:{h_in}")),
        "inside anchor appears; mesh:\n{mesh}"
    );
    // Why conflict block remains.
    assert!(
        mesh.contains("<<<<<<<"),
        "why conflict block present; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains("our refined purpose"),
        "our why preserved; mesh:\n{mesh}"
    );
    assert!(
        mesh.contains("their refined purpose"),
        "their why preserved; mesh:\n{mesh}"
    );
    Ok(())
}

#[test]
fn fix_no_restage_for_residue() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Commit a clean mesh first so we have a HEAD/index baseline.
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "original why")?;

    // Overwrite with conflict markers where anchors match but why
    // diverges => partial resolution (residue).  The resolved anchors
    // must NOT be staged by --fix.
    let h1 = line_slice_hash(ORIGINAL, 1, 5);
    let mesh_content = format!(
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
    repo.write_file(".mesh/m", &mesh_content)?;

    let out = repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("partial resolution"),
        "expected partial resolution; stdout=\n{stdout}"
    );

    // The mesh file must NOT be staged (cached diff).
    let cached = repo.git_stdout(["diff", "--cached", "--name-only"])?;
    assert!(
        !cached.contains(".mesh/m"),
        "mesh must not be staged; cached=[{cached}]"
    );

    // The worktree diff SHOULD show the mesh was modified.
    let wt_diff = repo.git_stdout(["diff", "--name-only"])?;
    assert!(
        wt_diff.contains(".mesh/m"),
        "mesh must appear in worktree diff; diff=[{wt_diff}]"
    );
    Ok(())
}
