//! Regression tests for F2/F4/F7 of the tracked-file-storage evaluation.
//!
//! - F2: `git span stale` works on an ordinary repo with no commit-graph.
//! - F4: a removed anchored path/range classifies as `Deleted`; content
//!   relocated verbatim (different path or shifted range) classifies as
//!   `Moved`; both are distinct from `Changed`, across whole-file and
//!   line anchors and the worktree + index layers.
//! - F7: `git span stale --stat` lists only stale anchors and the
//!   heading count/wording matches the listed rows.

use crate::support;

use anyhow::Result;
use git_span::types::{AnchorStatus, EngineOptions};
use git_span::{resolve_span, stale_spans};
use serde_json::Value;
use support::TestRepo;

fn full_opts() -> EngineOptions {
    EngineOptions::full()
}

/// F2: a plain `git init` + `git add` + `git commit` repo has no
/// commit-graph. `stale` must still succeed (no plumbing instruction as a
/// fatal error).
#[test]
fn stale_succeeds_without_commit_graph() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "a\nb\nc\nd\ne\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "charge", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "charge", "charge flow"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span charge"])?;

    // No `git commit-graph write` here — ordinary repo state.
    assert!(
        !repo.path().join(".git/objects/info/commit-graph").exists(),
        "test precondition: no commit-graph file"
    );

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "charge", EngineOptions::committed_only())?;
    assert_eq!(resolved.anchors.len(), 1);
    assert_eq!(resolved.anchors[0].status, AnchorStatus::Fresh);

    // Full scan path too (the headline command).
    let _ = stale_spans(&gix, ".span", full_opts())?;

    // And via the CLI binary.
    let out = repo.run_span(vec!["stale"])?;
    assert!(
        out.status.success(),
        "`git span stale` failed on a no-commit-graph repo: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// F4(b): `git rm` (staged, uncommitted) of an anchored whole-file path
/// must read as a deletion ("deleted in the index"), never "changed".
#[test]
fn whole_file_path_removed_reads_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;

    let stale = repo.span_stdout(["stale", "wf", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index") || stale.contains("deleted in the working tree"),
        "git rm of an anchored whole-file path must read as a deletion, \
         not 'changed'; stale=\n{stale}"
    );
    assert!(
        !stale.contains("— changed"),
        "removal must never be labeled 'changed'; stale=\n{stale}"
    );
    Ok(())
}

/// F4(b): committed deletion of an anchored whole-file path → `Deleted`
/// (renders "deleted"; the path no longer resolves at HEAD).
#[test]
fn whole_file_path_committed_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Deleted,
        "committed deletion of an anchored whole-file path must be Deleted"
    );
    Ok(())
}

/// F4(b'): `git rm` (staged, uncommitted) of an anchored line-range path
/// must read as a deletion, never "changed".
#[test]
fn line_range_path_removed_reads_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "lr", "line range"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span lr"])?;

    repo.run_git(["rm", "api/charge.ts"])?;

    let stale = repo.span_stdout(["stale", "lr", "--no-exit-code"])?;
    assert!(
        stale.contains("deleted in the index") || stale.contains("deleted in the working tree"),
        "git rm of an anchored line-range path must read as a deletion; \
         stale=\n{stale}"
    );
    assert!(
        !stale.contains("— changed"),
        "removal must never be labeled 'changed'; stale=\n{stale}"
    );
    Ok(())
}

/// F4(b'): committed deletion of an anchored line-range path → `Deleted`.
#[test]
fn line_range_path_committed_deletion_is_deleted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "lr", "line range"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span lr"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "lr", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Deleted,
        "committed deletion of an anchored line-range path must be Deleted"
    );
    Ok(())
}

/// F4(c): verbatim-relocate anchored whole-file content to a new path and
/// delete the original → `Moved` (stored content hash exists at the new
/// path).
#[test]
fn whole_file_content_relocated_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    // Verbatim copy to a new path, remove the original (worktree+index).
    repo.write_file("api/billing.ts", "alpha\nbeta\ngamma\n")?;
    repo.run_git(["add", "api/billing.ts"])?;
    repo.run_git(["rm", "api/charge.ts"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "verbatim-relocated whole-file content must classify as Moved"
    );
    let cur = resolved.anchors[0]
        .current
        .as_ref()
        .expect("Moved carries a current location");
    assert_eq!(cur.path, std::path::PathBuf::from("api/billing.ts"));
    Ok(())
}

/// F4(d): prepend lines so the anchored extent shifts down within the same
/// file → `Moved` (stored content hash found at a shifted range).
#[test]
fn line_range_shifted_extent_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "anchor-a\nanchor-b\nanchor-c\ntail\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "lr", "api/charge.ts#L1-L3"])?;
    repo.run_span(["why", "lr", "line range"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span lr"])?;

    // Prepend two lines: the anchored slice now lives at L3-L5.
    repo.write_file(
        "api/charge.ts",
        "new-1\nnew-2\nanchor-a\nanchor-b\nanchor-c\ntail\n",
    )?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "lr", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "prepended lines shifting the anchored extent must classify as Moved"
    );
    Ok(())
}

/// F4: index-layer relocation. Stage a `git mv` (relocation lives in the
/// index, not yet committed) → `Moved` against the index layer.
#[test]
fn whole_file_relocated_in_index_is_moved() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("api/charge.ts", "x1\nx2\nx3\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    // Staged relocation: removed from the index/worktree at the old path,
    // present verbatim at the new path.
    repo.run_git(["mv", "api/charge.ts", "api/billing.ts"])?;

    let gix = repo.gix_repo()?;
    let resolved = resolve_span(&gix, ".span", "wf", full_opts())?;
    assert_eq!(
        resolved.anchors[0].status,
        AnchorStatus::Moved,
        "staged-relocation verbatim content must classify as Moved"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Card main-168: deleted-vs-renamed rendering (Human/JSON/porcelain).
//
// These extend the F4 "Deleted" coverage above with the distinction
// `plans/bounded-rename-chain.md` adds on top of it: a `Deleted` anchor whose
// path was provably renamed in git history (per `deleted_locus_walk`) must
// surface the rename target; a `Deleted` anchor with no rename in its
// history must surface the plain "needs code-fix-first or span deletion"
// phrasing.
// ---------------------------------------------------------------------------

/// `api/charge.ts` is `git mv`'d to `api/billing.ts`, then edited further at
/// the new path so verbatim content-matching (which would otherwise
/// classify the anchor as `Moved`) can never find it — the anchor's own
/// path is genuinely absent at HEAD (`Deleted`), while git history still
/// records the rename that `deleted_locus_walk` must recover.
fn seed_renamed_whole_file(repo: &TestRepo) -> Result<()> {
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["mv", "api/charge.ts", "api/billing.ts"])?;
    repo.run_git(["commit", "-m", "rename charge to billing"])?;

    repo.write_file("api/billing.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("edit after rename")?;
    Ok(())
}

/// `api/charge.ts` is committed-deleted outright — no rename anywhere in
/// its history.
fn seed_true_deletion_whole_file(repo: &TestRepo) -> Result<()> {
    repo.write_file("api/charge.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/charge.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["rm", "api/charge.ts"])?;
    repo.run_git(["commit", "-m", "delete charge"])?;
    Ok(())
}

#[test]
fn human_renamed_deletion_reports_re_anchor_target() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_renamed_whole_file(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--no-exit-code"])?;
    assert!(
        out.contains("needs re-anchor to api/billing.ts"),
        "renamed deletion must surface the rename target; stdout=\n{out}"
    );
    assert!(
        !out.contains("needs code-fix-first"),
        "a provable rename must not fall back to the true-deletion phrasing; stdout=\n{out}"
    );
    Ok(())
}

#[test]
fn human_true_deletion_reports_code_fix_or_span_deletion() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_true_deletion_whole_file(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--no-exit-code"])?;
    assert!(
        out.contains("needs code-fix-first or span deletion"),
        "true deletion must surface the code-fix-or-span-deletion phrasing; stdout=\n{out}"
    );
    assert!(
        !out.contains("needs re-anchor"),
        "a genuine deletion must never guess a rename target; stdout=\n{out}"
    );
    Ok(())
}

#[test]
fn json_renamed_deletion_has_renamed_at_and_renamed_to_fields() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_renamed_whole_file(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--format=json", "--no-exit-code"])?;
    let v: Value = serde_json::from_str(&out)?;
    let finding = &v["findings"][0];
    assert_eq!(finding["status"]["code"], "DELETED", "finding={finding}");
    assert!(
        finding["locus"]["renamed_at"].is_string(),
        "renamed deletion must carry a renamed_at commit; finding={finding}"
    );
    assert_eq!(
        finding["locus"]["renamed_to"], "api/billing.ts",
        "finding={finding}"
    );
    Ok(())
}

#[test]
fn json_true_deletion_has_deleted_in_and_no_renamed_fields() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_true_deletion_whole_file(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--format=json", "--no-exit-code"])?;
    let v: Value = serde_json::from_str(&out)?;
    let finding = &v["findings"][0];
    assert_eq!(finding["status"]["code"], "DELETED", "finding={finding}");
    assert!(
        finding["locus"]["deleted_in"].is_string(),
        "true deletion must carry a deleted_in commit; finding={finding}"
    );
    assert!(
        finding["locus"]["renamed_to"].is_null(),
        "true deletion must never carry a renamed_to field; finding={finding}"
    );
    Ok(())
}

#[test]
fn porcelain_renamed_deletion_emits_renamed_to_comment() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_renamed_whole_file(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--format=porcelain", "--no-exit-code"])?;
    assert!(out.contains("DELETED"), "stdout={out}");
    assert!(
        out.contains("# renamed-to api/billing.ts"),
        "renamed deletion must emit a renamed-to porcelain comment; stdout={out}"
    );
    Ok(())
}

#[test]
fn porcelain_true_deletion_has_no_renamed_to_comment() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_true_deletion_whole_file(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--format=porcelain", "--no-exit-code"])?;
    assert!(out.contains("DELETED"), "stdout={out}");
    assert!(
        !out.contains("# renamed-to"),
        "a true deletion must not emit a renamed-to comment; stdout={out}"
    );
    Ok(())
}

/// `api/old,name.ts` is `git mv`'d to `api/new,name.ts`, then edited further at
/// the new path so the anchor's renamed path contains commas, testing comma-escaping
/// in the porcelain `# renamed-to` output.
fn seed_renamed_with_comma(repo: &TestRepo) -> Result<()> {
    repo.write_file("api/old,name.ts", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    repo.run_span(["add", "wf", "api/old,name.ts"])?;
    repo.run_span(["why", "wf", "whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span wf"])?;

    repo.run_git(["mv", "api/old,name.ts", "api/new,name.ts"])?;
    repo.run_git(["commit", "-m", "rename to new path with comma"])?;

    repo.write_file("api/new,name.ts", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("edit after rename")?;
    Ok(())
}

#[test]
fn porcelain_renamed_deletion_escapes_comma_in_path() -> Result<()> {
    let repo = TestRepo::new()?;
    seed_renamed_with_comma(&repo)?;
    let out = repo.span_stdout(["stale", "wf", "--format=porcelain", "--no-exit-code"])?;
    assert!(out.contains("DELETED"), "stdout={out}");
    assert!(
        out.contains("# renamed-to \"api/new,name.ts\""),
        "renamed deletion with comma in path must emit an escaped renamed-to comment; stdout={out}"
    );
    Ok(())
}
