//! Acceptance checks for the worktree-blob fallback (card main-264):
//! unstaged shell moves — an anchored path removed from the worktree with
//! the content relocated to an untracked path — must classify as
//! `Moved (uncommitted)` instead of `Deleted`, and `git span drift --fix`
//! must retire the old address and install the new one.
//!
//! The fallback is strictly additive and fail-closed: a unique identical
//! untracked copy is a move; several identical copies surface a ranked
//! proposal and stay drifted; zero copies leave every existing branch
//! (staged/committed renames, deletions, the JSON contract, exit codes)
//! running exactly as before. Every check here is `#[ignore]`d until
//! Phase 3 implements the fallback — a skipped check that does not
//! compile is still broken, so this file compiles against the Phase 1
//! stubs (which return "no match" everywhere, i.e. today's behavior).

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".span").join(name);
    Ok(std::fs::read_to_string(path)?)
}

/// Seed a committed span on `file1.txt#L1-L5` with why `why`.
fn seed_span(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.span_stdout(["add", name, anchor])?;
    repo.span_stdout(["why", name, why])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Control A (acceptance 1): unstaged rename → Moved (uncommitted) + --fix.
// ---------------------------------------------------------------------------

#[test]
fn unstaged_rename_reports_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // A shell move: rename on disk, nothing staged.
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    // The read-only scan surfaces it as Moved (uncommitted), never as a
    // deletion or an orphan.
    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "unstaged rename must surface as Moved (uncommitted); drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "an unstaged move must never read as a deletion; drift=\n{pre}"
    );
    assert!(
        !pre.contains("orphan"),
        "an unstaged move must never read as orphaned; drift=\n{pre}"
    );

    // A second read-only scan on the same state renders from the warm store
    // summary, not a fresh resolution — the moved_uncommitted marker must
    // survive that round trip (card main-264 store-schema bump).
    let pre2 = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre2.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "warm cache hit must keep the (uncommitted) marker; drift=\n{pre2}"
    );

    // --fix retires the old address and installs the new one in one pass.
    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected --fix to reconcile the unstaged move; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("renamed.txt#L1-L5 rk64:"),
        "span must be rewritten to the renamed path; got:\n{span}"
    );
    assert!(
        !span.contains("file1.txt#L1-L5"),
        "old anchor address must be gone; got:\n{span}"
    );

    // A following read-only `drift` must now be clean.
    let post = repo.run_span(["drift"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "drift must be clean after --fix reconciled the unstaged move; stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control B (acceptance 2): several identical untracked copies → ranked
// proposal, fail-closed, span byte-unchanged.
// ---------------------------------------------------------------------------

#[test]
fn ambiguous_identical_candidates_fail_closed_with_ranked_proposal() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    let content = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;
    repo.write_file("copy/renamed.txt", &content)?;

    let before = read_span(&repo, "m")?;
    // Plain `drift` (no `--no-exit-code`): the flag's documented contract is
    // to suppress the drift exit code, so asserting exit 1 requires the
    // suppression-free invocation — the ambiguous case must still count as
    // drift (main-207 exit-code contract, out of scope for this card).
    let out = repo.run_span(["drift"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_span(&repo, "m")?;

    assert_eq!(
        before, after,
        "ambiguous drift must never rewrite the span; got:\n{after}"
    );
    assert!(
        stdout.contains("— multiple possible destinations:"),
        "ambiguity must surface an explicit multi-candidate proposal; drift=\n{stdout}"
    );
    for candidate in ["renamed.txt", "copy/renamed.txt"] {
        assert!(
            stdout.contains(candidate),
            "proposal must list {candidate}; drift=\n{stdout}"
        );
    }
    assert!(
        !stdout.contains("moved to"),
        "identical-content ambiguity must never auto-classify as Moved; drift=\n{stdout}"
    );
    assert_eq!(
        out.status.code(),
        Some(1),
        "a drifted span must exit 1; drift=\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control C / C′: removals with no candidate keep today's classification
// and --fix refuses.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
fn plain_removal_without_candidate_stays_deleted_in_worktree() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    std::fs::remove_file(repo.path().join("file1.txt"))?;

    let drift = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        drift.contains("deleted in the working tree"),
        "a plain removal with no identical copy must stay deleted; drift=\n{drift}"
    );
    assert!(
        !drift.contains("moved to"),
        "a removal with no candidate must never be labeled a move; drift=\n{drift}"
    );

    // --fix refuses: the anchor is still listed, the span is untouched,
    // and the exit code stays non-zero.
    let before = read_span(&repo, "m")?;
    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_span(&repo, "m")?;
    assert_eq!(before, after, "Deleted anchor must not be rewritten");
    assert!(
        stdout.contains("file1.txt#L1-L5"),
        "anchor still listed; stdout=\n{stdout}"
    );
    assert_ne!(
        out.status.code(),
        Some(0),
        "non-zero exit for remaining drift"
    );
    Ok(())
}

#[test]
#[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
fn staged_removal_without_candidate_stays_deleted_in_index() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    repo.run_git(["rm", "file1.txt"])?;

    let drift = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        drift.contains("deleted in the index"),
        "a staged deletion with no identical copy must stay deleted-in-index; drift=\n{drift}"
    );
    assert!(
        !drift.contains("moved to"),
        "a staged deletion must never be labeled a move; drift=\n{drift}"
    );

    // --fix refuses for the staged deletion as well.
    let before = read_span(&repo, "m")?;
    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_span(&repo, "m")?;
    assert_eq!(before, after, "Deleted anchor must not be rewritten");
    assert!(
        stdout.contains("file1.txt#L1-L5"),
        "anchor still listed; stdout=\n{stdout}"
    );
    assert_ne!(
        out.status.code(),
        Some(0),
        "non-zero exit for remaining drift"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control D: staged/committed renames keep their label — no (uncommitted).
// ---------------------------------------------------------------------------

#[test]
#[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
fn staged_git_mv_keeps_moved_label_without_uncommitted_marker() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;

    let drift = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        drift.contains("moved to renamed.txt#L1-L5"),
        "staged git mv must still read as Moved; drift=\n{drift}"
    );
    assert!(
        !drift.contains("(uncommitted)"),
        "a staged rename must not carry the uncommitted marker; drift=\n{drift}"
    );
    Ok(())
}

#[test]
#[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
fn committed_git_mv_keeps_moved_label_without_uncommitted_marker() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename"])?;

    let drift = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        drift.contains("moved to renamed.txt#L1-L5"),
        "committed git mv must still read as Moved; drift=\n{drift}"
    );
    assert!(
        !drift.contains("(uncommitted)"),
        "a committed rename must not carry the uncommitted marker; drift=\n{drift}"
    );
    assert!(
        !drift.contains("in the working tree"),
        "a committed rename must not be mislabeled as a worktree-layer edit; drift=\n{drift}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control E: the JSON contract for the new finding.
// ---------------------------------------------------------------------------

#[test]
fn json_contract_reports_moved_worktree_source_and_schema() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    let out = repo.span_stdout(["drift", "--format=json", "--no-exit-code"])?;
    let v: Value = serde_json::from_str(&out)?;
    assert_eq!(v["schema_version"], 3, "schema_version must stay 3; json={v}");

    let finding = &v["findings"][0];
    assert_eq!(finding["status"]["code"], "MOVED", "finding={finding}");
    assert_eq!(finding["moved_to"]["path"], "renamed.txt", "finding={finding}");
    assert_eq!(finding["moved_to"]["extent"]["kind"], "lines", "finding={finding}");
    assert_eq!(finding["moved_to"]["extent"]["start"], 1, "finding={finding}");
    assert_eq!(finding["moved_to"]["extent"]["end"], 5, "finding={finding}");
    assert_eq!(finding["source"], "WORKTREE", "finding={finding}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Control F: whole-file anchor variant of Control A.
// ---------------------------------------------------------------------------

#[test]
fn whole_file_unstaged_rename_reports_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt", "why")?;

    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to renamed.txt (uncommitted)"),
        "whole-file unstaged rename must surface as Moved (uncommitted); drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "a whole-file unstaged move must never read as a deletion; drift=\n{pre}"
    );

    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected --fix to reconcile the whole-file unstaged move; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.contains("renamed.txt rk64:"),
        "span must be rewritten to the renamed path; got:\n{span}"
    );
    assert!(
        !span.contains("file1.txt"),
        "old anchor address must be gone; got:\n{span}"
    );

    let post = repo.run_span(["drift"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "drift must be clean after --fix; stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control G: skip-worktree paths never trigger the fallback — today's
// classification is pinned unchanged from baseline.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
fn skip_worktree_missing_path_never_triggers_fallback() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // An identical untracked copy that would match if the fallback fired.
    let content = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("copy/file1.txt", &content)?;

    // Sparse-exclude the anchored path, then remove it from disk.
    repo.run_git(["update-index", "--skip-worktree", "file1.txt"])?;
    std::fs::remove_file(repo.path().join("file1.txt"))?;

    let drift = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        !drift.contains("moved to"),
        "skip-worktree paths must never trigger the fallback; drift=\n{drift}"
    );
    // Baseline, verified before the fallback exists: the worktree layer
    // honors skip-worktree, so a missing sparse-excluded path reads as
    // clean ("absence is by design") — never as a deletion, and never as
    // a move. The fallback's skip-worktree gate must preserve this.
    assert!(
        drift.contains("0 drift across 1 span"),
        "classification must equal today's baseline for a skip-worktree path; drift=\n{drift}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control H: enumeration policy — a nested git repo and an unreadable
// candidate never abort the scan and are never matches.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "card main-264 phase 3: worktree-blob fallback not yet implemented"]
fn nested_repo_and_unreadable_candidate_never_abort_scan() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    let content = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    // An untracked nested git repo whose inner file has content identical
    // to the anchor's blob: if the scan descended into it, it would be a
    // second candidate. It must surface as a single directory entry and
    // never match.
    repo.run_git(["init", "nested"])?;
    repo.write_file("nested/seed.txt", &content)?;

    // An unreadable untracked file: hashing it must skip, not abort.
    let unreadable = repo.path().join("unreadable.txt");
    repo.write_file("unreadable.txt", "different content\n")?;
    support::make_unreadable(&unreadable)?;

    let out = repo.run_span(["drift", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "the valid candidate must still resolve; drift=\n{stdout}"
    );
    assert!(
        !stdout.contains("nested"),
        "the nested repo must never surface as a candidate; drift=\n{stdout}"
    );
    assert!(
        !stdout.contains("unreadable"),
        "the unreadable file must never surface as a candidate; drift=\n{stdout}"
    );

    // Restore permissions so the fixture tempdir can be torn down.
    #[cfg(unix)]
    let _ = support::make_writable(&unreadable);
    Ok(())
}
