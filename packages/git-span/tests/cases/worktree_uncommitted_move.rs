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
//! running exactly as before — pinned by controls C/C′/D below.

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

// ---------------------------------------------------------------------------
// Control I (F1): line-ending-converted repos — the fallback must hash
// untracked candidates through the clean pipeline, or an unstaged move of
// a CRLF worktree copy against an LF-normalized blob reads as a plain
// deletion and the card's headline feature is silently inert.
// ---------------------------------------------------------------------------

#[test]
fn converted_repo_unstaged_move_reports_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::new()?;
    // Commit the conversion attributes before any content exists, so every
    // blob below is stored normalized.
    repo.write_file(".gitattributes", "* text eol=crlf\n")?;
    repo.commit_all("gitattributes: convert all text to crlf")?;

    // The anchored file is written with CRLF bytes on disk; `git add` runs
    // the clean pipeline and stores the LF-normalized blob. If this fixture
    // were an identity repo (no real conversion), the blob would keep the
    // CRLF bytes and the byte assertions below would fail.
    repo.write_file_bytes(
        "file1.txt",
        b"line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\nline9\r\nline10\r\n",
    )?;
    repo.commit_all("convert file1.txt")?;

    // Byte-level proof the fixture exercises real conversion: the worktree
    // copy on disk is CRLF while the stored blob is LF-only, and the two
    // are distinct byte sequences.
    let worktree_bytes = std::fs::read(repo.path().join("file1.txt"))?;
    assert!(
        worktree_bytes.windows(2).any(|w| w == b"\r\n"),
        "worktree file1.txt must be CRLF on disk; got {worktree_bytes:?}"
    );
    let blob_out = repo.run_git(["cat-file", "blob", "HEAD:file1.txt"])?;
    assert!(
        !blob_out.stdout.contains(&b'\r'),
        "stored blob must be LF-normalized; got {:?}",
        blob_out.stdout
    );
    assert_ne!(
        worktree_bytes, blob_out.stdout,
        "fixture is an identity repo: worktree bytes equal the stored blob, \
         so no line-ending conversion is being exercised"
    );

    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // A shell move: rename on disk, nothing staged. The worktree copy still
    // carries CRLF bytes; the anchor's HEAD blob is LF-normalized.
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    // The read-only scan surfaces it as Moved (uncommitted) — the fallback
    // must recognize the converted copy, never read it as a deletion.
    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "converted-repo unstaged rename must surface as Moved (uncommitted); drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "a converted unstaged move must never read as a deletion; drift=\n{pre}"
    );

    // A second read-only scan renders from the warm store summary — the
    // moved_uncommitted marker must survive that round trip here too.
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
        "expected --fix to reconcile the converted unstaged move; stdout=\n{stdout}"
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
        "drift must be clean after --fix reconciled the converted unstaged move; stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control J (F4a): staged removal with an identical untracked copy — the
// fallback must NOT fire. The index record is the distinguishing signal:
// an unstaged shell move leaves the anchored path in the index, a staged
// `git rm` removes it, so an index-absent path reaching the fallback is a
// staged deletion by construction. The identical untracked copy must not
// be read as a move — that would override the operator's recorded intent.
// ---------------------------------------------------------------------------

#[test]
fn staged_removal_with_identical_untracked_copy_stays_deleted_in_index() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // A deliberate staged removal (`git rm`, no commit), plus an identical
    // untracked copy at a new path — the one-candidate sibling of control
    // C′. With the index entry gone, the fallback is suppressed and the
    // classification must match the zero-candidate case exactly.
    let content = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.run_git(["rm", "file1.txt"])?;
    repo.write_file("copy/file1.txt", &content)?;

    let drift = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        drift.contains("deleted in the index"),
        "a staged deletion with an identical untracked copy must stay deleted-in-index; \
         drift=\n{drift}"
    );
    assert!(
        !drift.contains("moved to"),
        "a staged deletion must never be labeled a move, even with an identical untracked \
         copy; drift=\n{drift}"
    );
    assert!(
        !drift.contains("(uncommitted)"),
        "a staged deletion must not carry the uncommitted marker; drift=\n{drift}"
    );

    // --fix refuses: the anchor is still listed, the span is byte-unchanged,
    // and the exit code stays non-zero.
    let before = read_span(&repo, "m")?;
    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_span(&repo, "m")?;
    assert_eq!(
        before, after,
        "staged-deletion anchor must not be rewritten"
    );
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
// Control K (F4b): `--fix` on the ambiguous state — 0 rewrites, the
// multi-candidate proposal stays listed, the span is byte-unchanged, and
// the exit code stays non-zero.
// ---------------------------------------------------------------------------

#[test]
fn fix_on_ambiguous_candidates_is_a_zero_rewrite_noop() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    let content = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;
    repo.write_file("copy/renamed.txt", &content)?;

    let before = read_span(&repo, "m")?;
    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let after = read_span(&repo, "m")?;

    assert_eq!(
        before, after,
        "--fix on an ambiguous finding must never rewrite the span; got:\n{after}"
    );
    assert!(
        stdout.contains("Updated 0 anchors (0 updated, 0 removed)"),
        "--fix must report the zero-rewrite outcome; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("— multiple possible destinations:"),
        "the multi-candidate proposal must still be listed after --fix; stdout=\n{stdout}"
    );
    for candidate in ["renamed.txt", "copy/renamed.txt"] {
        assert!(
            stdout.contains(candidate),
            "proposal must still list {candidate} after --fix; stdout=\n{stdout}"
        );
    }
    assert_ne!(
        out.status.code(),
        Some(0),
        "remaining ambiguous drift must exit non-zero after --fix"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control L (round 3, acceptance 1): source-scoped conversion — the
// conversion attribute covers the ANCHORED path only, not the destination.
// The worktree copy is smudged under the anchor path's rules (CRLF on disk,
// LF blob); after a shell move the destination carries no rules, so only
// the clean form under the ANCHOR path's rules can match the blob. Control I
// covers the destination-covered sibling (`* text eol=crlf`).
// ---------------------------------------------------------------------------

#[test]
fn path_scoped_conversion_unstaged_move_reports_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::new()?;
    // The conversion attribute is scoped to the anchored path only; the
    // shell-move destination inherits no rules — the destination-uncovered
    // shape that must still classify as a move.
    repo.write_file(".gitattributes", "file1.txt text eol=crlf\n")?;
    repo.commit_all("gitattributes: convert file1.txt to crlf")?;

    // The anchored file is written with CRLF bytes on disk; `git add` runs
    // the clean pipeline under the anchored path's rules and stores the
    // LF-normalized blob.
    repo.write_file_bytes(
        "file1.txt",
        b"line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\nline9\r\nline10\r\n",
    )?;
    repo.commit_all("convert file1.txt")?;

    // Byte-level proof the fixture exercises real conversion at the source
    // path: the worktree copy is CRLF while the stored blob is LF-only, and
    // the two are distinct byte sequences.
    let worktree_bytes = std::fs::read(repo.path().join("file1.txt"))?;
    assert!(
        worktree_bytes.windows(2).any(|w| w == b"\r\n"),
        "worktree file1.txt must be CRLF on disk; got {worktree_bytes:?}"
    );
    let blob_out = repo.run_git(["cat-file", "blob", "HEAD:file1.txt"])?;
    assert!(
        !blob_out.stdout.contains(&b'\r'),
        "stored blob must be LF-normalized; got {:?}",
        blob_out.stdout
    );
    assert_ne!(
        worktree_bytes, blob_out.stdout,
        "fixture is an identity repo: worktree bytes equal the stored blob, \
         so no line-ending conversion is being exercised"
    );

    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // A shell move: rename on disk, nothing staged. The destination
    // `renamed.txt` is outside the attribute scope, so its raw CRLF bytes
    // match the LF blob only through the anchor path's conversion rules.
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    // The read-only scan surfaces it as Moved (uncommitted), never as a
    // deletion.
    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "source-scoped converted unstaged rename must surface as Moved (uncommitted); \
         drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "a converted unstaged move must never read as a deletion; drift=\n{pre}"
    );

    // A second read-only scan renders from the warm store summary — the
    // moved_uncommitted marker must survive that round trip.
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
        "expected --fix to reconcile the source-scoped converted move; stdout=\n{stdout}"
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
        "drift must be clean after --fix reconciled the source-scoped converted move; \
         stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control M (round 3, acceptance 2): directory-scoped conversion with the
// move out of scope — `sub/** text eol=crlf` covers the anchored path, the
// shell move leaves `sub/`, and the destination is uncovered. Same
// classification and fix as control L.
// ---------------------------------------------------------------------------

#[test]
fn dir_scoped_conversion_move_out_of_scope_reports_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file(".gitattributes", "sub/** text eol=crlf\n")?;
    repo.commit_all("gitattributes: convert sub to crlf")?;

    repo.write_file_bytes(
        "sub/file1.txt",
        b"line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\nline9\r\nline10\r\n",
    )?;
    repo.commit_all("convert sub/file1.txt")?;

    // Byte-level proof the fixture exercises real conversion at the source
    // path.
    let worktree_bytes = std::fs::read(repo.path().join("sub/file1.txt"))?;
    assert!(
        worktree_bytes.windows(2).any(|w| w == b"\r\n"),
        "worktree sub/file1.txt must be CRLF on disk; got {worktree_bytes:?}"
    );
    let blob_out = repo.run_git(["cat-file", "blob", "HEAD:sub/file1.txt"])?;
    assert!(
        !blob_out.stdout.contains(&b'\r'),
        "stored blob must be LF-normalized; got {:?}",
        blob_out.stdout
    );
    assert_ne!(
        worktree_bytes, blob_out.stdout,
        "fixture is an identity repo: worktree bytes equal the stored blob, \
         so no line-ending conversion is being exercised"
    );

    seed_span(&repo, "m", "sub/file1.txt#L1-L5", "why")?;

    // The whole-directory-move shape: the anchored file leaves `sub/` for a
    // path with no conversion rules.
    std::fs::rename(
        repo.path().join("sub/file1.txt"),
        repo.path().join("file1.txt"),
    )?;

    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to file1.txt#L1-L5 (uncommitted)"),
        "dir-scoped converted move out of scope must surface as Moved (uncommitted); \
         drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "a converted unstaged move must never read as a deletion; drift=\n{pre}"
    );

    let pre2 = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre2.contains("moved to file1.txt#L1-L5 (uncommitted)"),
        "warm cache hit must keep the (uncommitted) marker; drift=\n{pre2}"
    );

    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected --fix to reconcile the dir-scoped converted move; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    // The new address is a substring of the old one, so the record line
    // must be matched, not the bare address.
    assert!(
        span.lines().any(|l| l.starts_with("file1.txt#L1-L5 rk64:")),
        "span must be rewritten to the out-of-scope path; got:\n{span}"
    );
    assert!(
        !span.lines().any(|l| l.starts_with("sub/file1.txt#L1-L5")),
        "old anchor address must be gone; got:\n{span}"
    );

    let post = repo.run_span(["drift"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "drift must be clean after --fix reconciled the dir-scoped converted move; \
         stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control N (round 3, acceptance 3): `ident` conversion at the anchored
// path. The worktree copy is forced to re-materialize from the index so the
// expanded `$Id: … $` bytes land on disk; the blob holds the raw `$Id$`
// form, and only the anchor path's `ident` rules collapse the moved copy
// back to the blob.
// ---------------------------------------------------------------------------

#[test]
fn ident_conversion_unstaged_move_reports_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file(".gitattributes", "file1.txt ident\n")?;
    repo.commit_all("gitattributes: ident on file1.txt")?;

    let mut content = String::new();
    for i in 1..=10 {
        if i == 3 {
            content.push_str("line3 $Id$\n");
        } else {
            content.push_str(&format!("line{i}\n"));
        }
    }
    repo.write_file("file1.txt", &content)?;
    repo.commit_all("add file1.txt")?;

    // Force the ident smudge: deleting the file and re-materializing it from
    // the index makes git expand `$Id$` → `$Id: <sha> $` on disk. A fixture
    // that merely writes the file once and commits never diverges (worktree
    // bytes == blob bytes) and would pass without the fix.
    std::fs::remove_file(repo.path().join("file1.txt"))?;
    repo.run_git(["checkout", "--", "file1.txt"])?;

    // Byte-level proof the fixture exercises real ident conversion: the
    // worktree copy carries the expanded form, the blob the raw form.
    let worktree_bytes = std::fs::read(repo.path().join("file1.txt"))?;
    assert!(
        worktree_bytes.windows(4).any(|w| w == b"$Id:"),
        "worktree file1.txt must carry the expanded $Id: form; got {worktree_bytes:?}"
    );
    let blob_out = repo.run_git(["cat-file", "blob", "HEAD:file1.txt"])?;
    assert!(
        blob_out.stdout.windows(4).any(|w| w == b"$Id$"),
        "stored blob must carry the raw $Id$ form; got {:?}",
        blob_out.stdout
    );
    assert!(
        !blob_out.stdout.windows(4).any(|w| w == b"$Id:"),
        "stored blob must not carry the expanded form; got {:?}",
        blob_out.stdout
    );
    assert_ne!(
        worktree_bytes, blob_out.stdout,
        "fixture is an identity repo: worktree bytes equal the stored blob, \
         so no ident conversion is being exercised"
    );

    seed_span(&repo, "m", "file1.txt#L1-L5", "why")?;

    // A shell move: rename on disk, nothing staged. The destination has no
    // attributes, so its expanded bytes match the raw-form blob only through
    // the anchor path's `ident` rules.
    std::fs::rename(repo.path().join("file1.txt"), repo.path().join("renamed.txt"))?;

    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "ident-converted unstaged rename must surface as Moved (uncommitted); drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "a converted unstaged move must never read as a deletion; drift=\n{pre}"
    );

    let pre2 = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre2.contains("moved to renamed.txt#L1-L5 (uncommitted)"),
        "warm cache hit must keep the (uncommitted) marker; drift=\n{pre2}"
    );

    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 1 anchor (1 updated, 0 removed)."),
        "expected --fix to reconcile the ident-converted unstaged move; stdout=\n{stdout}"
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

    let post = repo.run_span(["drift"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "drift must be clean after --fix reconciled the ident-converted unstaged move; \
         stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Control O (round 3 REVISE): two anchors under DIFFERENT conversion rule
// contexts in one scan — `a.txt text eol=crlf` and `b.txt ident` — both
// shell-moved to uncovered destinations. The candidate map is keyed by the
// anchor's rule context, not by a conversion boolean: whichever anchor
// triggers first must not stamp its rules on the other's anchor-rule keys,
// so one cold drift reports BOTH moves, in either trigger order.
// ---------------------------------------------------------------------------

#[test]
fn mixed_conversion_contexts_unstaged_moves_report_both_moved_uncommitted_and_fix_reanchors() -> Result<()> {
    let repo = TestRepo::new()?;
    // Two DIFFERENT per-path conversion rules in one repository: eol=crlf
    // on a.txt, ident on b.txt. Both anchored; both shell-moved to
    // destinations that inherit no rules.
    repo.write_file(".gitattributes", "a.txt text eol=crlf\nb.txt ident\n")?;
    repo.commit_all("gitattributes: crlf on a.txt, ident on b.txt")?;

    // a.txt is written with CRLF bytes on disk; `git add` stores the
    // LF-normalized blob (control L's fixture). b.txt carries a `$Id$`
    // marker; its ident smudge is forced below (control N's trick).
    repo.write_file_bytes(
        "a.txt",
        b"line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\nline9\r\nline10\r\n",
    )?;
    let mut content = String::new();
    for i in 1..=10 {
        if i == 3 {
            content.push_str("line3 $Id$\n");
        } else {
            content.push_str(&format!("line{i}\n"));
        }
    }
    repo.write_file("b.txt", &content)?;
    repo.commit_all("add a.txt and b.txt")?;

    // Force the ident smudge for b.txt: deleting and re-materializing from
    // the index expands `$Id$` → `$Id: <sha> $` on disk.
    std::fs::remove_file(repo.path().join("b.txt"))?;
    repo.run_git(["checkout", "--", "b.txt"])?;

    // Byte-level proof both fixtures exercise real, DIFFERENT conversions:
    // a.txt is CRLF on disk with an LF blob; b.txt is expanded on disk with
    // a raw-form blob; neither worktree copy equals its blob; and the two
    // files do not collide with each other (which would read as ambiguous).
    let a_worktree = std::fs::read(repo.path().join("a.txt"))?;
    assert!(
        a_worktree.windows(2).any(|w| w == b"\r\n"),
        "worktree a.txt must be CRLF on disk; got {a_worktree:?}"
    );
    let a_blob = repo.run_git(["cat-file", "blob", "HEAD:a.txt"])?;
    assert!(
        !a_blob.stdout.contains(&b'\r'),
        "stored a.txt blob must be LF-normalized; got {:?}",
        a_blob.stdout
    );
    assert_ne!(
        a_worktree, a_blob.stdout,
        "fixture is an identity repo: a.txt worktree bytes equal the stored blob, \
         so no line-ending conversion is being exercised"
    );
    let b_worktree = std::fs::read(repo.path().join("b.txt"))?;
    assert!(
        b_worktree.windows(4).any(|w| w == b"$Id:"),
        "worktree b.txt must carry the expanded $Id: form; got {b_worktree:?}"
    );
    let b_blob = repo.run_git(["cat-file", "blob", "HEAD:b.txt"])?;
    assert!(
        b_blob.stdout.windows(4).any(|w| w == b"$Id$"),
        "stored b.txt blob must carry the raw $Id$ form; got {:?}",
        b_blob.stdout
    );
    assert!(
        !b_blob.stdout.windows(4).any(|w| w == b"$Id:"),
        "stored b.txt blob must not carry the expanded form; got {:?}",
        b_blob.stdout
    );
    assert_ne!(
        b_worktree, b_blob.stdout,
        "fixture is an identity repo: b.txt worktree bytes equal the stored blob, \
         so no ident conversion is being exercised"
    );
    assert_ne!(
        a_worktree, b_worktree,
        "the two fixtures must stay distinct; identical bytes would make the \
         moves ambiguous instead of per-context"
    );

    // Both files span-anchored in one span (the moved-directory shape).
    repo.span_stdout(["add", "m", "a.txt#L1-L5", "b.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // A shell move for both files: rename on disk, nothing staged. The
    // destinations `ra.txt` / `rb.txt` carry no rules.
    std::fs::rename(repo.path().join("a.txt"), repo.path().join("ra.txt"))?;
    std::fs::rename(repo.path().join("b.txt"), repo.path().join("rb.txt"))?;

    // One cold drift must report BOTH moves — whichever anchor triggers
    // first builds the map for ITS rule context only, and the other anchor's
    // context must get its own map rather than the first one's rules.
    let pre = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre.contains("moved to ra.txt#L1-L5 (uncommitted)"),
        "the eol=crlf-context anchor must surface as Moved (uncommitted); drift=\n{pre}"
    );
    assert!(
        pre.contains("moved to rb.txt#L1-L5 (uncommitted)"),
        "the ident-context anchor must surface as Moved (uncommitted); drift=\n{pre}"
    );
    assert!(
        !pre.contains("deleted"),
        "neither converted move may read as a deletion; drift=\n{pre}"
    );

    // A second read-only scan renders from the warm store summary — both
    // (uncommitted) markers must survive that round trip.
    let pre2 = repo.span_stdout(["drift", "--no-exit-code"])?;
    assert!(
        pre2.contains("moved to ra.txt#L1-L5 (uncommitted)")
            && pre2.contains("moved to rb.txt#L1-L5 (uncommitted)"),
        "warm cache hit must keep both (uncommitted) markers; drift=\n{pre2}"
    );

    // --fix retires both old addresses and installs the new ones in one
    // pass.
    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Reconciled 1 span, 2 anchors (2 updated, 0 removed)."),
        "expected --fix to reconcile both converted moves; stdout=\n{stdout}"
    );

    let span = read_span(&repo, "m")?;
    assert!(
        span.lines().any(|l| l.starts_with("ra.txt#L1-L5 rk64:")),
        "span must be rewritten to the crlf move's destination; got:\n{span}"
    );
    assert!(
        span.lines().any(|l| l.starts_with("rb.txt#L1-L5 rk64:")),
        "span must be rewritten to the ident move's destination; got:\n{span}"
    );
    assert!(
        !span.lines().any(|l| l.starts_with("a.txt#L1-L5"))
            && !span.lines().any(|l| l.starts_with("b.txt#L1-L5")),
        "old anchor addresses must be gone; got:\n{span}"
    );

    // A following read-only `drift` must now be clean.
    let post = repo.run_span(["drift"])?;
    assert_eq!(
        post.status.code(),
        Some(0),
        "drift must be clean after --fix reconciled both converted moves; \
         stdout={}",
        String::from_utf8_lossy(&post.stdout)
    );
    Ok(())
}
