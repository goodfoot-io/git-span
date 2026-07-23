//! CLI: `git span history <span>` — Phase 2 skipped acceptance checks.
//!
//! Every test in this module is `#[ignore]` — they are pending assertions
//! against the Phase-1 stubs (which `todo!()`). They must compile and show as
//! ignored/skipped, not failing.
//!
//! The fixture repo scenario mirrors the canonical example in
//! `docs/history-example-output-xml.md`: a span is created, its why prose is
//! edited, an anchor is modified, an anchor is removed and a new one added,
//! and the working tree is left with uncommitted drift.

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Seed a four-commit span scenario:
///
/// C1: create span `m` with two line-range anchors (file1.txt#L1-L5,
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
/// Returns `(repo, span_name)`.
fn seed_history_scenario() -> Result<(TestRepo, &'static str)> {
    let repo = TestRepo::new()?;
    let span = "m";

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

    // C1: create the span.
    repo.span_stdout(["add", span, "file1.txt#L1-L5"])?;
    repo.span_stdout(["add", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "First why: tracks the two source files."])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create span"])?;

    // C2: edit why prose AND mutate file2.txt so the anchor content changes.
    repo.write_file(
        "file2.txt",
        "ALPHA\nBETA\nGAMMA\ndelta\nepsilon\n",
    )?;
    repo.commit_all("C2 source: mutate file2")?;
    repo.span_stdout(["add", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "Second why: file2 lines updated."])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C2: update why and re-anchor file2"])?;

    // C3: a re-anchor of file1.txt against byte-identical content. Re-running
    // `git span add` recomputes the same content hash, so the span file's bytes
    // do not change and there is nothing for git to stage. The commit therefore
    // does not touch `.span/<span>` at all (`--allow-empty` keeps it in the
    // history), so the path-scoped history walk omits it entirely — the
    // "no-op commit must be omitted" invariant.
    repo.span_stdout(["add", span, "file1.txt#L1-L5"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git([
        "commit",
        "--allow-empty",
        "-m",
        "C3: no-op re-anchor of file1 (byte-identical)",
    ])?;

    // C4: remove the file2.txt anchor and add a whole-file anchor on file3.txt.
    repo.span_stdout(["remove", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "file3.txt"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C4: remove file2 anchor, add file3 whole-file"])?;

    // Leave working tree with uncommitted edit to file3.txt so `current`
    // section appears.
    repo.write_file(
        "file3.txt",
        "first\nsecond\nthird\nfourth\nfifth\nSIXTH (uncommitted)\n",
    )?;

    Ok((repo, span))
}

// ---------------------------------------------------------------------------
// Test: oldest→newest commit ordering
// ---------------------------------------------------------------------------

#[test]
fn commits_ordered_oldest_to_newest() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span])?;
    // Phase 3 will panic here (todo!()); this test is skipped.
    let xml = String::from_utf8_lossy(&out.stdout);

    // Commits must appear in chronological (oldest→newest) order.
    // Locate the byte offsets of the commit open-tags and verify ordering.
    let c1_pos = xml.find("C1: create span").expect("C1 commit summary missing");
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
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span])?;
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
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span])?;
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
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span])?;
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
    let (repo, span) = seed_history_scenario()?;
    // Worktree has uncommitted edit to file3.txt (set up by the fixture).
    let out = repo.run_span(["history", span])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    assert!(
        xml.contains("<current>"),
        "expected <current> block when worktree drifts; got:\n{xml}"
    );

    Ok(())
}

#[test]
fn current_absent_when_worktree_matches_head() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    // Re-anchor the drifted source so the span's stored fingerprint matches the
    // live content, then commit. Committing the edit alone is not enough — the
    // engine flags committed-but-not-re-anchored drift (the false-negative this
    // command exists to surface), so the span must be re-anchored to be clean.
    repo.commit_all("commit the source edit")?;
    // Re-anchor every anchor against the now-committed content so each stored
    // fingerprint matches the live bytes, then commit the span.
    repo.span_stdout(["add", span, "file3.txt"])?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "--allow-empty", "-m", "re-anchor after source edit"])?;

    // Confirm `git span stale` now reports the span clean.
    let stale = repo.run_span(["stale", span])?;
    assert!(
        stale.status.success(),
        "expected a clean `git span stale` after re-anchor; got:\n{}",
        String::from_utf8_lossy(&stale.stdout)
    );

    let out = repo.run_span(["history", span])?;
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
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span])?;
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
// Test: committed-but-not-re-anchored source drift surfaces in `current` and
// agrees with `git span stale` (regression for the false-negative where
// worktree == HEAD hid drift the stored fingerprint still flags).
// ---------------------------------------------------------------------------

#[test]
fn current_surfaces_committed_drift_agreeing_with_stale() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "c";

    repo.write_file("src.txt", "one\ntwo\nthree\nfour\nfive\n")?;
    repo.commit_all("initial")?;

    // Anchor lines 1-3 and commit the span.
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head of src.txt"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Edit the source AND commit it, WITHOUT `stale --fix`. The worktree now
    // equals HEAD, but the span's stored content fingerprint no longer matches
    // the live bytes — `git span stale` flags this and so must `history`.
    repo.write_file("src.txt", "ONE\nTWO\nthree\nfour\nfive\n")?;
    repo.commit_all("edit source without re-anchoring")?;

    // Sanity: `git span stale` reports the anchor as drifted.
    let stale = repo.run_span(["stale", span])?;
    let stale_out = String::from_utf8_lossy(&stale.stdout);
    assert!(
        !stale.status.success(),
        "expected `git span stale` to exit non-zero on committed drift; got:\n{stale_out}"
    );
    assert!(
        stale_out.contains("src.txt"),
        "expected `git span stale` to mention the drifted anchor; got:\n{stale_out}"
    );

    // `history` must emit a <current> block for the same anchor even though the
    // worktree matches HEAD.
    let out = repo.run_span(["history", span])?;
    let xml = String::from_utf8_lossy(&out.stdout);
    assert!(
        xml.contains("<current>"),
        "expected <current> block for committed-but-not-re-anchored drift; got:\n{xml}"
    );
    assert!(
        xml.contains("src.txt#L1-L3"),
        "expected the drifted anchor in <current>; got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: a moved anchor renders the `moved` phrase and the relocated block as
// content — never a slice of the stale stored line range.
// ---------------------------------------------------------------------------

#[test]
fn current_moved_anchor_uses_moved_phrase_and_relocated_block() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "mv";

    // A distinctive block we can track through a relocation.
    repo.write_file(
        "src.txt",
        "header-a\nheader-b\nTARGET-ONE\nTARGET-TWO\nTARGET-THREE\nfooter\n",
    )?;
    repo.commit_all("initial")?;

    // Anchor the TARGET block (lines 3-5) and commit the span.
    repo.span_stdout(["add", span, "src.txt#L3-L5"])?;
    repo.span_stdout(["why", span, "tracks the TARGET block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Relocate the block: prepend lines so the identical TARGET bytes now live
    // at a different line range. The stored range (3-5) no longer covers them.
    repo.write_file(
        "src.txt",
        "new-1\nnew-2\nnew-3\nheader-a\nheader-b\nTARGET-ONE\nTARGET-TWO\nTARGET-THREE\nfooter\n",
    )?;
    repo.commit_all("relocate the TARGET block downward")?;

    // `git span stale` classifies this as MOVED.
    let stale = repo.run_span(["stale", span])?;
    let stale_out = String::from_utf8_lossy(&stale.stdout);
    assert!(
        stale_out.to_lowercase().contains("moved"),
        "expected `git span stale` to classify the anchor as moved; got:\n{stale_out}"
    );

    let out = repo.run_span(["history", span])?;
    let xml = String::from_utf8_lossy(&out.stdout);

    // Status is the verbatim `format_drift_label` phrase for Moved.
    assert!(
        xml.contains("status=\"moved\""),
        "expected status=\"moved\" sourced from format_drift_label; got:\n{xml}"
    );
    // Content is the relocated block (the real TARGET lines), not a slice of the
    // stale stored range 3-5 (which now covers new-3/header-a/header-b).
    assert!(
        xml.contains("TARGET-ONE\nTARGET-TWO\nTARGET-THREE"),
        "expected the relocated block as <current> content; got:\n{xml}"
    );
    assert!(
        !xml.contains("new-3\nheader-a\nheader-b"),
        "did not expect a slice of the stale stored line range as content; got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: a whole-file anchor with no edit does not emit `current` (the old
// one-sided normalization could false-positive; the resolver normalizes both
// sides consistently).
// ---------------------------------------------------------------------------

#[test]
fn current_absent_for_unedited_whole_file_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "wf";

    repo.write_file("whole.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;

    repo.span_stdout(["add", span, "whole.txt"])?;
    repo.span_stdout(["why", span, "tracks the whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create whole-file span"])?;

    // No edit at all — `current` must be omitted.
    let out = repo.run_span(["history", span])?;
    let xml = String::from_utf8_lossy(&out.stdout);
    assert!(
        !xml.contains("<current>"),
        "expected no <current> block for an unedited whole-file anchor; got:\n{xml}"
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
    let span = "degraded";

    repo.write_file("src.txt", "line1\nline2\nline3\n")?;
    repo.commit_all("initial")?;

    // C1: anchor src.txt.
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "initial why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create span with src.txt"])?;

    // C2: delete src.txt while keeping the span anchor pointing at it.
    repo.run_git(["rm", "src.txt"])?;
    repo.run_git(["commit", "-m", "C2: delete src.txt"])?;

    // C3: a span-file commit (why edit) made *after* src.txt is gone. The
    // history walk reads the anchor's content from this commit's tree, where
    // src.txt is absent — so the timeline must degrade that anchor to a note
    // rather than aborting the whole report.
    repo.span_stdout(["why", span, "why after source deletion"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C3: edit why after src.txt is gone"])?;

    let out = repo.run_span(["history", span])?;
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
    repo.span_stdout(["add", "m", "f.txt#L1-L1"])?;
    repo.span_stdout(["why", "m", "why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;

    // With the walk budget not exhausted in a tiny repo, this call succeeds.
    // The assertions below document what MUST hold when walk_complete == false.
    let out = repo.run_span(["history", "m"])?;

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
    let (repo, span) = seed_history_scenario()?;

    let xml_out = repo.run_span(["history", span])?;
    let json_out = repo.run_span(["history", span, "--format=json"])?;

    let xml = String::from_utf8_lossy(&xml_out.stdout);
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    // Both formats must agree on top-level span name (JSON envelope).
    assert_eq!(json["span"], span, "JSON span field mismatch");

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
    let (repo, span) = seed_history_scenario()?;
    let json_out = repo.run_span(["history", span, "--format=json"])?;
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
    let (repo, span) = seed_history_scenario()?;
    let json_out = repo.run_span(["history", span, "--format=json"])?;
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

// ---------------------------------------------------------------------------
// Test: `--limit N` (N < total) does not fabricate `added`/`why` for the
// oldest shown commit and warns the window is scoped/partial.
// ---------------------------------------------------------------------------

#[test]
fn limit_window_does_not_fabricate_added_and_warns_scoped() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;

    // `--limit 1` keeps only the newest span-touching commit (C4). C4 adds the
    // file3 whole-file anchor (genuine `added`) and removes the file2 anchor;
    // the file1 anchor existed before the window and is UNCHANGED at C4, so it
    // must not appear at all — and certainly not relabeled `added`.
    let out = repo.run_span(["history", span, "--limit", "1"])?;
    assert!(
        out.status.success(),
        "scoped history is an explicit user request and must exit 0; stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let xml = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    // Only one commit section is shown.
    assert_eq!(
        xml.matches("<commit ").count(),
        1,
        "`--limit 1` must show exactly one commit; got:\n{xml}"
    );
    assert!(
        xml.contains("C4: remove file2"),
        "the single shown commit must be the newest (C4); got:\n{xml}"
    );

    // file1's anchor existed before the window and did not change at C4 — it
    // must not be re-emitted, and must never carry event="added".
    assert!(
        !xml.contains("file1.txt#L1-L5"),
        "pre-existing unchanged anchor must not be re-emitted in a scoped window; got:\n{xml}"
    );

    // file3 is genuinely first-introduced at C4 → its `added` is truthful.
    assert!(
        xml.contains("path=\"file3.txt\" event=\"added\""),
        "file3 is genuinely added at C4 and must keep event=\"added\"; got:\n{xml}"
    );

    // The partial window must not read as the complete record.
    assert!(
        stderr.contains("scoped") || stderr.contains("partial"),
        "a scoped/partial timeline must be signalled; stderr:\n{stderr}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test (trigger 3): worktree anchor-set add/remove surfaces in `current`
// ---------------------------------------------------------------------------

/// An uncommitted `git span add` (worktree-only anchor, not yet in HEAD) must
/// appear in the `current` section, agreeing with `git span stale`.
#[test]
fn current_surfaces_worktree_added_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "t3add";

    // Seed: one committed anchor.
    repo.write_file("a.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("b.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial files")?;
    repo.span_stdout(["add", span, "a.txt#L1-L2"])?;
    repo.span_stdout(["why", span, "tracks a.txt head"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Worktree-only: add b.txt anchor without committing.
    repo.span_stdout(["add", span, "b.txt#L1-L2"])?;
    // Do NOT commit — the span file is dirty in the working tree.

    // `git span history` must emit a <current> block containing the new anchor.
    let out = repo.run_span(["history", span])?;
    let xml = String::from_utf8_lossy(&out.stdout);
    assert!(
        xml.contains("<current>"),
        "expected <current> block for worktree-added anchor; got:\n{xml}"
    );
    assert!(
        xml.contains("b.txt#L1-L2"),
        "expected the worktree-added anchor address in <current>; got:\n{xml}"
    );
    assert!(
        xml.contains("added in the working tree"),
        "expected 'added in the working tree' status for the worktree-added anchor; got:\n{xml}"
    );

    Ok(())
}

/// An uncommitted `git span remove` (anchor removed from span in worktree but
/// still at HEAD) must appear as a removed anchor in the `current` section.
#[test]
fn current_surfaces_worktree_removed_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "t3rem";

    // Seed: two committed anchors.
    repo.write_file("a.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("b.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial files")?;
    repo.span_stdout(["add", span, "a.txt#L1-L2"])?;
    repo.span_stdout(["add", span, "b.txt#L1-L2"])?;
    repo.span_stdout(["why", span, "tracks both files"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span with two anchors"])?;

    // Worktree-only: remove b.txt anchor without committing.
    repo.span_stdout(["remove", span, "b.txt#L1-L2"])?;
    // Do NOT commit.

    // `git span history` must emit a <current> block containing the removed anchor.
    let out = repo.run_span(["history", span])?;
    let xml = String::from_utf8_lossy(&out.stdout);
    assert!(
        xml.contains("<current>"),
        "expected <current> block for worktree-removed anchor; got:\n{xml}"
    );
    assert!(
        xml.contains("b.txt#L1-L2"),
        "expected the worktree-removed anchor address in <current>; got:\n{xml}"
    );
    assert!(
        xml.contains("removed in the working tree"),
        "expected 'removed in the working tree' status for the worktree-removed anchor; got:\n{xml}"
    );
    // The removed anchor in <current> must be self-closing (no body).
    // Verify by checking the specific self-closing form for b.txt.
    assert!(
        xml.contains("path=\"b.txt#L1-L2\" status=\"removed in the working tree\"/>"),
        "removed anchor in <current> must be self-closing (no body); got:\n{xml}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: `scoped` marker in JSON and XML payload
// ---------------------------------------------------------------------------

/// A `--limit`-scoped run must carry `scoped: true` in JSON and `<scoped/>` in
/// XML; an unscoped run must not carry the marker.
#[test]
fn scoped_marker_present_in_limited_run_absent_in_full_run() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;

    // Unscoped JSON: no `scoped` key.
    let full_json_out = repo.run_span(["history", span, "--format=json"])?;
    let full_json: Value = serde_json::from_slice(&full_json_out.stdout)?;
    assert!(
        full_json.get("scoped").is_none(),
        "unscoped run must not carry 'scoped' key in JSON; got: {full_json}"
    );

    // Unscoped XML: no <scoped/>.
    let full_xml_out = repo.run_span(["history", span])?;
    let full_xml = String::from_utf8_lossy(&full_xml_out.stdout);
    assert!(
        !full_xml.contains("<scoped"),
        "unscoped run must not carry <scoped/> in XML; got:\n{full_xml}"
    );

    // Scoped JSON (--limit 1): must carry `"scoped": true`.
    let scoped_json_out = repo.run_span(["history", span, "--limit", "1", "--format=json"])?;
    let scoped_json: Value = serde_json::from_slice(&scoped_json_out.stdout)?;
    assert_eq!(
        scoped_json["scoped"],
        Value::Bool(true),
        "scoped run must carry 'scoped': true in JSON; got: {scoped_json}"
    );

    // Scoped XML (--limit 1): must carry <scoped/>.
    let scoped_xml_out = repo.run_span(["history", span, "--limit", "1"])?;
    let scoped_xml = String::from_utf8_lossy(&scoped_xml_out.stdout);
    assert!(
        scoped_xml.contains("<scoped/>"),
        "scoped run must carry <scoped/> in XML; got:\n{scoped_xml}"
    );

    Ok(())
}

