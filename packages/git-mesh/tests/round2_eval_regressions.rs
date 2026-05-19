//! Round-2 evaluation regression tests.
//!
//! - R2-A1: relocated stored content (different path or range; line +
//!   whole-file; committed `git mv` + staged copy-then-replace) →
//!   `Moved`; the word `orphaned`/`Orphaned` never appears in stale
//!   output, and a committed relocation is not mislabeled
//!   "in the working tree".
//! - R2-A2: an unmerged/conflicted mesh file → `Conflict`,
//!   `git mesh stale` exits non-zero, and `git mesh <mesh>` (show)
//!   refuses to present conflict-marker content (fail-closed).
//! - R2-A4: the card-named read-mode flags `--head` / `--staged` /
//!   `--worktree` each select the right layered view.

mod support;

use anyhow::Result;
use support::TestRepo;

/// Seed a committed line-anchor mesh.
fn seed_line(repo: &TestRepo, mesh: &str, file: &str, s: u32, e: u32) -> Result<()> {
    repo.mesh_stdout(["add", mesh, &format!("{file}#L{s}-L{e}")])?;
    repo.mesh_stdout(["why", mesh, "-m", "seed"])?;
    repo.commit_all("seed mesh")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// R2-A1: relocation classification
// ---------------------------------------------------------------------------

/// Committed `git mv` of an anchored line range to a different
/// subdirectory path → `Moved` to the new path; no `orphaned` leak; the
/// label is not the misleading "in the working tree" (the relocation is
/// committed, not a worktree edit).
#[test]
fn committed_git_mv_line_anchor_subdir_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a/src.ts", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("init")?;
    repo.write_commit_graph()?;
    seed_line(&repo, "m", "a/src.ts", 2, 4)?;
    repo.write_commit_graph()?;

    std::fs::create_dir_all(repo.path().join("b"))?;
    repo.run_git(["mv", "a/src.ts", "b/moved.ts"])?;
    repo.run_git(["commit", "-m", "git mv a->b"])?;
    repo.write_commit_graph()?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("moved") && stale.contains("b/moved.ts"),
        "committed git mv of a line range must read 'moved' to the new path; stale=\n{stale}"
    );
    assert!(
        !stale.to_lowercase().contains("orphan"),
        "the word 'orphaned' must never appear in stale output; stale=\n{stale}"
    );
    assert!(
        !stale.contains("in the working tree"),
        "a committed relocation must not be mislabeled 'in the working tree'; stale=\n{stale}"
    );
    Ok(())
}

/// Committed `git mv` of a whole-file anchor to a different path →
/// `Moved`; no `orphaned` leak; not "in the working tree".
#[test]
fn committed_git_mv_whole_file_subdir_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("orig.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("init")?;
    repo.write_commit_graph()?;
    repo.mesh_stdout(["add", "m", "orig.ts"])?;
    repo.mesh_stdout(["why", "m", "-m", "seed"])?;
    repo.commit_all("seed mesh")?;
    repo.write_commit_graph()?;

    repo.run_git(["mv", "orig.ts", "dest.ts"])?;
    repo.run_git(["commit", "-m", "git mv orig->dest"])?;
    repo.write_commit_graph()?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("moved") && stale.contains("dest.ts"),
        "committed git mv of a whole-file anchor must read 'moved' to the new path; stale=\n{stale}"
    );
    assert!(
        !stale.to_lowercase().contains("orphan"),
        "the word 'orphaned' must never appear in stale output; stale=\n{stale}"
    );
    assert!(
        !stale.contains("in the working tree"),
        "a committed relocation must not be mislabeled 'in the working tree'; stale=\n{stale}"
    );
    Ok(())
}

/// Verbatim copy-then-replace, staged: content duplicated to a new path,
/// original overwritten, both staged → `Moved` to the copy, not
/// "changed in the index".
#[test]
fn staged_copy_then_replace_line_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src.ts", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("other.ts", "x\ny\nz\n")?;
    repo.commit_all("init")?;
    repo.write_commit_graph()?;
    seed_line(&repo, "m", "src.ts", 2, 4)?;
    repo.write_commit_graph()?;

    repo.write_file("copy.ts", "a1\na2\na3\na4\na5\n")?;
    repo.write_file("src.ts", "REPLACED\n")?;
    repo.run_git(["add", "copy.ts", "src.ts"])?;

    let stale = repo.mesh_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(
        stale.contains("moved") && stale.contains("copy.ts"),
        "staged copy-then-replace must read 'moved' to the copy, not 'changed in the index'; stale=\n{stale}"
    );
    assert!(
        !stale.to_lowercase().contains("orphan"),
        "the word 'orphaned' must never appear in stale output; stale=\n{stale}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// R2-A2: conflicted mesh file fails closed
// ---------------------------------------------------------------------------

/// A merge-conflicted mesh file (`UU`, stage 1/2/3 index entries) →
/// `git mesh stale` reports `conflict` and exits non-zero;
/// `git mesh <mesh>` refuses to render the conflict-marker content.
#[test]
fn merge_conflicted_mesh_file_is_conflict_and_fails_closed() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("file.txt", "content\n")?;
    repo.commit_all("init")?;
    repo.mesh_stdout(["add", "m/a", "file.txt"])?;
    repo.mesh_stdout(["why", "m/a", "-m", "main version"])?;
    repo.commit_all("mesh on main")?;

    repo.run_git(["checkout", "-b", "feature"])?;
    repo.mesh_stdout(["why", "m/a", "-m", "feature DIVERGENT version"])?;
    repo.commit_all("mesh on feature")?;

    repo.run_git(["checkout", "main"])?;
    repo.mesh_stdout(["why", "m/a", "-m", "main CHANGED version"])?;
    repo.commit_all("mesh changed on main")?;

    // Diverged why text on both sides → content merge conflict.
    let merge = repo.run_git(["merge", "feature"]);
    assert!(merge.is_err(), "test precondition: merge must conflict");
    let status = repo.git_stdout(["status", "--porcelain", ".mesh/m/a"])?;
    assert!(
        status.starts_with("UU"),
        "test precondition: .mesh/m/a must be UU; status={status}"
    );

    // stale (no --no-exit-code) must surface Conflict and exit non-zero.
    let stale = repo.run_mesh(["stale"])?;
    let stale_out = String::from_utf8_lossy(&stale.stdout);
    assert!(
        stale.status.code() != Some(0),
        "stale on a conflicted mesh must exit non-zero; code={:?} stdout=\n{stale_out}",
        stale.status.code()
    );
    assert!(
        stale_out.to_lowercase().contains("conflict"),
        "stale must report the mesh as Conflict; stdout=\n{stale_out}"
    );

    // show must refuse conflict-marker content (fail-closed: error, not
    // garbage why text containing <<<<<<< / >>>>>>>).
    let show = repo.run_mesh(["m/a"])?;
    let show_out = String::from_utf8_lossy(&show.stdout);
    let show_err = String::from_utf8_lossy(&show.stderr);
    assert!(
        show.status.code() != Some(0),
        "show on a conflicted mesh must exit non-zero; code={:?}",
        show.status.code()
    );
    assert!(
        !show_out.contains("<<<<<<<") && !show_out.contains(">>>>>>>"),
        "show must not present conflict markers as why text; stdout=\n{show_out}"
    );
    assert!(
        show_err.to_lowercase().contains("conflict"),
        "show must explain the conflict on stderr; stderr=\n{show_err}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// R2-A4: card-named read-mode flags
// ---------------------------------------------------------------------------

/// `--head`, `--staged`, `--worktree` each select the correct layered
/// view. A change committed since the anchor is visible under every
/// mode; a staged-only change is visible under `--staged`/`--worktree`
/// but not `--head`; a worktree-only change is visible only under
/// `--worktree`.
#[test]
fn read_mode_flags_select_layers() -> Result<()> {
    // --head sees a committed drift even with a clean index/worktree.
    let repo = TestRepo::seeded()?;
    seed_line(&repo, "m", "file1.txt", 1, 3)?;
    repo.commit_file(
        "file1.txt",
        "HEAD_CHANGE\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n",
        "head drift",
    )?;
    for flag in ["--head", "--staged", "--worktree"] {
        let out = repo.mesh_stdout(["stale", "m", flag, "--no-exit-code"])?;
        assert!(
            out.contains("changed"),
            "committed drift must be visible under {flag}; out=\n{out}"
        );
    }

    // Staged-only change: visible under --staged/--worktree, not --head.
    let repo2 = TestRepo::seeded()?;
    seed_line(&repo2, "m", "file1.txt", 1, 3)?;
    repo2.write_file(
        "file1.txt",
        "STAGED\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n",
    )?;
    repo2.run_git(["add", "file1.txt"])?;
    let head_only = repo2.mesh_stdout(["stale", "m", "--head", "--no-exit-code"])?;
    assert!(
        !head_only.contains("changed"),
        "--head must ignore a staged-only change; out=\n{head_only}"
    );
    for flag in ["--staged", "--worktree"] {
        let out = repo2.mesh_stdout(["stale", "m", flag, "--no-exit-code"])?;
        assert!(
            out.contains("changed"),
            "{flag} must see a staged change; out=\n{out}"
        );
    }

    // Worktree-only change: visible only under --worktree.
    let repo3 = TestRepo::seeded()?;
    seed_line(&repo3, "m", "file1.txt", 1, 3)?;
    repo3.write_file(
        "file1.txt",
        "WT\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n",
    )?;
    for flag in ["--head", "--staged"] {
        let out = repo3.mesh_stdout(["stale", "m", flag, "--no-exit-code"])?;
        assert!(
            !out.contains("changed"),
            "{flag} must ignore a worktree-only change; out=\n{out}"
        );
    }
    let wt = repo3.mesh_stdout(["stale", "m", "--worktree", "--no-exit-code"])?;
    assert!(
        wt.contains("changed"),
        "--worktree must see a worktree-only change; out=\n{wt}"
    );
    Ok(())
}
