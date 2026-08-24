//! Card main-290 evidence: a corpus operation that reads one effective view
//! per span pays index materializations and HEAD peels **once per run**, not
//! once per span times several probes.
//!
//! `load_all_spans_in` reads one effective view per span through a single
//! shared `LayerSnapshot`. The counters below pin the per-run totals:
//!
//! - `index_entries_call_count == 1`: the snapshot's index capture folds one
//!   full materialization (the same call the per-span unmerged probe used to
//!   pay) and nothing else in the corpus load calls it.
//! - `load_index_call_count == 2`: the 3-layer *name discovery* scan
//!   (`collect_index_names`) loads the index directly once, and the capture
//!   materializes through it once (`index_entries` → `load_index`); every
//!   per-span probe answers from the capture, so nothing else does.
//! - `tree_entry_at_call_count == 0`: HEAD presence answers from the one
//!   resolved span-subtree map; no probe re-parses HEAD per name.
//!
//! All three are identical for different span counts K — constant per run,
//! not linear in spans.

use crate::support;

use anyhow::Result;
use git_span::span::read::load_all_spans_in;
use git_span::{
    index_entries_call_count, load_index_call_count, reset_index_entries_call_count,
    reset_load_index_call_count, reset_tree_entry_at_call_count, tree_entry_at_call_count,
};
use support::TestRepo;

/// Seed `k` committed spans, each anchored to its own file, then split them
/// across layer states so the per-span probes genuinely exercise the
/// snapshot's index and HEAD halves:
/// - even spans keep their worktree file (worktree-layer hit), except
/// - span 0 loses its worktree copy (committed + indexed → tombstone via
///   `exists_in_index`), and
/// - span 2 (when present) also drops out of the index (`rm --cached`,
///   worktree file deleted → HEAD-only tombstone via the resolved subtree).
fn seed_corpus(repo: &TestRepo, k: usize) -> Result<()> {
    for i in 0..k {
        let path = format!("f{i}.txt");
        repo.write_file(&path, &format!("file {i} content\nl2\nl3\nl4\nl5\n"))?;
        repo.commit_all(&format!("add {path}"))?;
        let span = format!("span{i}");
        repo.run_span(["add", &span, &format!("{path}#L1-L5")])?;
        repo.run_span(["why", &span, "seed"])?;
        repo.commit_all(&format!("span: {span}"))?;
    }
    std::fs::remove_file(repo.path().join(".span/span0"))?;
    if k > 2 {
        repo.run_git(["rm", "--cached", "--", ".span/span2"])?;
        std::fs::remove_file(repo.path().join(".span/span2"))?;
    }
    Ok(())
}

/// The whole-corpus effective load keeps index loads and HEAD peels constant
/// as the span count grows.
#[test]
fn corpus_load_keeps_index_and_head_costs_constant_per_run() -> Result<()> {
    for k in [3usize, 8] {
        let repo = TestRepo::new()?;
        seed_corpus(&repo, k)?;
        let gix_repo = repo.gix_repo()?;

        reset_index_entries_call_count();
        reset_load_index_call_count();
        reset_tree_entry_at_call_count();

        let (loaded, conflicted) = load_all_spans_in(&gix_repo, ".span")?;

        // Non-vacuous: every non-tombstoned span must have loaded with its
        // anchor intact, and no span may report a conflict.
        let live = if k > 2 { k - 2 } else { k - 1 };
        assert_eq!(loaded.len(), live, "K={k}: live spans must all load");
        assert!(
            loaded
                .iter()
                .all(|(name, span)| name.starts_with("span") && !span.anchors.is_empty()),
            "K={k}: every loaded span must carry its anchor"
        );
        assert!(conflicted.is_empty(), "K={k}: fixture has no conflicts");

        assert_eq!(
            index_entries_call_count(),
            1,
            "K={k}: exactly one index materialization per run — the \
             snapshot capture. More means some per-span probe re-read the \
             index instead of answering from the capture."
        );
        assert_eq!(
            load_index_call_count(),
            2,
            "K={k}: exactly two direct index loads per run — the 3-layer \
             name-discovery scan (`collect_index_names`) and the capture's \
             own materialization inside `index_entries`. Any higher count \
             means per-span probes fell back to legacy loads."
        );
        assert_eq!(
            tree_entry_at_call_count(),
            0,
            "K={k}: no probe may re-parse/re-peel HEAD per span; presence \
             must answer from the one resolved span-subtree map."
        );
    }
    Ok(())
}
