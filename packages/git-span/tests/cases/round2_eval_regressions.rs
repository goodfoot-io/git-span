//! Round-2 evaluation regression tests.
//!
//! - R2-A1: relocated stored content (different path or range; line +
//!   whole-file; committed `git mv` + staged copy-then-replace) →
//!   `Moved`; the word `orphaned`/`Orphaned` never appears in stale
//!   output, and a committed relocation is not mislabeled
//!   "in the working tree".
//! - R2-A2: an unmerged/conflicted span file → `Conflict`,
//!   `git span stale` exits non-zero, and `git span <span>` (show)
//!   refuses to present conflict-marker content (fail-closed).
//! - R2-A4: the card-named read-mode flags `--head` / `--staged` /
//!   `--worktree` each select the right layered view.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Seed a committed line-anchor span.
fn seed_line(repo: &TestRepo, span: &str, file: &str, s: u32, e: u32) -> Result<()> {
    repo.span_stdout(["add", span, &format!("{file}#L{s}-L{e}")])?;
    repo.span_stdout(["why", span, "seed"])?;
    repo.commit_all("seed span")?;
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

    let stale = repo.span_stdout(["stale", "m", "--no-exit-code"])?;
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
    repo.span_stdout(["add", "m", "orig.ts"])?;
    repo.span_stdout(["why", "m", "seed"])?;
    repo.commit_all("seed span")?;
    repo.write_commit_graph()?;

    repo.run_git(["mv", "orig.ts", "dest.ts"])?;
    repo.run_git(["commit", "-m", "git mv orig->dest"])?;
    repo.write_commit_graph()?;

    let stale = repo.span_stdout(["stale", "m", "--no-exit-code"])?;
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

    let stale = repo.span_stdout(["stale", "m", "--no-exit-code"])?;
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
// R2-A2: conflicted span file fails closed
// ---------------------------------------------------------------------------

/// A merge-conflicted span file (`UU`, stage 1/2/3 index entries) →
/// `git span stale` reports `conflict` and exits non-zero;
/// `git span <span>` refuses to render the conflict-marker content.
#[test]
fn merge_conflicted_span_file_is_conflict_and_fails_closed() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("file.txt", "content\n")?;
    repo.commit_all("init")?;
    repo.span_stdout(["add", "m/a", "file.txt"])?;
    repo.span_stdout(["why", "m/a", "main version"])?;
    repo.commit_all("span on main")?;

    repo.run_git(["checkout", "-b", "feature"])?;
    repo.span_stdout(["why", "m/a", "feature DIVERGENT version"])?;
    repo.commit_all("span on feature")?;

    repo.run_git(["checkout", "main"])?;
    repo.span_stdout(["why", "m/a", "main CHANGED version"])?;
    repo.commit_all("span changed on main")?;

    // Diverged why text on both sides → content merge conflict.
    let merge = repo.run_git(["merge", "feature"]);
    assert!(merge.is_err(), "test precondition: merge must conflict");
    let status = repo.git_stdout(["status", "--porcelain", ".span/m/a"])?;
    assert!(
        status.starts_with("UU"),
        "test precondition: .span/m/a must be UU; status={status}"
    );

    // stale (no --no-exit-code) must surface Conflict and exit non-zero.
    let stale = repo.run_span(["stale"])?;
    let stale_out = String::from_utf8_lossy(&stale.stdout);
    assert!(
        stale.status.code() != Some(0),
        "stale on a conflicted span must exit non-zero; code={:?} stdout=\n{stale_out}",
        stale.status.code()
    );
    assert!(
        stale_out.to_lowercase().contains("conflict"),
        "stale must report the span as Conflict; stdout=\n{stale_out}"
    );

    // show must refuse conflict-marker content (fail-closed: error, not
    // garbage why text containing <<<<<<< / >>>>>>>).
    let show = repo.run_span(["m/a"])?;
    let show_out = String::from_utf8_lossy(&show.stdout);
    let show_err = String::from_utf8_lossy(&show.stderr);
    assert!(
        show.status.code() != Some(0),
        "show on a conflicted span must exit non-zero; code={:?}",
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

