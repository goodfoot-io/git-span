//! Reproduction for card main-395: `git span drift` mislabels fully-committed
//! drift on a whole-file anchor as "changed in the working tree", even though
//! `git status --porcelain` reports a clean tree.
//!
//! Root cause: `resolve_whole_file` in
//! `src/resolver/engine/whole_file.rs` picks `deepest` as whichever scan
//! layer is deepest-*enabled* (worktree > index > head), not the shallowest
//! layer that actually shows drift, then uses `deepest` unconditionally as
//! the reported `source`. Since `git span drift` enables worktree scanning
//! by default, `source` is always `DriftSource::Worktree`, so
//! `format_drift_label` in `src/cli/drift_label.rs` always renders "changed
//! in the working tree" — even when the drift is fully committed and
//! `layer_sources` correctly shows `Index`/`Head` too.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn committed_whole_file_drift_is_not_labeled_working_tree() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("foo.txt", "V1\nline2\nline3\n")?;
    repo.commit_all("seed")?;

    // Whole-file anchor (no line range) records the V1 fingerprint.
    repo.run_span(["add", "s", "foo.txt"])?;
    repo.run_span(["why", "s", "why s"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span"])?;

    // Commit a drift so HEAD == index == worktree all differ from the
    // fingerprint. The tree is clean afterward — nothing to `git
    // add`/`commit`.
    repo.write_file("foo.txt", "V2_CHANGED\nline2\nline3\n")?;
    repo.commit_all("drift")?;
    repo.write_commit_graph()?;

    let status = repo.run_git(["status", "--porcelain"])?;
    assert!(
        String::from_utf8_lossy(&status.stdout).trim().is_empty(),
        "fixture assumption: worktree must be clean after committing the drift"
    );

    let drift = repo.span_stdout(["drift", "s", "--no-exit-code"])?;
    assert!(
        !drift.contains("changed in the working tree"),
        "drift is fully committed (clean tree) — must not be labeled \
         'changed in the working tree'; drift=\n{drift}"
    );
    Ok(())
}
