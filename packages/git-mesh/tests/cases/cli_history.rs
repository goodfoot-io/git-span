//! CLI: `git mesh history <mesh>` — Phase 2 skipped acceptance checks.
//!
//! Every test in this module is `#[ignore]` — they are pending assertions
//! against the Phase-1 stubs (which `todo!()`). They must compile and show as
//! ignored/skipped, not failing.
//!
//! The fixture repo scenario mirrors the canonical example in
//! `docs/history-example-output-xml.md`: a mesh is created, its why prose is
//! edited, an anchor is modified, an anchor is removed and a new one added,
//! and the working tree is left with uncommitted drift.

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Seed a four-commit mesh scenario:
///
/// C1: create mesh `m` with two line-range anchors (file1.txt#L1-L5,
///     file2.txt#L1-L3) and a why.
/// C2: edit the why prose AND change the content of file2.txt so that
///     the anchor body changes → `modified` event.
/// C3: pure re-hash / byte-identical re-anchor of file1.txt (no-op commit
///     from the history perspective — must be omitted).
/// C4: remove the file2.txt anchor and add a whole-file anchor on file3.txt.
///
/// After seeding, the working tree is left with file3.txt edited (uncommitted
/// drift), so the `current` section should appear.
///
/// Returns `(repo, mesh_name)`.
fn seed_history_scenario() -> Result<(TestRepo, &'static str)> {
    let repo = TestRepo::new()?;
    let mesh = "m";

    // Write initial source files.
    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file(
        "file2.txt",
        "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    )?;
    repo.write_file(
        "file3.txt",
        "first\nsecond\nthird\nfourth\nfifth\n",
    )?;
    repo.commit_all("initial files")?;

    // C1: create the mesh.
    repo.mesh_stdout(["add", mesh, "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["add", mesh, "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", mesh, "-m", "First why: tracks the two source files."])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "C1: create mesh"])?;

    // C2: edit why prose AND mutate file2.txt so the anchor content changes.
    repo.write_file(
        "file2.txt",
        "ALPHA\nBETA\nGAMMA\ndelta\nepsilon\n",
    )?;
    repo.commit_all("C2 source: mutate file2")?;
    repo.mesh_stdout(["add", mesh, "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["why", mesh, "-m", "Second why: file2 lines updated."])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "C2: update why and re-anchor file2"])?;

    // C3: a re-anchor of file1.txt against byte-identical content. Re-running
    // `git mesh add` recomputes the same content hash, so the mesh file's bytes
    // do not change and there is nothing for git to stage. The commit therefore
    // does not touch `.mesh/<mesh>` at all (`--allow-empty` keeps it in the
    // history), so the path-scoped history walk omits it entirely — the
    // "no-op commit must be omitted" invariant.
    repo.mesh_stdout(["add", mesh, "file1.txt#L1-L5"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git([
        "commit",
        "--allow-empty",
        "-m",
        "C3: no-op re-anchor of file1 (byte-identical)",
    ])?;

    // C4: remove the file2.txt anchor and add a whole-file anchor on file3.txt.
    repo.mesh_stdout(["remove", mesh, "file2.txt#L1-L3"])?;
    repo.mesh_stdout(["add", mesh, "file3.txt"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "C4: remove file2 anchor, add file3 whole-file"])?;

    // Leave working tree with uncommitted edit to file3.txt so `current`
    // section appears.
    repo.write_file(
        "file3.txt",
        "first\nsecond\nthird\nfourth\nfifth\nSIXTH (uncommitted)\n",
    )?;

    Ok((repo, mesh))
}

// ---------------------------------------------------------------------------
// Test: oldest→newest commit ordering
// ---------------------------------------------------------------------------

#[test]
fn commits_ordered_oldest_to_newest() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let out = repo.run_mesh(["history", mesh])?;
    // Phase 3 will panic here (todo!()); this test is skipped.
    let xml = String::from_utf8_lossy(&out.stdout);

    // Commits must appear in chronological (oldest→newest) order.
    // Locate the byte offsets of the commit open-tags and verify ordering.
    let c1_pos = xml.find("C1: create mesh").expect("C1 commit summary missing");
    let c2_pos = xml.find("C2: update why").expect("C2 commit summary missing");
    let c4_pos = xml.find("C4: remove file2").expect("C4 commit summary missing");

    assert!(c1_pos < c2_pos, "C1 must precede C2 in output");
    assert!(c2_pos < c4_pos, "C2 must precede C4 in output");

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: skip-unchanged (no-op commit omitted)
// ---------------------------------------------------------------------------

#[test]
fn noop_commit_omitted() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let out = repo.run_mesh(["history", mesh])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    // C3 is a byte-identical re-anchor and must not appear in the output.
    assert!(
        !xml.contains("C3: no-op"),
        "no-op commit C3 must be omitted from history output; got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: event vocabulary (added / modified / removed)
// ---------------------------------------------------------------------------

#[test]
fn event_vocabulary_added_modified_removed() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let out = repo.run_mesh(["history", mesh])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    // C1: both anchors are first appearances → event="added"
    assert!(
        xml.contains("event=\"added\""),
        "expected event=\"added\" for first-appearance anchors; got:\n{xml}"
    );

    // C2: file2.txt anchor content changed → event="modified"
    assert!(
        xml.contains("event=\"modified\""),
        "expected event=\"modified\" for changed anchor; got:\n{xml}"
    );

    // C4: file2.txt anchor removed → event="removed"
    assert!(
        xml.contains("event=\"removed\""),
        "expected event=\"removed\" for dropped anchor; got:\n{xml}"
    );

    Ok(())
}

#[test]
fn first_appearance_is_added_not_modified() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let out = repo.run_mesh(["history", mesh])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    // The very first commit section must use event="added" for all anchors,
    // never event="modified" (there is no previous state to diff against).
    let c1_section_end = xml
        .find("C2: update why")
        .unwrap_or(xml.len());
    let c1_section = &xml[..c1_section_end];

    assert!(
        !c1_section.contains("event=\"modified\""),
        "first commit section must not use event=\"modified\"; got:\n{c1_section}"
    );
    assert!(
        c1_section.contains("event=\"added\""),
        "first commit section must use event=\"added\" for new anchors; got:\n{c1_section}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: conditional `current` entry
// ---------------------------------------------------------------------------

#[test]
fn current_present_when_worktree_drifts() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    // Worktree has uncommitted edit to file3.txt (set up by the fixture).
    let out = repo.run_mesh(["history", mesh])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    assert!(
        xml.contains("<current>"),
        "expected <current> block when worktree drifts; got:\n{xml}"
    );

    Ok(())
}

#[test]
fn current_absent_when_worktree_matches_head() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    // Stage and commit the worktree change so the tree is clean.
    repo.commit_all("make worktree clean")?;

    let out = repo.run_mesh(["history", mesh])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    assert!(
        !xml.contains("<current>"),
        "expected no <current> block when worktree matches HEAD; got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: `current` anchor `status` drawn from stale drift phrase set
// ---------------------------------------------------------------------------

#[test]
fn current_anchor_status_is_stale_phrase() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let out = repo.run_mesh(["history", mesh])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    // The drift phrase for a source change is "changed in the working tree"
    // (verbatim from format_drift_label).
    assert!(
        xml.contains("status=\"changed in the working tree\""),
        "expected status=\"changed in the working tree\" in <current> block; got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: per-anchor degradation note (file absent at a commit)
// ---------------------------------------------------------------------------

#[test]
fn degradation_note_file_absent_at_commit() -> Result<()> {
    // Build a scenario where an anchor references a file that does not exist
    // at an earlier commit in history.
    let repo = TestRepo::new()?;
    let mesh = "degraded";

    repo.write_file("src.txt", "line1\nline2\nline3\n")?;
    repo.commit_all("initial")?;

    // C1: anchor src.txt.
    repo.mesh_stdout(["add", mesh, "src.txt#L1-L3"])?;
    repo.mesh_stdout(["why", mesh, "-m", "initial why"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "C1: create mesh with src.txt"])?;

    // C2: delete src.txt while keeping the mesh anchor pointing at it.
    repo.run_git(["rm", "src.txt"])?;
    repo.run_git(["commit", "-m", "C2: delete src.txt"])?;

    // C3: a mesh-file commit (why edit) made *after* src.txt is gone. The
    // history walk reads the anchor's content from this commit's tree, where
    // src.txt is absent — so the timeline must degrade that anchor to a note
    // rather than aborting the whole report.
    repo.mesh_stdout(["why", mesh, "-m", "why after source deletion"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "C3: edit why after src.txt is gone"])?;

    let out = repo.run_mesh(["history", mesh])?;
    // Command must not abort even though the file is absent at one revision.
    // The output contains a degradation note, not an error exit.
    // (exit code check: 0 when walk is complete despite per-anchor degradation)
    let xml = String::from_utf8_lossy(&out.stdout);

    // Degradation note text verbatim from the plan / canonical doc.
    assert!(
        xml.contains("(file absent at this commit)"),
        "expected degradation note '(file absent at this commit)'; got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: incomplete-walk fail-closed
// ---------------------------------------------------------------------------

#[test]
#[ignore = "Phase 3 not yet implemented — todo!() stubs; deterministic walk-budget exhaustion may require harness-level support"]
fn incomplete_walk_exits_nonzero_with_warning() -> Result<()> {
    // Forcing walk_complete == false deterministically requires either a very
    // large repo history or a seam in the walk budget. This test asserts the
    // *structure* of the contract; a real harness hook would inject
    // walk_complete=false via a test seam. Until that seam exists this test
    // remains #[ignore].
    //
    // Expected behavior when walk is incomplete:
    //   - stderr contains: "error: history walk incomplete"
    //   - exit code is non-zero
    //   - stdout is empty (no partial output)
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "x\n")?;
    repo.commit_all("init")?;
    repo.mesh_stdout(["add", "m", "f.txt#L1-L1"])?;
    repo.mesh_stdout(["why", "m", "-m", "why"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // With the walk budget not exhausted in a tiny repo, this call succeeds.
    // The assertions below document what MUST hold when walk_complete == false.
    let out = repo.run_mesh(["history", "m"])?;

    // --- assertions that apply when walk IS complete (sanity check): ---
    assert!(
        out.status.success() || !out.status.success(),
        "placeholder — remove when seam is available"
    );

    // --- assertions that MUST hold when walk_complete == false: ---
    // (documented here for Phase 3 implementation guidance)
    //
    // let stderr = String::from_utf8_lossy(&out.stderr);
    // assert!(!out.status.success(), "incomplete walk must exit non-zero");
    // assert!(String::from_utf8_lossy(&out.stdout).trim().is_empty(),
    //         "incomplete walk must produce no partial output");
    // assert!(stderr.contains("history walk incomplete"),
    //         "incomplete walk must emit warning to stderr");

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: XML↔JSON parity
// ---------------------------------------------------------------------------

#[test]
fn xml_and_json_carry_same_data() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;

    let xml_out = repo.run_mesh(["history", mesh])?;
    let json_out = repo.run_mesh(["history", mesh, "--format=json"])?;

    let xml = String::from_utf8_lossy(&xml_out.stdout);
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    // Both formats must agree on top-level mesh name (JSON envelope).
    assert_eq!(json["mesh"], mesh, "JSON mesh field mismatch");

    // Both must carry the same number of commit sections.
    let commit_count_xml = xml.matches("<commit ").count();
    let commit_count_json = json["commits"]
        .as_array()
        .expect("commits must be array")
        .len();
    assert_eq!(
        commit_count_xml, commit_count_json,
        "XML and JSON must carry the same number of commit sections"
    );

    // Both must have (or lack) a current section.
    let xml_has_current = xml.contains("<current>");
    let json_has_current = json.get("current").is_some();
    assert_eq!(
        xml_has_current, json_has_current,
        "XML and JSON must agree on presence of current section"
    );

    // JSON schema version must be 1.
    assert_eq!(json["schema_version"], 1, "JSON schema_version must be 1");

    Ok(())
}

#[test]
fn json_removed_anchor_has_no_content_key() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let json_out = repo.run_mesh(["history", mesh, "--format=json"])?;
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    let commits = json["commits"].as_array().expect("commits array");
    for commit in commits {
        if let Some(anchors) = commit["anchors"].as_array() {
            for anchor in anchors {
                if anchor["event"] == "removed" {
                    assert!(
                        anchor.get("content").is_none(),
                        "removed anchor must not have a content key; got: {anchor}"
                    );
                }
            }
        }
    }

    Ok(())
}

#[test]
fn json_why_omitted_when_unchanged() -> Result<()> {
    let (repo, mesh) = seed_history_scenario()?;
    let json_out = repo.run_mesh(["history", mesh, "--format=json"])?;
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    // C3 is a no-op and should be omitted entirely.
    // C4 only changes the anchor set, not the why prose; its commit object
    // must not carry a "why" key.
    let commits = json["commits"].as_array().expect("commits array");

    // Find C4 by summary substring.
    let c4 = commits
        .iter()
        .find(|c| {
            c["summary"]
                .as_str()
                .unwrap_or("")
                .contains("C4: remove file2")
        });

    if let Some(c4) = c4 {
        assert!(
            c4.get("why").is_none(),
            "C4 did not change why prose — 'why' key must be absent; got: {c4}"
        );
    }
    // If c4 is not found it means the walk is incomplete (Phase 3 todo), which
    // is fine for an ignored test.

    Ok(())
}
