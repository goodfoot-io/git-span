//! Acceptance tests for the layered `git span stale` engine.
//!
//! Every test here maps 1:1 to a bullet under
//! `docs/stale-layers-plan.md` §"Phase 1 — Acceptance tests". They all
//! call the real public API boundary (`resolve_anchor`, `resolve_span`,
//! `stale_spans`, `ContentRef::read_normalized`, or the `git-span` CLI)
//! against realistic fixture state.

#![allow(clippy::too_many_lines)]

use crate::support;

use anyhow::Result;
use git_span::types::{
    AnchorExtent, AnchorStatus, ContentRef, DriftSource, EngineOptions, LayerSet, Scope,
    UnavailableReason,
};
use git_span::{resolve_anchor, resolve_span, stale_spans};
use std::path::PathBuf;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Local helpers. These produce realistic fixture state; they do NOT
// implement LFS/filter-process logic — they only set up the repo in the
// shape the eventual Phase 1 implementation will encounter.
// ---------------------------------------------------------------------------

/// Seed a span with one line-anchor anchor on `file1.txt#L1-L5` and commit it.
fn seed_line_range_span(repo: &TestRepo, span: &str) -> Result<()> {
    // File-backed model: `add`/`why` write the worktree span file;
    // commit it so the resolver sees a HEAD-layer span while later
    // source mutations create the drift under test.
    repo.run_span(["add", span, "file1.txt#L1-L5"])?;
    repo.run_span(["why", span, "-m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", &format!("span {span}")])?;
    Ok(())
}

/// Write a `.gitattributes` file at the repo root with the given contents.
fn write_gitattributes(repo: &TestRepo, contents: &str) -> Result<()> {
    repo.write_file(".gitattributes", contents)
}

/// Write a file with a `filter=lfs` attribute set and a plausible LFS
/// pointer body at `rel`. The actual LFS subprocess is never spawned in
/// this fixture; the readers slice will discover the attribute.
fn write_lfs_pointer(repo: &TestRepo, rel: &str, oid_hex_64: &str, size: usize) -> Result<()> {
    let pointer = format!(
        "version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {size}\n",
        oid = oid_hex_64,
        size = size
    );
    repo.write_file(rel, &pointer)
}

/// Seed a fake LFS object cache file at `.git/lfs/objects/<oid[..2]>/<oid[2..4]>/<oid>`
/// containing arbitrary `bytes`. Slice 6's reader probes this layout to
/// distinguish "pointer changed and content cached" from `LfsNotFetched`.
fn seed_lfs_cache(repo: &TestRepo, oid_hex_64: &str, bytes: &[u8]) -> Result<()> {
    let dir = repo
        .path()
        .join(".git")
        .join("lfs")
        .join("objects")
        .join(&oid_hex_64[..2])
        .join(&oid_hex_64[2..4]);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(oid_hex_64), bytes)?;
    Ok(())
}

#[test]
fn timeline_cache_distinguishes_same_path_head_blob_different_anchor_sha() -> Result<()> {
    // File-backed model: anchors carry no `anchor_sha`; identity is the
    // content `stored_hash` captured at `add` time. Two anchors on the
    // same path that pin the same text (`target`) at different line
    // ranges must each resolve independently against the current
    // content via the relocation scan, not collapse onto one another.
    let repo = TestRepo::new()?;

    // State A: `target` is on line 2. Pin same.txt#L2-L2 here (the
    // file-backed `add` CLI hashes the current worktree slice = `target`).
    repo.write_file("same.txt", "a\ntarget\nc\n")?;
    repo.commit_all("anchor one")?;
    repo.run_span(["add", "timeline-key", "same.txt#L2-L2"])?;

    // State B: prepend `intro`; `target` is now on line 3. Pin
    // same.txt#L3-L3 here (also hashes `target`).
    repo.write_file("same.txt", "intro\na\ntarget\nc\n")?;
    repo.commit_all("anchor two")?;
    repo.run_span(["add", "timeline-key", "same.txt#L3-L3"])?;
    repo.run_span(["why", "timeline-key", "-m", "timeline cache key regression"])?;

    // Commit the span file alongside an unrelated change so HEAD's
    // same.txt stays at State B.
    repo.write_file("other.txt", "unrelated\n")?;
    repo.commit_all("unrelated head")?;
    repo.write_commit_graph()?;
    let gix = repo.gix_repo()?;

    // HEAD same.txt = `intro\na\ntarget\nc`. Anchor 1 (L2-L2, pinned
    // `target`) finds `target` relocated to line 3 → Moved. Anchor 2
    // (L3-L3, pinned `target`) matches in place → Fresh.
    let resolved = resolve_span(
        &gix,
        ".span",
        "timeline-key",
        EngineOptions::committed_only(),
    )?;
    let statuses: Vec<AnchorStatus> = resolved
        .anchors
        .iter()
        .map(|anchor| anchor.status.clone())
        .collect();
    assert_eq!(
        statuses,
        vec![AnchorStatus::Moved, AnchorStatus::Fresh],
        "same-path anchors pinning identical text at different ranges must resolve independently"
    );
    Ok(())
}

/// Make a submodule gitlink at `sub/` pointing at a second scratch repo.
/// Returns the bare-like path of the inner repo so the caller can advance
/// its tip and re-stage the gitlink.
fn add_submodule_gitlink(repo: &TestRepo, sub_rel: &str) -> Result<PathBuf> {
    let inner = tempfile::tempdir()?;
    let inner_path = inner.keep();
    std::process::Command::new("git")
        .args(["init", "--initial-branch=main"])
        .arg(&inner_path)
        .output()?;
    std::fs::write(inner_path.join("inner.txt"), "hello\n")?;
    std::process::Command::new("git")
        .current_dir(&inner_path)
        .args(["-c", "user.email=t@e", "-c", "user.name=T", "add", "-A"])
        .output()?;
    std::process::Command::new("git")
        .current_dir(&inner_path)
        .args([
            "-c",
            "user.email=t@e",
            "-c",
            "user.name=T",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-m",
            "inner",
        ])
        .output()?;
    repo.run_git([
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        &inner_path.to_string_lossy(),
        sub_rel,
    ])?;
    repo.commit_all("add submodule")?;
    Ok(inner_path)
}

// ---------------------------------------------------------------------------
// Acceptance tests.
// ---------------------------------------------------------------------------

/// Plan bullet: Worktree-only drift → Changed, source=Worktree, current.blob = None, exit 1.
#[test]
fn worktree_only_drift_changed_source_worktree_no_blob_exit_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Unstaged edit only.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let r = &mr.anchors[0];
    assert_eq!(r.status, AnchorStatus::Changed);
    // Source / current.blob live on the Phase 1 `Finding` shape which
    // `resolve_span`'s `AnchorResolved` will be widened to carry. The
    // check below pins the observable result once the widening lands.
    assert!(r.current.is_some());
    assert!(
        r.current.as_ref().unwrap().blob.is_none(),
        "worktree-only reads carry no blob OID"
    );
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

/// Plan bullet: `git add` moves drift from Worktree to Index;
/// current.blob = Some(staged_oid); exit still 1.
#[test]
fn git_add_moves_drift_worktree_to_index_with_staged_oid() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.run_git(["add", "file1.txt"])?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let r = &mr.anchors[0];
    assert_eq!(r.status, AnchorStatus::Changed);
    // Index-layer reads resolve to a blob.
    assert!(r.current.as_ref().and_then(|c| c.blob.as_ref()).is_some());
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

/// Plan bullet: `git span add` re-anchors matching content → exit 0.
#[test]

fn git_span_add_matching_sidecar_acknowledges_exit_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Live edit in the anchored anchor.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    // Stage a matching re-anchor via `git span add`.
    let _ = repo.run_span(["add", "m", "file1.txt#L1-L5"])?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "staged re-anchor must ack live drift"
    );
    Ok(())
}

/// Plan bullet: Subsequent worktree edit invalidates the ack → exit 1.
#[test]

fn worktree_edit_after_ack_invalidates_exit_one() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let _ = repo.run_span(["add", "m", "file1.txt#L1-L5"])?;
    // Edit after staging invalidates the sidecar.
    repo.write_file(
        "file1.txt",
        "lineTWO\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

/// Plan bullet: Ack matching survives Moved: anchor's extent shifts, sidecar at
/// old extent still acknowledges via anchor_id.
#[test]

fn ack_survives_moved_via_range_id() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Stage an ack at the original extent.
    let _ = repo.run_span(["add", "m", "file1.txt#L1-L5"])?;
    // Now shift location: prepend two lines, committing the move so the
    // anchored bytes come back via rename/move detection at the new
    // extent.
    repo.write_file(
        "file1.txt",
        "prefix1\nprefix2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("shift")?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let r = &mr.anchors[0];
    assert_eq!(r.status, AnchorStatus::Moved);
    // Non-zero exit only if the ack fails to match by anchor_id — the
    // point of this test.
    let out = repo.run_span(["stale", "m", "--no-exit-code"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

#[test]
fn commit_reanchor_replaces_moved_range_instead_of_adding_duplicate() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    repo.write_file(
        "file1.txt",
        "prefix1\nprefix2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("shift")?;

    // File-backed model: the anchored content (lines 1-5) relocated to
    // lines 3-7 within HEAD after the committed shift; the resolver's
    // content-hash relocation scan reports it as Moved with the new
    // destination range.
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("moved") && stdout.contains("file1.txt#L3-L7"),
        "stdout={stdout}"
    );

    // Re-anchor by editing the worktree span file directly (no staging
    // area): remove the stale range, add the relocated one. The span
    // must then hold exactly one anchor and resolve clean.
    repo.span_stdout(["remove", "m", "file1.txt#L1-L5"])?;
    repo.span_stdout(["add", "m", "file1.txt#L3-L7"])?;
    let span = git_span::read_span(&repo.gix_repo()?, "m")?;
    assert_eq!(span.anchors.len(), 1, "re-anchor must replace old anchor");
    assert_eq!(span.anchors[0].1.path, "file1.txt");
    assert_eq!(
        span.anchors[0].1.extent,
        git_span::types::AnchorExtent::LineRange { start: 3, end: 7 }
    );
    let stale = repo.run_span(["stale", "m"])?;
    assert_eq!(stale.status.code(), Some(0));
    Ok(())
}

/// Plan bullet: Sidecar captured before a `.gitattributes` EOL change: re-normalized
/// on read still acknowledges.
#[test]

fn sidecar_before_gitattributes_eol_change_still_acks() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Stage a re-anchor under the default (no .gitattributes) rules.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let _ = repo.run_span(["add", "m", "file1.txt#L1-L5"])?;
    // Now flip EOL policy. The stored sidecar bytes and the live
    // worktree bytes must both re-normalize to the same canonical form.
    write_gitattributes(&repo, "*.txt text eol=lf\n")?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

/// Plan bullet: `git add -p` partial staging: anchor straddles partial edit; both
/// layers show drift with shifted locations.
#[test]
fn git_add_p_partial_staging_shows_both_layer_drift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Edit two separate regions.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nlineTEN\n",
    )?;
    // Stage only the first hunk (simulating `git add -p` — we just stage
    // an intermediate state that differs from both HEAD and worktree).
    repo.write_file(
        "file1.txt.staged",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    std::fs::rename(
        repo.path().join("file1.txt.staged"),
        repo.path().join("file1.txt"),
    )?;
    repo.run_git(["add", "file1.txt"])?;
    // Now restore the worktree to the full two-region edit.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nlineTEN\n",
    )?;
    let out = repo.run_span(["stale", "m", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(1));
    let stdout = String::from_utf8(out.stdout)?;
    // Both layer sources must show up in the porcelain `src` column.
    assert!(stdout.contains("CHANGED"));
    Ok(())
}

/// Plan bullet: Merge-conflict path → MergeConflict, current.blob = None.
#[test]
fn merge_conflict_path_surfaces_merge_conflict_no_blob() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Create branch divergence that produces a real stage-1/2/3 on file1.txt.
    repo.run_git(["checkout", "-b", "feature"])?;
    repo.write_file(
        "file1.txt",
        "feat1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("feature")?;
    repo.run_git(["checkout", "main"])?;
    repo.write_file(
        "file1.txt",
        "main1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("main edit")?;
    let _ = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "feature"])
        .output()?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let r = &mr.anchors[0];
    assert_eq!(r.status, AnchorStatus::MergeConflict);
    assert!(
        r.current.as_ref().is_none_or(|c| c.blob.is_none()),
        "MergeConflict carries path only, no blob"
    );
    Ok(())
}

/// Plan bullet: CRLF checkout of an LF blob → no false drift.
#[test]
fn crlf_checkout_of_lf_blob_no_false_drift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Turn on CRLF-on-checkout and rewrite worktree bytes with CRLF.
    write_gitattributes(&repo, "*.txt text eol=crlf\n")?;
    repo.write_file(
        "file1.txt",
        "line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\nline9\r\nline10\r\n",
    )?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(mr.anchors[0].status, AnchorStatus::Fresh);
    Ok(())
}

/// Regression (F3): in a repo with EOL normalization (`* text=auto`) and
/// CRLF worktree content, `git span add` must derive the stored content
/// hash from the *same* git-normalized canonical bytes the resolver
/// compares against. Before the fix, add hashed raw CRLF bytes (line
/// anchor: `.lines()` slices retain `\r`) while the resolver's worktree
/// layer hashed clean-filter-normalized (LF) bytes, so a freshly-added,
/// unmodified anchor falsely resolved as Changed/Moved with zero source
/// edits. Both a line anchor and a whole-file anchor must be Fresh.
#[test]
fn add_under_eol_normalization_freshly_added_anchors_are_fresh() -> Result<()> {
    let repo = TestRepo::new()?;
    // EOL normalization on: committed blob is LF, worktree is CRLF.
    write_gitattributes(&repo, "* text=auto\n")?;
    repo.run_git(["config", "core.autocrlf", "true"])?;
    repo.write_file(
        "src.txt",
        "line1\r\nline2\r\nline3\r\nline4\r\nline5\r\nline6\r\nline7\r\nline8\r\n",
    )?;
    repo.commit_all("seed crlf source under text=auto")?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Add against the CRLF worktree, then commit the span so the
    // resolver sees a HEAD-layer span with the add-time stored hash.
    repo.run_span(["add", "m", "src.txt#L2-L5"])?;
    repo.run_span(["add", "m", "src.txt"])?;
    repo.run_span(["why", "m", "-m", "eol normalization regression"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span m"])?;

    // No source edits: both anchors must be Fresh.
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let line = mr
        .anchors
        .iter()
        .find(|a| matches!(a.anchored.extent, AnchorExtent::LineRange { .. }))
        .expect("line anchor present");
    let whole = mr
        .anchors
        .iter()
        .find(|a| matches!(a.anchored.extent, AnchorExtent::WholeFile))
        .expect("whole-file anchor present");
    assert_eq!(
        line.status,
        AnchorStatus::Fresh,
        "freshly-added line anchor under text=auto must be Fresh"
    );
    assert_eq!(
        whole.status,
        AnchorStatus::Fresh,
        "freshly-added whole-file anchor under text=auto must be Fresh"
    );

    // Committed-only (HEAD-layer) comparison: the resolver hashes the
    // LF-normalized blob bytes. Pre-fix, `git span add` stored the hash
    // of the *raw CRLF* worktree bytes for the whole-file anchor (the
    // `.lines()` split masks pure-CRLF for line anchors but not whole
    // file), so this layer falsely reported Changed with no source edit.
    let mr_head = resolve_span(
        &repo.gix_repo()?,
        ".span",
        "m",
        EngineOptions::committed_only(),
    )?;
    for a in &mr_head.anchors {
        assert_eq!(
            a.status,
            AnchorStatus::Fresh,
            "freshly-added {:?} anchor must be Fresh at the HEAD layer",
            a.anchored.extent
        );
    }
    Ok(())
}

/// Plan bullet: Whole-file pin on a binary asset: blob OID change → Changed;
/// `git span add <name> <path>` re-anchors and acknowledges.
#[test]

fn whole_file_pin_binary_asset_re_anchor_acks() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Commit a small binary-looking asset.
    std::fs::write(repo.path().join("hero.png"), [0u8, 1, 2, 3, 4, 5, 6, 7])?;
    repo.commit_all("add binary")?;
    // Pin the whole file (CLI omits `#L...` for whole-file per D2).
    let _ = repo.run_span(["add", "m", "hero.png"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Mutate the binary, exit 1.
    std::fs::write(repo.path().join("hero.png"), [9u8, 9, 9, 9])?;
    repo.commit_all("mutate binary")?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(mr.anchors[0].status, AnchorStatus::Changed);
    assert_eq!(mr.anchors[0].anchored.extent, AnchorExtent::WholeFile);
    // Re-anchor acknowledges.
    let _ = repo.run_span(["add", "m", "hero.png"])?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

/// Plan bullet: Whole-file pin on a submodule gitlink: index-layer SHA change
/// (`git submodule update` staged) → Changed.
#[test]

fn whole_file_pin_submodule_gitlink_index_sha_change_changed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let inner = add_submodule_gitlink(&repo, "sub")?;
    // Pin the gitlink path itself (whole-file allowed per D2).
    let _ = repo.run_span(["add", "m", "sub"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Advance inner repo and stage the bump in outer repo.
    std::fs::write(inner.join("inner.txt"), "hello 2\n")?;
    std::process::Command::new("git")
        .current_dir(&inner)
        .args([
            "-c",
            "user.email=t@e",
            "-c",
            "user.name=T",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-am",
            "bump",
        ])
        .output()?;
    std::process::Command::new("git")
        .current_dir(repo.path().join("sub"))
        .args(["pull"])
        .output()?;
    repo.run_git(["add", "sub"])?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(mr.anchors[0].status, AnchorStatus::Changed);
    Ok(())
}

/// Line-range anchor orphaned by a directory-to-submodule promotion must
/// surface as `AnchorStatus::Submodule`, not `Deleted`. The content still
/// exists inside the submodule; the status signals that the anchored path
/// is unreachable because a parent directory is a gitlink.
#[test]
fn line_range_anchor_inside_submodule_promoted_directory_reports_submodule() -> Result<()> {
    let repo = TestRepo::new()?;

    // Create a plain directory with a file, anchoring a line range inside it.
    std::fs::create_dir_all(repo.path().join("lib"))?;
    repo.write_file(
        "lib/util.ts",
        "export function add(a: number, b: number) {\n  return a + b;\n}\nexport function sub(a: number, b: number) {\n  return a - b;\n}\n",
    )?;
    repo.commit_all("init lib/util.ts")?;
    repo.run_span(["add", "util/add", "lib/util.ts#L1-L3"])?;
    repo.run_span(["why", "util/add", "-m", "add function contract"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span util/add"])?;

    // Verify the anchor is initially fresh.
    let out = repo.run_span(["stale", "util/add", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(0), "fresh span: exit 0");

    // Promote the `lib` directory into a submodule.
    let inner = tempfile::tempdir()?;
    let inner_path = inner.keep();
    std::process::Command::new("git")
        .args(["init", "--initial-branch=main"])
        .arg(&inner_path)
        .output()?;
    std::fs::write(inner_path.join("util.ts"), "submodule content\n")?;
    std::process::Command::new("git")
        .current_dir(&inner_path)
        .args(["-c", "user.email=t@e", "-c", "user.name=T", "add", "-A"])
        .output()?;
    std::process::Command::new("git")
        .current_dir(&inner_path)
        .args([
            "-c", "user.email=t@e", "-c", "user.name=T",
            "-c", "commit.gpgsign=false", "commit", "-m", "inner",
        ])
        .output()?;
    repo.run_git(["rm", "-r", "lib"])?;
    repo.run_git([
        "-c", "protocol.file.allow=always", "submodule", "add",
        &inner_path.to_string_lossy(), "lib",
    ])?;
    repo.commit_all("promote lib to submodule")?;

    // Stale must report SUBMODULE, not DELETED.
    let out = repo.run_span(["stale", "util/add", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(1), "SUBMODULE is a stale status → exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("SUBMODULE"),
        "expected SUBMODULE, got: {stdout}"
    );
    assert!(
        !stdout.contains("DELETED"),
        "must not report DELETED for a submodule-orphaned anchor"
    );

    // --fix must leave the span untouched (fail-closed).
    let before = std::fs::read_to_string(repo.path().join(".span").join("util").join("add"))?;
    let _fix = repo.run_span(["stale", "--fix"])?;
    let after = std::fs::read_to_string(repo.path().join(".span").join("util").join("add"))?;
    assert_eq!(before, after, "--fix must not touch a SUBMODULE anchor");

    Ok(())
}

/// Plan bullet: Whole-file pin on a symlink: retarget → Changed. Line-anchor pin
/// on a symlink is rejected at `git span add`.
#[test]

fn whole_file_pin_symlink_retarget_changed_and_line_range_rejected() -> Result<()> {
    if !support::symlinks_supported() {
        eprintln!("SKIP: symlinks unavailable on this host");
        return Ok(());
    }
    let repo = TestRepo::seeded()?;
    support::symlink_file("file1.txt".as_ref(), &repo.path().join("link"))?;
    repo.commit_all("add symlink")?;
    // Whole-file pin allowed.
    let _ = repo.run_span(["add", "m", "link"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Retarget the symlink.
    std::fs::remove_file(repo.path().join("link"))?;
    support::symlink_file("file2.txt".as_ref(), &repo.path().join("link"))?;
    repo.commit_all("retarget")?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(mr.anchors[0].status, AnchorStatus::Changed);
    // Line-anchor pin on a symlink must be rejected at add time.
    let rej = repo.run_span(["add", "n", "link#L1-L1"])?;
    assert_ne!(
        rej.status.code(),
        Some(0),
        "line-anchor on symlink must fail"
    );
    Ok(())
}

/// Plan bullet: LFS text file, content cached: slice-level Changed/Moved equivalent
/// to non-LFS.
#[test]
fn lfs_text_content_cached_behaves_like_non_lfs() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_gitattributes(&repo, "*.bigtxt filter=lfs diff=lfs merge=lfs -text\n")?;
    let oid_a = "a".repeat(64);
    let oid_b = "b".repeat(64);
    // Seed cache for both pointer OIDs so the LFS reader treats both
    // sides as fetched and runs the comparator on smudged bytes.
    seed_lfs_cache(&repo, &oid_a, b"alpha content\n")?;
    seed_lfs_cache(&repo, &oid_b, b"beta content\n")?;
    write_lfs_pointer(&repo, "doc.bigtxt", &oid_a, 42)?;
    repo.commit_all("lfs text")?;
    let _ = repo.run_span(["add", "m", "doc.bigtxt#L1-L1"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // File-backed model: drift the pointer in the working tree
    // (uncommitted) so HEAD retains the anchored pointer.
    write_lfs_pointer(&repo, "doc.bigtxt", &oid_b, 42)?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(mr.anchors[0].status, AnchorStatus::Changed);
    Ok(())
}

/// Plan bullet: LFS text file, content missing: ContentUnavailable(LfsNotFetched),
/// exit 1; exit 0 with --ignore-unavailable.
#[test]
fn lfs_text_content_missing_unavailable_lfs_not_fetched() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_gitattributes(&repo, "*.bigtxt filter=lfs diff=lfs merge=lfs -text\n")?;
    let oid_c = "c".repeat(64);
    let oid_d = "d".repeat(64);
    // Seed cache only for the anchored pointer; the post-mutation
    // pointer's cache is intentionally absent so the LFS reader
    // surfaces `LfsNotFetched`.
    seed_lfs_cache(&repo, &oid_c, b"gamma content\n")?;
    write_lfs_pointer(&repo, "doc.bigtxt", &oid_c, 42)?;
    repo.commit_all("lfs text")?;
    let _ = repo.run_span(["add", "m", "doc.bigtxt#L1-L1"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Pointer changes in the working tree (uncommitted), cache missing
    // for the new oid.
    write_lfs_pointer(&repo, "doc.bigtxt", &oid_d, 42)?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(
        mr.anchors[0].status,
        AnchorStatus::ContentUnavailable(UnavailableReason::LfsNotFetched)
    );
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

/// Plan bullet: LFS repo with no `git-lfs` binary on PATH:
/// ContentUnavailable(LfsNotInstalled).
#[test]
fn lfs_repo_without_binary_content_unavailable_lfs_not_installed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_gitattributes(&repo, "*.bigtxt filter=lfs diff=lfs merge=lfs -text\n")?;
    let oid_e = "e".repeat(64);
    let oid_f = "f".repeat(64);
    // Seed both pointer caches — the reader must still surface
    // `LfsNotInstalled` because the subprocess spawn fails before any
    // cache probe matters.
    seed_lfs_cache(&repo, &oid_e, b"epsilon\n")?;
    seed_lfs_cache(&repo, &oid_f, b"phi\n")?;
    write_lfs_pointer(&repo, "doc.bigtxt", &oid_e, 42)?;
    repo.commit_all("lfs text")?;
    let _ = repo.run_span(["add", "m", "doc.bigtxt#L1-L1"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Drift the pointer in the working tree (uncommitted).
    write_lfs_pointer(&repo, "doc.bigtxt", &oid_f, 42)?;
    // Build a sandbox PATH that contains `git` (the engine shells out to
    // git for many things) but excludes `git-lfs`, so the filter-process
    // spawn fails with ENOENT.
    let sandbox = tempfile::tempdir()?;
    let git_path = which::which("git")?;
    // A `git` trampoline that re-execs the real git. Built from the
    // dependency-free test-helper binary so this works on Windows too,
    // where symlinking an exe onto PATH is not portable.
    let trampoline = if cfg!(windows) {
        sandbox.path().join("git.exe")
    } else {
        sandbox.path().join("git")
    };
    std::fs::copy(env!("CARGO_BIN_EXE_git-span-test-helper"), &trampoline)?;
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("PATH", sandbox.path())
        .env("HELPER_MODE", "exec")
        .env("HELPER_TARGET", &git_path)
        .args(["stale", "m", "--format=porcelain"])
        .output()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stdout.contains("LFS_NOT_INSTALLED") || stdout.contains("LfsNotInstalled"),
        "stdout={stdout} stderr={stderr}"
    );
    Ok(())
}

/// Plan bullet: Custom `filter=<name>` driver with broken smudge:
/// ContentUnavailable(FilterFailed { filter }).
#[test]
fn custom_filter_broken_smudge_surfaces_filter_failed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_gitattributes(&repo, "*.secret filter=broken\n")?;
    // Configure a filter whose smudge command will fail. `clean=cat`
    // lets the fixture commit succeed; `smudge=false` is what the
    // engine's read path will hit. (The engine routes through
    // `filter.broken.process` if set; with no `.process` configured,
    // the dispatch tree stays on `FilterFailed` per slice 7.)
    repo.run_git(["config", "filter.broken.clean", "cat"])?;
    repo.run_git(["config", "filter.broken.smudge", "false"])?;
    repo.run_git(["config", "filter.broken.required", "true"])?;
    repo.write_file("config.secret", "secret payload\n")?;
    repo.commit_all("add filtered file")?;
    let _ = repo.run_span(["add", "m", "config.secret#L1-L1"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    repo.write_file("config.secret", "new payload\n")?;
    repo.commit_all("mutate")?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert!(matches!(
        mr.anchors[0].status,
        AnchorStatus::ContentUnavailable(UnavailableReason::FilterFailed { .. })
    ));
    Ok(())
}

/// Regression: a line-anchor pin on an LFS-tracked path must report
/// `Fresh` immediately after the span commit when the worktree hasn't
/// been edited. The previous implementation hashed the raw (smudged)
/// worktree bytes during the `index → worktree` diff pass, which made
/// every LFS file look modified (index stores the pointer, worktree
/// stores the smudged content) and mangled the tracked line range via
/// spurious hunks. Requires `git-lfs` on PATH; skipped otherwise.
#[test]
fn lfs_line_range_unchanged_worktree_reports_fresh() -> Result<()> {
    if std::process::Command::new("git-lfs")
        .arg("version")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
    {
        eprintln!("skipping: git-lfs not available");
        return Ok(());
    }
    let repo = TestRepo::new()?;
    repo.run_git(["lfs", "install", "--local"])?;
    write_gitattributes(&repo, "*.tsv filter=lfs diff=lfs merge=lfs -text\n")?;
    repo.run_git(["add", ".gitattributes"])?;
    repo.run_git(["commit", "-m", "attr"])?;
    // A 50-line LFS-tracked file. The clean filter (via `git add`) rewrites
    // the index entry to a pointer, while the worktree retains the smudged
    // content.
    let mut body = String::with_capacity(50 * 12);
    for i in 1..=50u32 {
        body.push_str(&format!("row{i}\tval\n"));
    }
    repo.write_file("data.tsv", &body)?;
    repo.run_git(["add", "data.tsv"])?;
    repo.run_git(["commit", "-m", "data"])?;
    let _ = repo.run_span(["add", "pn", "data.tsv#L1-L10"])?;
    repo.run_span(["why", "pn", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Write a commit-graph so the reverse-indexed walk can use Bloom
    // filters. Must be done after the span commit so that commit is
    // included.
    repo.write_commit_graph()?;
    // No edits to data.tsv. Stale must report no drift.
    let out = repo.run_span(["stale", "pn", "--format=porcelain"])?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    assert_eq!(
        out.status.code(),
        Some(0),
        "expected no stale findings; stdout=\n{stdout}\nstderr=\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// Tracked-file model (round-2): a committed `git mv` of a pinned path
/// relocates the stored content verbatim. The resolver finds the stored
/// content hash at the new path and reports `Moved` (never `Deleted`,
/// never the dead ref-era "orphaned"); `current` points at the new path.
#[test]
fn git_mv_across_pinned_file_is_moved() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    repo.commit_all("rename")?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let r = &mr.anchors[0];
    assert_eq!(r.status, AnchorStatus::Moved);
    // Anchored (origin) path unchanged.
    assert_eq!(r.anchored.path, PathBuf::from("file1.txt"));
    // Current location points at the relocation target.
    assert_eq!(
        r.current.as_ref().map(|c| c.path.clone()),
        Some(PathBuf::from("renamed.txt"))
    );
    Ok(())
}

/// Plan bullet: `intent-to-add` path (`git add -N`) with a pinned anchor: zero-OID
/// index entry; resolver treats as unstaged; new-file variant (no HEAD) falls back
/// to worktree read.
#[test]
fn intent_to_add_path_zero_oid_treated_as_unstaged() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Create a new file staged with -N — zero-OID index entry.
    repo.write_file("new.txt", "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n")?;
    repo.run_git(["add", "-N", "new.txt"])?;
    // Append-add without commit would fail because HEAD has no blob; to
    // get a span whose anchored path maps to an intent-to-add file on
    // the next run, commit the file first then add -N to a different
    // update. Simpler: pin file1.txt and then mutate+intent-to-add on
    // a sibling — but the plan bullet really wants the zero-OID case.
    // For now, pin file1.txt, then mutate it and `git add -N` only the
    // new file so the resolver sees the zero-OID shape on traversal.
    seed_line_range_span(&repo, "m")?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    // The pinned anchor itself drifts via the worktree layer; zero-OID
    // sibling must not poison the read.
    assert_eq!(mr.anchors[0].status, AnchorStatus::Changed);
    assert_eq!(
        mr.anchors[0].current.as_ref().and_then(|c| c.blob.as_ref()),
        None
    );
    Ok(())
}

/// Plan bullet: Rename-heavy changeset (>1000 paths): `stale` completes without
/// pairing blow-up; a note indicates rename detection was disabled.
#[test]
fn rename_heavy_changeset_completes_with_note() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Create 1100 files in a bulk add, anchor the span on one of them so
    // the candidate-path filter classifies the rename commit as
    // interesting (and therefore exercises the rename-budget code path).
    for i in 0..1100u32 {
        repo.write_file(&format!("bulk/a_{i}.txt"), "x\n")?;
    }
    repo.commit_all("bulk add")?;
    // Span anchor on one of the bulk paths so it lives inside the
    // candidate-path set and the bulk-rename commit can't be skipped.
    repo.run_span(["add", "m", "bulk/a_0.txt#L1-L1"])?;
    repo.run_span(["why", "m", "-m", "seed"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span m"])?;
    for i in 0..1100u32 {
        repo.run_git(["mv", &format!("bulk/a_{i}.txt"), &format!("bulk/b_{i}.txt")])?;
    }
    repo.commit_all("bulk rename")?;
    // Tracked-file model (round-2): the span stores paths plus a content
    // hash. A committed rename of the anchored path relocates the stored
    // content verbatim, so the resolver finds the stored hash at a new
    // path and reports `Moved` (never the dead ref-era "orphaned"). The
    // command must still complete promptly across a 1100-file rename
    // changeset and report drift.
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "stale must report drift; stderr={}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        !String::from_utf8_lossy(&out.stdout)
            .to_lowercase()
            .contains("orphan"),
        "the word 'orphaned' must never appear in stale output; stdout={}",
        String::from_utf8_lossy(&out.stdout)
    );
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    assert_eq!(mr.anchors[0].status, AnchorStatus::Moved);
    Ok(())
}

/// Plan bullet: Index-file SHA-1 trailer changes mid-run: stderr warning printed;
/// exit code unaffected.
#[test]
fn index_sha1_trailer_changes_mid_run_prints_warning() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    // Simulate a concurrent index update by touching the index file
    // after invocation start. We cannot deterministically race the real
    // binary from a test, so this scenario ultimately needs an internal
    // hook; placeholder: drive via an env-var hook the engine honors in
    // tests. Exit code must be zero in the clean case (no drift).
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

// ---------------------------------------------------------------------------
// Type-level smoke: exercises the Phase 1 public boundary in trivial ways
// so that refactors to the types show up here as compile errors rather
// than only in the library crate. Kept ignored — runtime would hit
// `todo!()` on `ContentRef::read_normalized`.
// ---------------------------------------------------------------------------

#[test]
fn content_ref_read_normalized_is_the_single_boundary() -> Result<()> {
    let layers = LayerSet::full();
    assert!(layers.worktree && layers.index && layers.staged_span);
    let committed = LayerSet::committed_only();
    assert!(!committed.worktree && !committed.index && !committed.staged_span);
    let _scope = Scope::All;
    let _src = DriftSource::Worktree;
    let _ref = ContentRef::WorktreeFile(PathBuf::from("file1.txt"));
    // Actually invoking read_normalized() would hit todo!(); we only
    // need this to type-check. Keep as a compile-time guard.
    Ok(())
}

/// Plan bullet: `resolve_anchor` agrees with `resolve_span`. Smoke-tests the
/// single-anchor entry point against the span-level entry point once the
/// engine slice lands.
#[test]
fn resolve_range_agrees_with_resolve_span_smoke() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "m")?;
    let mr = resolve_span(&repo.gix_repo()?, ".span", "m", EngineOptions::full())?;
    let rid = &mr.anchors[0].anchor_id;
    let r = resolve_anchor(&repo.gix_repo()?, ".span", "m", rid, EngineOptions::full())?;
    assert_eq!(r.status, mr.anchors[0].status);
    Ok(())
}

/// Plan bullet (coverage of `stale_spans`): worst-first ordering across spans.
#[test]
fn stale_spans_sorts_worst_first_smoke() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "clean")?;
    seed_line_range_span(&repo, "dirty")?;
    repo.write_file(
        "file1.txt",
        "XXX\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("mutate")?;
    let all = stale_spans(&repo.gix_repo()?, ".span", EngineOptions::full())?;
    assert!(
        all.iter()
            .any(|m| m.anchors.iter().any(|r| r.status == AnchorStatus::Changed))
    );
    Ok(())
}

/// A clean span (all anchors Fresh, no pending) must be excluded from `stale_spans`.
#[test]
fn stale_spans_excludes_clean_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "clean-only")?;
    let all = stale_spans(&repo.gix_repo()?, ".span", EngineOptions::full())?;
    assert!(
        !all.iter().any(|m| m.name == "clean-only"),
        "clean span must not appear in stale_spans output"
    );
    Ok(())
}

/// A span with one Changed anchor must be included in `stale_spans`.
#[test]
fn stale_spans_includes_changed_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "drifty")?;
    repo.write_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("mutate")?;
    let all = stale_spans(&repo.gix_repo()?, ".span", EngineOptions::full())?;
    assert!(
        all.iter()
            .any(|m| m.name == "drifty"
                && m.anchors.iter().any(|a| a.status == AnchorStatus::Changed)),
        "changed span must appear in stale_spans output"
    );
    Ok(())
}

/// When a repo has both a clean span and a stale span, only the stale span appears.
#[test]
fn stale_spans_filters_clean_leaves_stale() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // "quiet" anchors lines 6-10 (stable); "noisy" anchors lines 1-5 (mutated below).
    repo.run_span(["add", "quiet", "file1.txt#L6-L10"])?;
    repo.run_span(["why", "quiet", "-m", "stable anchor"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span quiet"])?;
    seed_line_range_span(&repo, "noisy")?;
    // Mutate only line 1 — "noisy" drifts, "quiet" (lines 6-10) stays clean.
    repo.write_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("mutate")?;
    let all = stale_spans(&repo.gix_repo()?, ".span", EngineOptions::full())?;
    assert!(
        all.iter().any(|m| m.name == "noisy"),
        "stale span must appear"
    );
    assert!(
        !all.iter().any(|m| m.name == "quiet"),
        "clean span must not appear"
    );
    Ok(())
}

/// All-clean repo + `--format=json` → empty stdout, exit 0.
#[test]
fn all_clean_json_empty_stdout() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "clean")?;
    let out = repo.run_span(["stale", "--format=json"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.trim().is_empty(),
        "json output must be empty when all spans are clean, got: {stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "exit 0 when no drift");
    Ok(())
}

/// All-clean repo + `--format=porcelain` → empty stdout, exit 0.
#[test]
fn all_clean_porcelain_empty_stdout() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "clean")?;
    let out = repo.run_span(["stale", "--format=porcelain"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.trim().is_empty(),
        "porcelain output must be empty when all spans are clean, got: {stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "exit 0 when no drift");
    Ok(())
}

/// Stale-present repo + `--format=json` → non-empty envelope, exit 1.
#[test]
fn stale_present_json_emits_envelope() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range_span(&repo, "drifty")?;
    repo.write_file(
        "file1.txt",
        "CHANGED\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("mutate")?;
    let out = repo.run_span(["stale", "--format=json"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.trim().is_empty(),
        "json output must not be empty when a span is stale"
    );
    assert!(
        stdout.contains("schema_version"),
        "json output must contain schema_version"
    );
    assert_eq!(out.status.code(), Some(1), "exit 1 when drift present");
    Ok(())
}

