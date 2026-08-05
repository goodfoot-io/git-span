//! Reproduction test for card main-105: `run_add` re-reads the git index
//! and opens the repository ~4 times per anchor instead of once.
//!
//! The invariant this test enforces: for its fixture (2 whole-file + 1
//! line-range anchor), `index_entries` is called exactly **7** times during
//! a single `run_add` invocation. Before the fix, `run_add` called it per
//! anchor in the existence probe, twice inside `validate_add_target` (via
//! `submodule_classify` and `is_tracked_path`), and once inside
//! `hash_anchor_content` (via the `gitlink_oid` closure) — for N anchors,
//! the count was ~4·N.
//!
//! The remaining loads are bounded — nothing scales with line-range anchor
//! count — and split across the mutation pipeline and the post-write
//! reconcile check (card main-207, plan `reconciliation-output.md`):
//!
//! 1. **Mutation-pipeline snapshot** — 1 load: `index_entries` is loaded
//!    once at the top of `run_add` and threaded through every
//!    anchor-processing site (`validate_add_target`, existence probe,
//!    `hash_anchor_content`).
//! 2. **Reconcile-check span reads** — 2 loads: the check resolves the
//!    touched span through `resolve_named_spans_with_state`, which reads
//!    the span twice — once for the reverse-walk pre-pass
//!    (`read_effective_each_parallel`) and once in the per-span resolve.
//!    Each `read_effective` probes the index once for an unmerged span
//!    entry (`is_unmerged_in_index`).
//! 3. **Whole-file layer probes** — 2 loads per whole-file anchor
//!    (`index_entry_for` + `is_gitlink_path`): the file-backed span model
//!    records no blob OID, so the resolver's whole-file Fresh fast path
//!    (which needs `head_blob == r.blob`) can never fire; the two probes
//!    are intrinsic to whole-file layer comparison. Line-range anchors add
//!    no loads.
//!
//! Total for this fixture: 1 + 2 + 2·2 = 7. Adding whole-file anchors
//! costs exactly 2 each; adding line-range anchors costs 0. The index is
//! never re-materialized per anchor.

use crate::support;

use anyhow::Result;
use git_span::cli::AddArgs;
use git_span::cli::AddFormat;
use git_span::cli::commit::run_add;
use git_span::{index_entries_call_count, reset_index_entries_call_count};
use support::TestRepo;

#[test]
fn run_add_calls_index_entries_exactly_once() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let gix_repo = repo.gix_repo()?;

    // Reset the per-test counter before the call.
    reset_index_entries_call_count();

    let args = AddArgs {
        name: "test-span".into(),
        anchors: vec![
            "file1.txt".into(),
            "file2.txt".into(),
            "file1.txt#L1-L5".into(),
        ],
        at: None,
        format: AddFormat::Human,
    };

    run_add(&gix_repo, args, ".span")?;

    let count = index_entries_call_count();
    assert_eq!(
        count, 7,
        "index_entries called {count} times — expected exactly 7 for this \
         fixture (1 mutation-pipeline snapshot + 2 reconcile-check span \
         reads + 2 whole-file layer probes × 2 whole-file anchors). \
         The index is being re-materialized per anchor instead of once."
    );

    Ok(())
}
