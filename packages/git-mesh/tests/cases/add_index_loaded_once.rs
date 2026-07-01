//! Reproduction test for card main-105: `run_add` re-reads the git index
//! and opens the repository ~4 times per anchor instead of once.
//!
//! The invariant this test enforces: `index_entries` is called exactly once
//! during a single `run_add` invocation, regardless of how many anchors are
//! added. The current code calls it per anchor in the existence probe,
//! twice inside `validate_add_target` (via `submodule_classify` and
//! `is_tracked_path`), and once inside `hash_anchor_content` (via the
//! `gitlink_oid` closure) — so for N anchors, the count is ~4·N.
//!
//! After the fix, `index_entries` is loaded once at the top of `run_add`
//! and the snapshot is threaded through every anchor-processing site,
//! bringing the count to exactly 1.

use crate::support;

use anyhow::Result;
use git_mesh::cli::commit::run_add;
use git_mesh::cli::AddArgs;
use git_mesh::{index_entries_call_count, reset_index_entries_call_count};
use support::TestRepo;

#[test]
fn run_add_calls_index_entries_exactly_once() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix_repo = repo.gix_repo()?;

    // Reset the per-test counter before the call.
    reset_index_entries_call_count();

    let args = AddArgs {
        name: "test-mesh".into(),
        anchors: vec![
            "file1.txt".into(),
            "file2.txt".into(),
            "file1.txt#L1-L5".into(),
        ],
        at: None,
        replace: None,
    };

    run_add(&gix_repo, args, ".mesh")?;

    let count = index_entries_call_count();
    assert_eq!(
        count, 1,
        "index_entries called {count} times — expected exactly 1. \
         The index is being re-materialized per anchor instead of once."
    );

    Ok(())
}
