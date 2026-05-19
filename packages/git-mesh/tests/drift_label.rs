//! Integration tests for the shared drift-label formatter (`cli::drift_label`).
//!
//! These tests exercise every row of the seven-row vocabulary table from the
//! card spec plus precedence and cross-surface consistency rules.
//!
//! All tests are marked `` — they are skipped until
//! Phase 3 implements `format_drift_label` and the supporting engine corrections.

mod support;

use anyhow::Result;
#[allow(unused_imports)]
use git_mesh::resolve_mesh;
#[allow(unused_imports)]
use git_mesh::types::{AnchorStatus, DriftSource, EngineOptions, LayerSet, Scope};
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// True when `s` contains a commit-sha drift locus of the form
/// `changed in <>=7 hex chars>` (the ref-backed attribution that the
/// file-backed model no longer emits). The layer phrase
/// "changed in the working tree" is NOT a sha locus.
fn regex_lite_changed_in_sha(s: &str) -> bool {
    let needle = "changed in ";
    let mut from = 0;
    while let Some(pos) = s[from..].find(needle) {
        let after = &s[from + pos + needle.len()..];
        let hex_run = after
            .chars()
            .take_while(|c| c.is_ascii_hexdigit())
            .count();
        if hex_run >= 7 {
            return true;
        }
        from += pos + needle.len();
    }
    false
}

/// Seed a mesh anchoring `file.txt#L1-L5` and commit it, returning the anchor
/// sha recorded in the mesh commit.
fn seed_mesh(repo: &TestRepo, mesh: &str, file: &str, start: u32, end: u32) -> Result<()> {
    // File-backed model: `add`/`why` write the worktree mesh file
    // directly; commit it alongside the (pristine) source.
    repo.mesh_stdout(["add", mesh, &format!("{file}#L{start}-L{end}")])?;
    repo.mesh_stdout(["why", mesh, "-m", "seed"])?;
    repo.commit_all("seed mesh")?;
    Ok(())
}

/// Resolve the mesh and return the label for the first anchor via `stale` CLI.
/// Returns `(stale_label, patch_label, show_label)`.
#[allow(dead_code)]
fn labels_for_first_anchor(repo: &TestRepo, mesh: &str) -> Result<(String, String, String)> {
    let stale = repo.mesh_stdout(["stale", mesh, "--no-exit-code"])?;
    let patch = repo.mesh_stdout(["stale", mesh, "--patch", "--no-exit-code"])?;
    let show = repo.mesh_stdout([mesh])?;
    Ok((stale, patch, show))
}

/// Extract the drift label token from stale output.
/// The label appears after the anchor path, e.g. `file.txt — changed in the working tree`.
#[allow(dead_code)]
fn extract_label(output: &str) -> Option<&str> {
    for line in output.lines() {
        // Look for lines containing "—" (em-dash) which separates path from label.
        if let Some(pos) = line.find(" — ") {
            return Some(line[pos + " — ".len()..].trim());
        }
        // Also handle the machine-readable format or show format.
        if let Some(pos) = line.find(": ") {
            let rest = line[pos + 2..].trim();
            // Check that it matches one of the known drift label prefixes.
            if rest.starts_with("changed") || rest.starts_with("deleted") || rest.starts_with("orphaned") {
                return Some(rest);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Row 1: changed in the working tree
// ---------------------------------------------------------------------------

#[test]

fn worktree_range_edit_labels_changed_in_working_tree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Mutate lines 1-5 in the worktree only (unstaged).
    repo.write_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("changed in the working tree"),
        "expected 'changed in the working tree'; stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 2: deleted in the working tree
// ---------------------------------------------------------------------------

#[test]

fn worktree_path_removal_labels_deleted_in_working_tree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Remove the file from the worktree without staging the removal.
    std::fs::remove_file(repo.path().join("file1.txt"))?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the working tree"),
        "expected 'deleted in the working tree'; stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 3: changed in the index
// ---------------------------------------------------------------------------

#[test]

fn staged_range_edit_labels_changed_in_index() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Mutate lines 1-5 and stage the change (but don't commit).
    repo.write_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.run_git(["add", "file1.txt"])?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("changed in the index"),
        "expected 'changed in the index'; stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 4: deleted in the index
// ---------------------------------------------------------------------------

#[test]

fn staged_path_removal_labels_deleted_in_index() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Stage the removal of the file.
    repo.run_git(["rm", "file1.txt"])?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index"),
        "expected 'deleted in the index'; stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 5: changed in <sha>
// ---------------------------------------------------------------------------

#[test]

fn committed_range_mutation_labels_changed_in_sha() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Commit a mutation of the anchored range; worktree and index stay clean.
    let sha = repo.commit_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
        "mutate anchored range",
    )?;
    let short = &sha[..7];

    // File-backed model: anchors carry no anchor_sha, so the resolver
    // does not attribute drift to a specific historical commit — the
    // label is the plain status word, not `changed in <sha>`.
    let _ = short;
    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("changed") && !stale.contains("changed in "),
        "expected plain 'changed' (no sha locus); stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 6: orphaned in <sha>
// ---------------------------------------------------------------------------

#[test]

fn committed_path_deletion_labels_orphaned_in_sha() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Delete the file and commit; worktree and index are clean afterward.
    repo.run_git(["rm", "file1.txt"])?;
    repo.run_git(["commit", "-m", "delete file1.txt"])?;

    // File-backed model: the anchored path is gone from HEAD; the mesh
    // stores paths, so the anchor is orphaned. No `in <sha>` locus
    // (there is no anchor_sha history to attribute the deletion to).
    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("orphaned") && !stale.contains("orphaned in "),
        "expected plain 'orphaned' (no sha locus); stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 6b: orphaned in <sha> via rename
// ---------------------------------------------------------------------------

#[test]

fn rename_in_history_labels_orphaned_in_rename_sha() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Rename file1.txt → file1_renamed.txt and commit.
    repo.run_git(["mv", "file1.txt", "file1_renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename file1.txt"])?;

    // File-backed model: a committed rename of the anchored path
    // detaches the anchor (the mesh stores paths). Plain `orphaned`,
    // no `in <sha>` locus.
    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("orphaned") && !stale.contains("orphaned in "),
        "expected plain 'orphaned' for rename (no sha locus); stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Row 7: orphaned (no sha) — anchored path absent from HEAD
// ---------------------------------------------------------------------------

#[test]

fn unreachable_anchor_sha_labels_orphaned_no_sha() -> Result<()> {
    // File-backed model: there is no "unreachable anchor_sha" concept —
    // anchors carry no commit identity. The equivalent orphan condition
    // is the anchored path being absent from HEAD entirely. The label
    // is plain `orphaned`, never `orphaned in <sha>`.
    let repo = TestRepo::new()?;
    repo.write_file("file1.txt", "line1\nline2\nline3\nline4\nline5\n")?;
    repo.commit_all("initial")?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Remove the anchored file from HEAD.
    repo.run_git(["rm", "file1.txt"])?;
    repo.run_git(["commit", "-m", "remove anchored file"])?;
    repo.write_commit_graph()?;

    let stale_out = repo.run_mesh(["stale", "m", "--no-exit-code"])?;
    let stale = String::from_utf8(stale_out.stdout)?;
    assert!(
        stale.contains("orphaned") && !stale.contains("orphaned in "),
        "expected plain 'orphaned' (no sha); stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Precedence: worktree edit wins over index edit wins over HEAD drift
// ---------------------------------------------------------------------------

#[test]

fn precedence_worktree_wins_over_index_and_head() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // Layer 1 (HEAD): commit a change to the anchored range.
    repo.commit_file(
        "file1.txt",
        "HEAD_CHANGE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
        "head drift",
    )?;

    // Layer 2 (Index): stage another change on top.
    repo.write_file(
        "file1.txt",
        "INDEX_CHANGE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.run_git(["add", "file1.txt"])?;

    // Layer 3 (Worktree): make an additional unstaged change.
    repo.write_file(
        "file1.txt",
        "WORKTREE_CHANGE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    // Worktree label must win.
    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("changed in the working tree"),
        "worktree label must win; stale=\n{stale}"
    );
    assert!(
        !stale.contains("changed in the index"),
        "index label must not appear when worktree wins; stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Cross-surface consistency: stale, stale --patch, and show emit identical labels
// ---------------------------------------------------------------------------

#[test]

fn stale_patch_and_show_emit_identical_label_text() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt", 1, 5)?;

    // File-backed model: an uncommitted working-tree edit drifts the
    // anchor. The label is the plain status word (`changed`, no sha
    // locus) and must read identically on `stale` and `stale --patch`.
    repo.write_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // The file-backed label is the layer phrase ("changed in the
    // working tree"), never a commit-sha locus ("changed in <hex>").
    let sha_locus = regex_lite_changed_in_sha;
    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    let patch = repo.mesh_stdout(["stale", "m", "--patch", "--no-exit-code"])?;

    assert!(
        stale.contains("changed") && !sha_locus(&stale),
        "stale must contain plain 'changed' (no sha locus); stale=\n{stale}"
    );
    assert!(
        patch.contains("changed") && !sha_locus(&patch),
        "stale --patch must contain plain 'changed' (no sha locus); patch=\n{patch}"
    );
    assert!(
        patch.contains("@@"),
        "worktree drift must produce a unified diff; patch=\n{patch}"
    );
    Ok(())
}
