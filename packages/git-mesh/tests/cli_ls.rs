//! Integration tests for `git mesh list` — block format, porcelain, search,
//! pagination, path filter, staged/pending markers.

mod support;

use anyhow::Result;
use std::io::Write;
use std::process::{Command, Stdio};
use support::TestRepo;

/// Create a mesh with a single anchor and why text, then commit the
/// `.mesh/<name>` file. File-backed model: `add`/`why` write the
/// worktree mesh file directly; a git commit makes it part of HEAD.
fn commit_mesh(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.mesh_stdout(["add", name, anchor])?;
    repo.mesh_stdout(["why", name, "-m", why])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", &format!("mesh {name}")])?;
    Ok(())
}

fn mesh_stdout_with_stdin(repo: &TestRepo, args: &[&str], stdin: &str) -> Result<String> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_git-mesh"))
        .current_dir(repo.path())
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .as_mut()
        .expect("child stdin should be piped")
        .write_all(stdin.as_bytes())?;
    let out = child.wait_with_output()?;
    anyhow::ensure!(
        out.status.success(),
        "git-mesh failed (code {:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?)
}

// ---------------------------------------------------------------------------
// Bare git mesh → short help
// ---------------------------------------------------------------------------

#[test]
fn bare_git_mesh_prints_help_exit_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh::<[&str; 0], &str>([])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        stdout.contains("Usage:"),
        "expected Usage: in bare output, got: {stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Empty repo
// ---------------------------------------------------------------------------

#[test]
fn ls_empty_repo_prints_no_meshes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.mesh_stdout(["list"])?;
    assert_eq!(out.trim(), "No meshes match the filters.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Block format
// ---------------------------------------------------------------------------

#[test]
fn ls_one_committed_mesh_block_format() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(
        &repo,
        "alpha",
        "file1.txt#L1-L5",
        "the parser honors the spec",
    )?;
    let out = repo.mesh_stdout(["list"])?;
    // Heading uses ## and no backticks, no state marker.
    assert!(out.contains("## alpha"), "expected '## alpha' heading, got: {out}");
    assert!(
        !out.contains("- `alpha`"),
        "heading must not use backticks: {out}"
    );
    // Anchor address rendered in full.
    assert!(
        out.contains("- file1.txt#L1-L5"),
        "expected anchor bullet, got: {out}"
    );
    // Why text appears verbatim (no `Why:` prefix).
    assert!(
        out.contains("the parser honors the spec"),
        "expected why text, got: {out}"
    );
    assert!(!out.contains("Why:"), "no `Why:` prefix in new format: {out}");
    // No state marker for committed
    assert!(
        !out.contains("(staged)") && !out.contains("(pending)"),
        "unexpected state marker, got: {out}"
    );
    Ok(())
}

#[test]
fn ls_alphabetical_order() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "zebra", "file1.txt#L1-L3", "z why")?;
    commit_mesh(&repo, "alpha", "file1.txt#L4-L5", "a why")?;
    let out = repo.mesh_stdout(["list"])?;
    let alpha_pos = out.find("## alpha").expect("alpha in output");
    let zebra_pos = out.find("## zebra").expect("zebra in output");
    assert!(alpha_pos < zebra_pos, "alpha should come before zebra");
    Ok(())
}

#[test]
fn ls_staged_marker_on_committed_mesh_with_staged_ops() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(
        &repo,
        "alpha",
        "file1.txt#L1-L5",
        "the spec governs the parser",
    )?;
    // File-backed model: `git mesh add` edits the worktree mesh file
    // directly — there is no staging area or "pending" state. The mesh
    // now simply has both anchors, each rendered as a plain bullet.
    repo.mesh_stdout(["add", "alpha", "file2.txt#L1-L3"])?;
    let out = repo.mesh_stdout(["list"])?;
    assert!(out.contains("## alpha"), "expected '## alpha' heading: {out}");
    assert!(
        !out.contains("(staged)") && !out.contains("(pending)"),
        "no state markers on heading: {out}"
    );
    assert!(
        !out.contains("pending add"),
        "no staging-area pending markers in the file-backed model: {out}"
    );
    assert!(
        out.contains("- file1.txt#L1-L5"),
        "expected first anchor bullet: {out}"
    );
    assert!(
        out.contains("- file2.txt#L1-L3"),
        "expected second anchor bullet: {out}"
    );
    Ok(())
}

#[test]
fn ls_pending_marker_on_staging_only_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // File-backed model: `add`/`why` write the worktree mesh file
    // directly (no git commit needed). The mesh is immediately visible
    // in `list` as a normal mesh — no "pending"/"staged" state exists.
    repo.mesh_stdout(["add", "pending-mesh", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "pending-mesh", "-m", "pending relationship"])?;
    let out = repo.mesh_stdout(["list"])?;
    assert!(out.contains("## pending-mesh"), "expected '## pending-mesh': {out}");
    assert!(
        !out.contains("(pending)") && !out.contains("(staged)"),
        "no state markers on heading: {out}"
    );
    assert!(
        !out.contains("pending add"),
        "no staging-area pending markers in the file-backed model: {out}"
    );
    // Anchor rendered as a plain bullet.
    assert!(
        out.contains("- file1.txt#L1-L5"),
        "expected anchor bullet: {out}"
    );
    // Full why text rendered verbatim (no `Why:` prefix).
    assert!(
        out.contains("pending relationship"),
        "expected why text: {out}"
    );
    assert!(!out.contains("Why:"), "no `Why:` prefix: {out}");
    Ok(())
}

#[test]
fn ls_multiline_why_renders_all_lines() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "multi", "file1.txt#L1-L5"])?;
    // Use -m with newline embedded.
    repo.mesh_stdout(["why", "multi", "-m", "line one\nline two\nline three"])?;
    let out = repo.mesh_stdout(["list"])?;
    // Every line of why is rendered verbatim.
    assert!(out.contains("line one"), "expected line one: {out}");
    assert!(out.contains("line two"), "expected line two: {out}");
    assert!(out.contains("line three"), "expected line three: {out}");
    Ok(())
}

#[test]
fn ls_whole_file_anchor_renders_whole_label() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Whole-file anchor (no #L anchor).
    commit_mesh(&repo, "wf", "file1.txt", "whole file relationship")?;
    let out = repo.mesh_stdout(["list"])?;
    assert!(out.contains("## wf"), "expected '## wf' heading: {out}");
    // Whole-file anchor renders as bare path (no `#L` and no `(whole file)`).
    assert!(
        out.contains("- file1.txt\n"),
        "expected bare-path bullet for whole-file anchor: {out}"
    );
    assert!(
        !out.contains("(whole"),
        "no whole-file decoration: {out}"
    );
    Ok(())
}

#[test]
fn ls_staged_flag_removed_and_meshes_listed_plainly() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "clean", "file1.txt#L1-L3", "clean mesh")?;
    repo.mesh_stdout(["add", "pending-m", "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "pending-m", "-m", "no more staging"])?;
    commit_mesh(&repo, "dirty", "file2.txt#L5-L7", "dirty mesh")?;
    repo.mesh_stdout(["add", "dirty", "file1.txt#L5-L6"])?;

    // File-backed model: there is no staging area, so the `--staged`
    // filter flag was removed from `list`. clap rejects it (exit 2).
    let out = repo.run_mesh(["list", "--staged"])?;
    assert_eq!(
        out.status.code(),
        Some(2),
        "`--staged` must be an unknown argument: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    // All meshes (committed or worktree-only) are visible in a plain
    // `list` as ordinary meshes with no pending markers.
    let plain = repo.mesh_stdout(["list"])?;
    assert!(plain.contains("## clean"), "clean should appear: {plain}");
    assert!(plain.contains("## pending-m"), "pending-m should appear: {plain}");
    assert!(plain.contains("## dirty"), "dirty should appear: {plain}");
    assert!(
        !plain.contains("pending add"),
        "no staging-area pending markers: {plain}"
    );
    assert!(
        plain.contains("- file2.txt#L5-L7") && plain.contains("- file1.txt#L5-L6"),
        "dirty's anchors should both be listed plainly: {plain}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Path filter
// ---------------------------------------------------------------------------

#[test]
fn ls_path_filter_includes_matching_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "beta why")?;
    let out = repo.mesh_stdout(["list", "file1.txt"])?;
    assert!(out.contains("## alpha"), "alpha should appear: {out}");
    assert!(!out.contains("## beta"), "beta should not appear: {out}");
    Ok(())
}

#[test]
fn ls_path_filter_renders_full_anchor_list() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // alpha has two anchors; filter by file1.txt.
    repo.mesh_stdout(["add", "alpha", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["add", "alpha", "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "alpha", "-m", "dual anchor"])?;
    let out = repo.mesh_stdout(["list", "file1.txt"])?;
    // Both anchors should appear in the bullet list, not just the matching one.
    assert!(
        out.contains("- file1.txt#L1-L5"),
        "expected file1 anchor: {out}"
    );
    assert!(
        out.contains("- file2.txt#L1-L3"),
        "expected file2 anchor: {out}"
    );
    Ok(())
}

#[test]
fn ls_path_range_filter_overlaps_correctly() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "overlap", "file1.txt#L3-L7", "overlap why")?;
    commit_mesh(&repo, "nooverlap", "file1.txt#L8-L10", "no-overlap why")?;
    // Query L5-L6, should match overlap (L3-L7) but not nooverlap (L8-L10).
    let out = repo.mesh_stdout(["list", "file1.txt#L5-L6"])?;
    assert!(out.contains("## overlap"), "expected overlap: {out}");
    assert!(
        !out.contains("## nooverlap"),
        "nooverlap should not appear: {out}"
    );
    Ok(())
}

#[test]
fn ls_whole_file_anchor_matches_any_range_query() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "wf", "file1.txt", "whole file")?;
    // A anchor query on the same path should match the whole-file anchor.
    let out = repo.mesh_stdout(["list", "file1.txt#L1-L5"])?;
    assert!(out.contains("## wf"), "expected wf: {out}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Porcelain
// ---------------------------------------------------------------------------

#[test]
fn ls_porcelain_emits_tab_separated_rows() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    let out = repo.mesh_stdout(["list", "--porcelain"])?;
    // Should be: name\tpath\tstart-end
    assert!(
        out.contains("alpha\tfile1.txt\t1-5"),
        "expected porcelain row, got: {out}"
    );
    Ok(())
}

#[test]
fn ls_porcelain_whole_file_is_zero_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "wf", "file1.txt", "whole")?;
    let out = repo.mesh_stdout(["list", "--porcelain"])?;
    assert!(
        out.contains("wf\tfile1.txt\t0-0"),
        "expected 0-0 for whole-file, got: {out}"
    );
    Ok(())
}

#[test]
fn ls_porcelain_pending_mesh_appears() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "pend", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "pend", "-m", "pending"])?;
    let out = repo.mesh_stdout(["list", "--porcelain"])?;
    assert!(
        out.contains("pend\tfile1.txt\t1-5"),
        "expected pending mesh in porcelain, got: {out}"
    );
    Ok(())
}

#[test]
fn ls_filtered_porcelain_scans_mesh_files() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "beta why")?;

    // The path filter scans tracked `.mesh/` files directly; the path
    // index is derived from those files, not stored separately.
    let out = repo.mesh_stdout(["list", "file1.txt#L3-L4", "--porcelain"])?;
    assert!(
        out.contains("alpha\tfile1.txt\t1-5"),
        "alpha should match: {out}"
    );
    assert!(!out.contains("beta\t"), "beta should not match: {out}");
    Ok(())
}

#[test]
fn ls_filtered_porcelain_renders_full_anchor_list() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "alpha", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["add", "alpha", "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "alpha", "-m", "dual anchor"])?;

    let out = repo.mesh_stdout(["list", "file1.txt", "--porcelain"])?;

    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(
        lines,
        vec!["alpha\tfile1.txt\t1-5", "alpha\tfile2.txt\t1-3"]
    );
    Ok(())
}

#[test]
fn ls_filtered_porcelain_path_index_tracks_rename_and_delete() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;

    // File-backed model: meshes are tracked files under `.mesh/`. A
    // rename is a file rename; a delete removes the file. The path
    // filter scans mesh files, so it tracks both operations directly.
    let mesh_dir = repo.path().join(".mesh");
    std::fs::rename(mesh_dir.join("alpha"), mesh_dir.join("renamed"))?;

    // Path filter follows the renamed mesh file.
    let after_rename = repo.mesh_stdout(["list", "file1.txt#L3-L4", "--porcelain"])?;
    assert_eq!(after_rename.trim(), "renamed\tfile1.txt\t1-5");

    // Delete the mesh by removing its file.
    std::fs::remove_file(mesh_dir.join("renamed"))?;

    // Path filter now returns empty. file1.txt still exists in the
    // worktree, so a zero-match is fine — exit 0 silently rather than
    // erroring. The error contract only fires when the referent (file or
    // mesh) doesn't exist.
    let deleted_out = repo.run_mesh(["list", "file1.txt#L3-L4", "--porcelain"])?;
    assert_eq!(
        deleted_out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&deleted_out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&deleted_out.stdout).trim(),
        "No meshes match the filters.",
        "expected porcelain `no meshes` sentinel"
    );
    Ok(())
}

#[test]
fn list_existing_file_with_no_mesh_does_not_error() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // file2.txt exists in the worktree but no mesh tracks it.
    let out = repo.run_mesh(["list", "file2.txt"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.contains("no such file or mesh"),
        "must not surface diagnostic for an existing file, got: {stderr}"
    );
    Ok(())
}

#[test]
fn list_missing_file_arg_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["list", "no-such-file.txt"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`no-such-file.txt` did not match"),
        "expected CliError, got: {stderr}"
    );
    Ok(())
}

#[test]
fn list_missing_path_arg_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["list", "missing/dir/no-such.txt"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`missing/dir/no-such.txt` did not match"),
        "expected CliError, got: {stderr}"
    );
    Ok(())
}

#[test]
fn list_unmatched_glob_literal_errors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Shell would normally expand a glob; an unmatched glob is passed through
    // literally and must error like any other missing path.
    let out = repo.run_mesh(["list", "src/missing-*.ts"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("`src/missing-*.ts` did not match"),
        "expected CliError, got: {stderr}"
    );
    Ok(())
}

#[test]
fn ls_batch_porcelain_emits_hit_rows() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "beta why")?;

    let out = mesh_stdout_with_stdin(&repo, &["list", "--batch", "--porcelain"], "file1.txt\n")?;

    assert!(
        out.contains("alpha\tfile1.txt\t1-5"),
        "alpha should match: {out}"
    );
    assert!(!out.contains("beta\t"), "beta should not match: {out}");
    Ok(())
}

#[test]
fn ls_batch_porcelain_emits_no_meshes_for_miss() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;

    let out = mesh_stdout_with_stdin(&repo, &["list", "--batch", "--porcelain"], "missing.txt\n")?;

    assert_eq!(out.trim(), "no meshes");
    Ok(())
}

#[test]
fn ls_batch_porcelain_handles_multiple_queries() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "beta why")?;

    let out = mesh_stdout_with_stdin(
        &repo,
        &["list", "--batch", "--porcelain"],
        "file1.txt#L3-L4\nmissing.txt\nfile2.txt\n",
    )?;

    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(
        lines,
        vec!["alpha\tfile1.txt\t1-5", "no meshes", "beta\tfile2.txt\t1-3"]
    );
    Ok(())
}

#[test]
fn ls_batch_porcelain_includes_staged_only_meshes_across_queries() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "pending-one", "file1.txt#L1-L2"])?;
    repo.mesh_stdout(["add", "pending-two", "file2.txt#L1-L3"])?;

    let out = mesh_stdout_with_stdin(
        &repo,
        &["list", "--batch", "--porcelain"],
        "file1.txt#L1-L1\nfile2.txt#L2-L2\n",
    )?;

    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(
        lines,
        vec!["pending-one\tfile1.txt\t1-2", "pending-two\tfile2.txt\t1-3"]
    );
    Ok(())
}

#[test]
fn ls_batch_porcelain_includes_staged_adds_on_committed_meshes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    repo.mesh_stdout(["add", "alpha", "file2.txt#L1-L3"])?;

    let out = mesh_stdout_with_stdin(
        &repo,
        &["list", "--batch", "--porcelain"],
        "file1.txt#L3-L4\nfile2.txt#L2-L2\n",
    )?;

    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(
        lines,
        vec!["alpha\tfile1.txt\t1-5", "alpha\tfile2.txt\t1-3"]
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

#[test]
fn ls_search_matches_name() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "some why")?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "other why")?;
    let out = repo.mesh_stdout(["list", "--search", "alpha"])?;
    assert!(out.contains("## alpha"), "alpha should match: {out}");
    assert!(!out.contains("## beta"), "beta should not match: {out}");
    Ok(())
}

#[test]
fn ls_search_matches_why_line() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(
        &repo,
        "alpha",
        "file1.txt#L1-L5",
        "the parser honors the spec",
    )?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "unrelated relationship")?;
    let out = repo.mesh_stdout(["list", "--search", "parser"])?;
    assert!(out.contains("## alpha"), "alpha should match via why: {out}");
    assert!(!out.contains("## beta"), "beta should not match: {out}");
    Ok(())
}

#[test]
fn ls_search_matches_anchor_address() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L5", "alpha why")?;
    commit_mesh(&repo, "beta", "file2.txt#L1-L3", "beta why")?;
    let out = repo.mesh_stdout(["list", "--search", "file2"])?;
    assert!(!out.contains("## alpha"), "alpha should not match: {out}");
    assert!(out.contains("## beta"), "beta should match via anchor: {out}");
    Ok(())
}

#[test]
fn ls_search_case_insensitive_by_default() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(
        &repo,
        "alpha",
        "file1.txt#L1-L5",
        "The Parser Honors The Spec",
    )?;
    let out = repo.mesh_stdout(["list", "--search", "parser"])?;
    assert!(
        out.contains("## alpha"),
        "case-insensitive match expected: {out}"
    );
    Ok(())
}

#[test]
fn ls_search_case_sensitive_with_flag() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(
        &repo,
        "alpha",
        "file1.txt#L1-L5",
        "The Parser Honors The Spec",
    )?;
    // With (?-i), lowercase "parser" should NOT match "Parser"
    let out = repo.mesh_stdout(["list", "--search", "(?-i)parser"])?;
    assert_eq!(
        out.trim(),
        "No meshes match the filters.",
        "case-sensitive should not match: {out}"
    );
    Ok(())
}

#[test]
fn ls_search_invalid_regex_exits_two() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["list", "--search", "[invalid"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "expected exit 1 for invalid regex"
    );
    let stderr = String::from_utf8(out.stderr)?;
    assert!(
        stderr.contains("git mesh list:"),
        "expected error message, got: {stderr}"
    );
    assert!(
        stderr.contains("[invalid"),
        "expected pattern in error, got: {stderr}"
    );
    assert!(
        stderr.contains("What to do next"),
        "expected What to do next section, got: {stderr}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

#[test]
fn ls_offset_skips_first_meshes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L3", "alpha why")?;
    commit_mesh(&repo, "beta", "file1.txt#L4-L5", "beta why")?;
    // Offset 1 skips alpha (alphabetically first).
    let out = repo.mesh_stdout(["list", "--offset", "1"])?;
    assert!(!out.contains("## alpha"), "alpha should be skipped: {out}");
    assert!(out.contains("## beta"), "beta should appear: {out}");
    Ok(())
}

#[test]
fn ls_limit_caps_output() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L3", "alpha why")?;
    commit_mesh(&repo, "beta", "file1.txt#L4-L5", "beta why")?;
    let out = repo.mesh_stdout(["list", "--limit", "1"])?;
    assert!(out.contains("## alpha"), "alpha should appear: {out}");
    assert!(!out.contains("## beta"), "beta should be capped: {out}");
    Ok(())
}

#[test]
fn ls_offset_and_limit_select_second_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L3", "alpha why")?;
    commit_mesh(&repo, "beta", "file1.txt#L4-L5", "beta why")?;
    commit_mesh(&repo, "gamma", "file2.txt#L1-L3", "gamma why")?;
    let out = repo.mesh_stdout(["list", "--offset", "1", "--limit", "1"])?;
    assert!(!out.contains("## alpha"), "alpha skipped: {out}");
    assert!(out.contains("## beta"), "beta selected: {out}");
    assert!(!out.contains("## gamma"), "gamma capped: {out}");
    Ok(())
}

#[test]
fn ls_porcelain_pagination_emits_selected_mesh_rows() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.mesh_stdout(["add", "alpha", "file1.txt#L1-L3"])?;
    repo.mesh_stdout(["add", "alpha", "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "alpha", "-m", "alpha why"])?;
    commit_mesh(&repo, "beta", "file2.txt#L4-L5", "beta why")?;
    // --offset 1 selects beta in porcelain.
    let out = repo.mesh_stdout(["list", "--porcelain", "--offset", "1"])?;
    assert!(out.contains("beta\t"), "expected beta rows: {out}");
    assert!(!out.contains("alpha\t"), "alpha should be skipped: {out}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Glob path filter
//
// The CLI help and the `did not match` error both promise that positional
// arguments resolve as "mesh names, file paths, or globs". These tests pin
// that contract: an anchor at `wiki/meta/foo.md` must be reachable via
// `wiki/*` (single-segment) and `wiki/**/*` (recursive) globs.
// ---------------------------------------------------------------------------

#[test]
fn ls_recursive_glob_matches_nested_anchored_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("wiki/meta/notes.md", "a\nb\nc\n")?;
    repo.commit_all("add wiki notes")?;
    commit_mesh(&repo, "wiki/notes", "wiki/meta/notes.md", "wiki notes anchor")?;

    let out = repo.mesh_stdout(["list", "wiki/**/*"])?;
    assert!(
        out.contains("## wiki/notes"),
        "wiki/** should match wiki/meta/notes.md anchor: {out}"
    );
    Ok(())
}

#[test]
fn ls_single_star_glob_matches_single_segment_anchored_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("wiki/top.md", "a\nb\nc\n")?;
    repo.commit_all("add wiki top")?;
    commit_mesh(&repo, "wiki/top", "wiki/top.md", "wiki top anchor")?;

    let out = repo.mesh_stdout(["list", "wiki/*"])?;
    assert!(
        out.contains("## wiki/top"),
        "wiki/* should match wiki/top.md anchor: {out}"
    );
    Ok(())
}

#[test]
fn ls_single_star_glob_does_not_match_nested_segments() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("wiki/meta/deep.md", "a\nb\nc\n")?;
    repo.commit_all("add deep wiki")?;
    commit_mesh(&repo, "wiki/deep", "wiki/meta/deep.md", "deep anchor")?;

    // `wiki/*` is single-segment; the anchor is two segments deep, so the
    // glob should not match. Glob support being absent currently produces
    // a `did not match` error — once globs work, this still must fail
    // because the segment depth doesn't match.
    let out = repo.run_mesh(["list", "wiki/*"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "wiki/* should not match wiki/meta/deep.md"
    );
    Ok(())
}

#[test]
fn ls_pagination_after_path_filter() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_mesh(&repo, "alpha", "file1.txt#L1-L3", "alpha")?;
    commit_mesh(&repo, "beta", "file1.txt#L4-L5", "beta")?;
    commit_mesh(&repo, "gamma", "file2.txt#L1-L3", "gamma")?;
    // Filter by file1.txt (alpha and beta), then offset 1 → beta only.
    let out = repo.mesh_stdout(["list", "file1.txt", "--offset", "1"])?;
    assert!(!out.contains("## alpha"), "alpha skipped: {out}");
    assert!(out.contains("## beta"), "beta selected: {out}");
    assert!(!out.contains("## gamma"), "gamma not in filter: {out}");
    Ok(())
}
