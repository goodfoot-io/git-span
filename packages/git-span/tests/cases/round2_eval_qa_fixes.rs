//! Round-2 manual-QA regression tests.
//!
//! - R2-C1: `git span add` is fail-closed on unsafe/invalid anchor
//!   source paths (absolute / `..` / inside-`.git` / nonexistent) and
//!   still accepts a legitimate whole-file submodule gitlink anchor
//!   (plan D2: deterministic recorded-OID identity).
//! - R2-C2: a pure deletion with no relocation match — committed,
//!   staged, worktree; whole-file and a line range that no longer
//!   exists — classifies `Deleted`, never `Changed`; a real relocation
//!   still classifies `Moved`.
//! - R2-C3: `delete`/`move` prune now-empty parent dirs (root + siblings
//!   preserved); a malformed `show` surfaces only the parse error; the
//!   `add` success line has no ref-era "anchored at HEAD (sha)"; a
//!   `Moved` whole-file `--stat` row shows `moved`, not `+x -0`.

use crate::support;

use anyhow::Result;
use support::TestRepo;

// ---------------------------------------------------------------------------
// R2-C1: anchor source-path validation (fail-closed)
// ---------------------------------------------------------------------------

fn add_rejects(repo: &TestRepo, path: &str) -> Result<()> {
    let out = repo.run_span(["add", "bad/x", path])?;
    anyhow::ensure!(
        !out.status.success(),
        "`git span add bad/x {path}` must exit non-zero (fail-closed); \
         stdout={} stderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

#[test]
fn add_rejects_absolute_anchor_path() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    add_rejects(&repo, "/etc/passwd")
}

#[test]
fn add_rejects_parent_ref_anchor_path() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    add_rejects(&repo, "../outside.txt")
}

#[test]
fn add_rejects_inside_dotgit_anchor_path() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    add_rejects(&repo, ".git/config")
}

#[test]
fn add_rejects_nonexistent_anchor_path() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    add_rejects(&repo, "nonexistent.txt")
}

#[test]
fn add_accepts_legitimate_anchor_path() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    // A real, tracked path must still be accepted.
    let out = repo.run_span(["add", "ok/y", "f.txt"])?;
    anyhow::ensure!(
        out.status.success(),
        "a legitimate anchor path must still be accepted; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

#[test]
fn add_accepts_submodule_gitlink_whole_file_anchor() -> Result<()> {
    // Plan D2: a whole-file pin on a submodule gitlink root is valid and
    // deterministic (identity is the recorded commit OID), so `add` must
    // succeed — not be rejected by the new path/existence validation.
    let sub = TestRepo::new()?;
    sub.write_file("a.txt", "content\n")?;
    sub.commit_all("sub init")?;

    let repo = TestRepo::new()?;
    repo.write_file("r.txt", "root\n")?;
    repo.commit_all("init")?;
    let url = sub.path().to_string_lossy().to_string();
    repo.run_git([
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        &url,
        "sub",
    ])?;
    repo.run_git(["commit", "-m", "add submodule"])?;

    let out = repo.run_span(["add", "demo/s", "sub"])?;
    anyhow::ensure!(
        out.status.success(),
        "a whole-file submodule gitlink anchor is valid per plan D2 and \
         must be accepted deterministically; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// R2-C2: pure deletion → Deleted (never Changed)
// ---------------------------------------------------------------------------

/// Seed a span with a line anchor and a whole-file anchor, committed.
fn seed_two_anchors(repo: &TestRepo) -> Result<()> {
    repo.write_file("src/foo.txt", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.write_file("src/bar.txt", "bar\n")?;
    repo.commit_all("init")?;
    repo.span_stdout(["add", "demo/flow", "src/foo.txt#L2-L4"])?;
    repo.span_stdout(["add", "demo/flow", "src/bar.txt"])?;
    repo.span_stdout(["why", "demo/flow", "seed"])?;
    repo.commit_all("seed span")?;
    Ok(())
}

fn stale(repo: &TestRepo) -> Result<String> {
    repo.span_stdout(["stale", "--no-exit-code"])
}

#[test]
fn committed_whole_file_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    repo.run_git(["rm", "src/bar.txt"])?;
    repo.run_git(["commit", "-m", "rm bar"])?;
    let s = stale(&repo)?;
    assert!(
        s.contains("src/bar.txt") && s.contains("deleted"),
        "committed whole-file deletion must read 'deleted'; stale=\n{s}"
    );
    assert!(
        !s.contains("src/bar.txt — changed"),
        "deletion must not be mislabeled 'changed'; stale=\n{s}"
    );
    Ok(())
}

#[test]
fn staged_whole_file_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    repo.run_git(["rm", "src/bar.txt"])?;
    let s = stale(&repo)?;
    assert!(
        s.contains("src/bar.txt") && s.contains("deleted"),
        "staged whole-file deletion must read 'deleted'; stale=\n{s}"
    );
    Ok(())
}

#[test]
fn worktree_whole_file_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    std::fs::remove_file(repo.path().join("src/bar.txt"))?;
    let s = stale(&repo)?;
    assert!(
        s.contains("src/bar.txt") && s.contains("deleted"),
        "worktree whole-file deletion must read 'deleted'; stale=\n{s}"
    );
    Ok(())
}

#[test]
fn committed_line_anchor_file_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    repo.run_git(["rm", "src/foo.txt"])?;
    repo.run_git(["commit", "-m", "rm foo"])?;
    let s = stale(&repo)?;
    assert!(
        s.contains("src/foo.txt#L2-L4") && s.contains("deleted"),
        "committed line-anchor file deletion must read 'deleted'; stale=\n{s}"
    );
    Ok(())
}

#[test]
fn line_anchor_range_no_longer_exists_is_deleted() -> Result<()> {
    // The file still exists but is truncated past the anchored range's
    // start, with no relocation match for the stored content. The
    // tracked region is gone — this is `Deleted`, not `Changed`.
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    repo.write_file("src/foo.txt", "only\n")?;
    let s = stale(&repo)?;
    assert!(
        s.contains("src/foo.txt#L2-L4") && s.contains("deleted"),
        "a line range that no longer exists (no relocation) must read \
         'deleted', not 'changed'; stale=\n{s}"
    );
    assert!(
        !s.contains("src/foo.txt#L2-L4 — changed"),
        "the vanished range must not be mislabeled 'changed'; stale=\n{s}"
    );
    Ok(())
}

#[test]
fn relocated_line_anchor_still_moved_not_deleted() -> Result<()> {
    // Guard the working `Moved` path: a real relocation must not be
    // swept into the new `Deleted` branch.
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    std::fs::create_dir_all(repo.path().join("dst"))?;
    repo.run_git(["mv", "src/foo.txt", "dst/foo.txt"])?;
    let s = stale(&repo)?;
    assert!(
        s.contains("moved") && s.contains("dst/foo.txt"),
        "a relocated line anchor must still read 'moved'; stale=\n{s}"
    );
    assert!(
        !s.contains("src/foo.txt#L2-L4 — deleted"),
        "a relocation must not be mislabeled 'deleted'; stale=\n{s}"
    );
    Ok(())
}

#[test]
fn in_place_line_change_still_changed() -> Result<()> {
    // Guard: a genuine in-place edit (file long enough, content differs,
    // no relocation) must still be `Changed`, not the new `Deleted`.
    let repo = TestRepo::new()?;
    seed_two_anchors(&repo)?;
    repo.write_file("src/foo.txt", "l1\nX\nY\nZ\nl5\n")?;
    let s = stale(&repo)?;
    assert!(
        s.contains("src/foo.txt#L2-L4") && s.contains("changed"),
        "a genuine in-place line change must still read 'changed'; \
         stale=\n{s}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// R2-C3: cosmetic / low-severity cleanups
// ---------------------------------------------------------------------------

#[test]
fn delete_prunes_empty_parent_dirs() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    repo.span_stdout(["add", "bulk/foo", "f.txt"])?;
    assert!(repo.path().join(".span/bulk").is_dir());

    repo.span_stdout(["delete", "bulk/foo"])?;
    assert!(
        !repo.path().join(".span/bulk").exists(),
        "the now-empty `.span/bulk/` parent dir must be pruned"
    );
    assert!(
        repo.path().join(".span").is_dir(),
        "the span root itself must be preserved"
    );
    Ok(())
}

#[test]
fn delete_keeps_non_empty_parent_with_sibling() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    repo.span_stdout(["add", "grp/a", "f.txt"])?;
    repo.span_stdout(["add", "grp/b", "f.txt"])?;
    repo.span_stdout(["delete", "grp/a"])?;
    assert!(
        repo.path().join(".span/grp/b").is_file(),
        "a sibling span under the same parent must be preserved"
    );
    Ok(())
}

#[test]
fn add_success_message_has_no_ref_era_framing() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    let out = repo.span_stdout(["add", "m/x", "f.txt"])?;
    assert!(
        !out.contains("anchored at"),
        "the add success message must not carry ref-era \
         'anchored at HEAD (sha)' framing; got=\n{out}"
    );
    assert!(
        out.contains("Added 1 anchor to span `m/x`."),
        "the add success message must reflect the tracked-file \
         workflow; got=\n{out}"
    );
    Ok(())
}

#[test]
fn malformed_show_surfaces_only_parse_error() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;
    std::fs::create_dir_all(repo.path().join(".span"))?;
    std::fs::write(repo.path().join(".span/broken"), "garbage not valid\n")?;

    let out = repo.run_span(["show", "broken"])?;
    anyhow::ensure!(
        !out.status.success(),
        "showing a malformed span must exit non-zero"
    );
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        combined.contains("invalid span file"),
        "a malformed span's `show` must surface the parse error; got=\n{combined}"
    );
    assert!(
        !combined.contains("no span named"),
        "a span that exists but fails to parse must not be reported as \
         'no span named'; got=\n{combined}"
    );
    Ok(())
}

