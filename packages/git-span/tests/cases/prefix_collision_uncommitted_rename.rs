//! Reproduction: `git span add <child>` after a colliding span is renamed
//! in the worktree + index (but not committed).
//!
//! Hypothesis: `SpanFileReader::list_span_names` naively unions worktree +
//! HEAD + index names without applying tombstone semantics, so a name that
//! still exists in HEAD but has been deleted in the index/worktree (via a
//! two-step rename) is still reported. `check_worktree_prefix_collision`
//! then sees the stale pre-rename name `a/b` and rejects `git span add
//! a/b/c` even though `a/b` no longer exists in the worktree or index.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn add_child_succeeds_after_uncommitted_two_step_rename_of_blocker() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Commit a blocker span `a/b` anchored at a real file.
    repo.span_stdout(["add", "a/b", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "a/b", "-m", "blocker span that will be renamed away"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span a/b"])?;

    // Two-step rename `a/b` -> `tmp-blocker-hold` -> `a/b/index`. Both
    // moves edit the worktree span files and `git span` stages them, but
    // we do NOT commit. After this, HEAD still has `a/b`, while the index
    // and worktree have `a/b/index` (a child of `a/b`).
    repo.span_stdout(["move", "a/b", "tmp-blocker-hold"])?;
    repo.span_stdout(["move", "tmp-blocker-hold", "a/b/index"])?;
    repo.run_git(["add", "-A", ".span"])?;

    // Sanity: HEAD still carries the stale `a/b` blob (uncommitted rename).
    let head_tree = repo.git_stdout(["ls-tree", "-r", "--name-only", "HEAD"])?;
    assert!(
        head_tree.contains(".span/a/b"),
        "precondition: HEAD must still contain the pre-rename `.span/a/b`, got: {head_tree}"
    );

    // Now add a sibling child span `a/b/c`. With the rename effective in
    // worktree+index, `a/b` no longer exists as a leaf span, so this must
    // succeed. (Current code consults HEAD's stale `a/b` and rejects it.)
    let out = repo.run_span(["add", "a/b/c", "file2.txt#L1-L5"])?;

    assert_eq!(
        out.status.code(),
        Some(0),
        "`git span add a/b/c` should succeed after the uncommitted rename of `a/b`; \
         stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    Ok(())
}
