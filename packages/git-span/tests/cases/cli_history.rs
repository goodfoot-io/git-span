//! CLI: `git span history <span>` — the v2 output contract.
//!
//! Two formats: git-log-style text (the default) and `schema_version: 2` JSON
//! carrying the identical raw patch strings. Both are newest-first, and every
//! observable change is a unified diff in git's dialect — declaration edits as
//! real blob diffs (`span_diff`), anchor changes as pseudo-diffs between
//! extracted snapshots.

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Run `git span history` and return stdout as text, asserting exit 0.
fn history_text(repo: &TestRepo, span: &str) -> Result<String> {
    let out = repo.run_span(["history", span])?;
    anyhow::ensure!(
        out.status.success(),
        "history failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Run `git span history --format=json` and parse stdout.
fn history_json(repo: &TestRepo, span: &str) -> Result<Value> {
    let out = repo.run_span(["history", span, "--format=json"])?;
    anyhow::ensure!(
        out.status.success(),
        "history --format=json failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(serde_json::from_slice(&out.stdout)?)
}

/// Find the commit object whose `summary` contains `needle`.
fn commit_with<'a>(json: &'a Value, needle: &str) -> &'a Value {
    json["commits"]
        .as_array()
        .expect("commits must be an array")
        .iter()
        .find(|c| c["summary"].as_str().unwrap_or("").contains(needle))
        .unwrap_or_else(|| panic!("no commit whose summary contains {needle:?} in {json:#}"))
}

/// Index of the commit whose `summary` contains `needle`.
fn commit_index(json: &Value, needle: &str) -> usize {
    json["commits"]
        .as_array()
        .expect("commits must be an array")
        .iter()
        .position(|c| c["summary"].as_str().unwrap_or("").contains(needle))
        .unwrap_or_else(|| panic!("no commit whose summary contains {needle:?} in {json:#}"))
}

/// The text block of `out` that renders the diff whose `diff --git` header
/// contains `needle`, up to the next blank-line-separated block.
fn diff_block<'a>(out: &'a str, needle: &str) -> &'a str {
    let start = out
        .match_indices("diff --git ")
        .find(|(i, _)| {
            let line_end = out[*i..].find('\n').map(|n| i + n).unwrap_or(out.len());
            out[*i..line_end].contains(needle)
        })
        .map(|(i, _)| i)
        .unwrap_or_else(|| panic!("no `diff --git` header containing {needle:?} in:\n{out}"));
    let rest = &out[start..];
    match rest.find("\n\n") {
        Some(end) => &rest[..end + 1],
        None => rest,
    }
}

/// Seed the swap scenario: two anchors whose contents exchange addresses in
/// one commit, with the declaration left untouched. Both anchors end up
/// relocated, each onto the address the other declared.
fn swap_repo() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    let span = "swap";

    repo.write_file(
        "src.txt",
        "AAA-1\nAAA-2\nAAA-3\nmiddle\nBBB-1\nBBB-2\nBBB-3\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "src.txt#L5-L7"])?;
    repo.span_stdout(["why", span, "tracks both blocks"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Exchange the two blocks. Pairing by exact address first would hand each
    // anchor the wrong partner and fabricate two total rewrites for what are
    // two pure moves.
    repo.write_file(
        "src.txt",
        "BBB-1\nBBB-2\nBBB-3\nmiddle\nAAA-1\nAAA-2\nAAA-3\n",
    )?;
    repo.commit_all("swap the two blocks")?;
    Ok(repo)
}

/// Seed the main timeline scenario for span `m`:
///
/// * `C0` — three source files.
/// * `C1` — create the span with `file1.txt#L1-L5` and `file2.txt#L1-L3`.
/// * `C2` — edit `file2.txt`'s anchored lines **without touching the
///   declaration** (the walk-expansion case: today's declaration-only walk
///   would fold this change into the next span commit).
/// * `C3` — a why-prose edit alone (declaration diff, no anchor change).
/// * `C4` — edit `file1.txt` *outside* every declared range: the commit
///   qualifies for the walk but changes nothing observable, so it is dropped.
/// * `C5` — remove the `file2.txt` anchor and add a whole-file `file3.txt`
///   anchor.
///
/// The working tree is left with `file3.txt` edited (uncommitted drift) and a
/// declaration that matches HEAD.
fn seed_history_scenario() -> Result<(TestRepo, &'static str)> {
    let repo = TestRepo::new()?;
    let span = "m";

    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.write_file("file2.txt", "alpha\nbeta\ngamma\ndelta\nepsilon\n")?;
    repo.write_file("file3.txt", "first\nsecond\nthird\nfourth\nfifth\n")?;
    repo.commit_all("C0: initial files")?;

    // C1: create the span.
    repo.span_stdout(["add", span, "file1.txt#L1-L5"])?;
    repo.span_stdout(["add", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "First why: tracks the two source files."])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create span"])?;

    // C2: anchored content changes with the declaration untouched.
    repo.write_file("file2.txt", "ALPHA\nBETA\ngamma\ndelta\nepsilon\n")?;
    repo.commit_all("C2: edit file2 content only")?;

    // C3: why prose only.
    repo.span_stdout(["why", span, "Second why: prose alone changed."])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C3: edit why prose only"])?;

    // C4: an anchored file changes outside every declared range.
    repo.write_file(
        "file1.txt",
        "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nLINE9\nline10\n",
    )?;
    repo.commit_all("C4: touch file1 outside the anchored range")?;

    // C5: drop one anchor, add a whole-file anchor.
    repo.span_stdout(["remove", span, "file2.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "file3.txt"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git([
        "commit",
        "-m",
        "C5: remove file2 anchor, add file3 whole-file",
    ])?;

    // Uncommitted source drift so the `current` section appears.
    repo.write_file(
        "file3.txt",
        "first\nsecond\nthird\nfourth\nfifth\nSIXTH (uncommitted)\n",
    )?;

    Ok((repo, span))
}

// ---------------------------------------------------------------------------
// Format surface
// ---------------------------------------------------------------------------

#[test]
fn xml_format_is_rejected_by_clap() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span, "--format=xml"])?;
    assert!(!out.status.success(), "`--format=xml` must be rejected");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("invalid value 'xml'"),
        "expected a clap value error naming xml; got:\n{stderr}"
    );
    assert!(
        stderr.contains("human") && stderr.contains("json"),
        "expected human/json to be the only accepted values; got:\n{stderr}"
    );
    Ok(())
}

#[test]
fn default_format_is_git_log_style_text() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    assert!(
        out.lines()
            .any(|l| l.starts_with("commit ") && l.len() == "commit ".len() + 40),
        "expected `commit <40-hex>` entry headers; got:\n{out}"
    );
    assert!(
        out.contains("\nDate:   "),
        "expected git's `Date:   ` header line; got:\n{out}"
    );
    assert!(
        out.contains("\n    C5: remove file2 anchor"),
        "expected four-space-indented commit summaries; got:\n{out}"
    );
    // No XML remnants anywhere.
    assert!(
        !out.contains("<commit ") && !out.contains("<current>") && !out.contains("event="),
        "XML dialect must be gone; got:\n{out}"
    );
    Ok(())
}

#[test]
fn json_is_schema_version_2_without_event_or_why() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;

    assert_eq!(json["schema_version"], 2, "schema_version must be 2");
    assert_eq!(json["span"], span);

    let raw = serde_json::to_string(&json)?;
    assert!(
        !raw.contains("\"event\""),
        "the `event` field must be gone; got: {raw}"
    );
    assert!(
        !raw.contains("\"why\""),
        "the per-commit `why` field must be gone; got: {raw}"
    );
    assert!(
        !raw.contains("\"status\""),
        "the current-anchor `status` string must be gone; got: {raw}"
    );
    Ok(())
}

#[test]
fn both_formats_are_newest_first_and_agree_on_commit_count() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;
    let json = history_json(&repo, span)?;

    // Text: newest commit's summary appears before the oldest.
    let c5 = out.find("C5: remove file2").expect("C5 missing from text");
    let c3 = out.find("C3: edit why prose").expect("C3 missing from text");
    let c1 = out.find("C1: create span").expect("C1 missing from text");
    assert!(c5 < c3 && c3 < c1, "text output must be newest-first:\n{out}");

    // JSON: same ordering.
    assert!(
        commit_index(&json, "C5: remove file2") < commit_index(&json, "C3: edit why prose"),
        "JSON commits must be newest-first: {json:#}"
    );

    let text_commits = out
        .lines()
        .filter(|l| l.starts_with("commit ") && l.len() == "commit ".len() + 40)
        .count();
    assert_eq!(
        text_commits,
        json["commits"].as_array().expect("commits array").len(),
        "both formats must carry the same commit sections"
    );
    Ok(())
}

#[test]
fn json_date_is_a_full_iso8601_timestamp() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;
    let date = commit_with(&json, "C5: remove file2")["date"]
        .as_str()
        .expect("date must be a string")
        .to_string();

    chrono::DateTime::parse_from_rfc3339(&date)
        .unwrap_or_else(|e| panic!("`date` must be ISO-8601 with offset, got {date:?}: {e}"));
    Ok(())
}

// ---------------------------------------------------------------------------
// Timeline: adds, edits, re-anchors, removals
// ---------------------------------------------------------------------------

#[test]
fn first_add_renders_addition_diff_and_json_content() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;
    let block = diff_block(&out, "b/file1.txt#L1-L5");

    assert!(
        block.contains("new anchor\n"),
        "a first-add renders git's addition conventions; got:\n{block}"
    );
    assert!(
        block.contains("index 0000000000000000..rk64:"),
        "a first-add's old side is the null hash; got:\n{block}"
    );
    assert!(
        block.contains("--- /dev/null\n") && block.contains("@@ -0,0 +1,5 @@\n"),
        "a first-add's hunk header uses real new-file coordinates; got:\n{block}"
    );
    assert!(
        block.contains("+line1\n+line2\n"),
        "a first-add carries the full addition body; got:\n{block}"
    );

    // JSON carries the snapshot as `content` and no `diff` for a first-add.
    let json = history_json(&repo, span)?;
    let c1 = commit_with(&json, "C1: create span");
    let anchor = c1["anchors"]
        .as_array()
        .expect("anchors array")
        .iter()
        .find(|a| a["path"] == "file1.txt#L1-L5")
        .expect("file1 anchor missing from C1");
    assert_eq!(
        anchor["content"], "line1\nline2\nline3\nline4\nline5\n",
        "a first-add carries `content`; got: {anchor}"
    );
    assert!(
        anchor.get("diff").is_none(),
        "a first-add carries exactly one of diff/content; got: {anchor}"
    );
    Ok(())
}

#[test]
fn content_edit_without_declaration_change_is_its_own_entry() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;
    let c2 = commit_with(&json, "C2: edit file2 content only");

    assert!(
        c2.get("span_diff").is_none(),
        "C2 never touched the declaration; got: {c2}"
    );
    let anchors = c2["anchors"].as_array().expect("anchors array");
    assert_eq!(anchors.len(), 1, "only file2's anchor changed; got: {c2}");
    assert_eq!(anchors[0]["path"], "file2.txt#L1-L3");

    let diff = anchors[0]["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("-alpha\n-beta\n+ALPHA\n+BETA\n") && diff.contains("@@ -1,3 +1,3 @@\n"),
        "expected an in-place snapshot diff at real coordinates; got:\n{diff}"
    );
    assert!(
        anchors[0].get("content").is_none(),
        "only first-adds carry content; got: {}",
        anchors[0]
    );
    Ok(())
}

#[test]
fn why_only_edit_emits_span_diff_without_anchor_entries() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;
    let c3 = commit_with(&json, "C3: edit why prose only");

    let span_diff = c3["span_diff"].as_str().expect("span_diff missing from C3");
    assert!(
        span_diff.starts_with("diff --git a/.span/m b/.span/m\nindex "),
        "the declaration diff is a real blob diff; got:\n{span_diff}"
    );
    assert!(
        span_diff.contains("+Second why: prose alone changed."),
        "why prose lives in the declaration diff; got:\n{span_diff}"
    );
    assert_eq!(
        c3["anchors"].as_array().expect("anchors array").len(),
        0,
        "a why-only edit changes no anchor content; got: {c3}"
    );
    Ok(())
}

#[test]
fn noop_qualifying_commit_is_dropped() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;
    assert!(
        !out.contains("C4: touch file1 outside"),
        "a commit that touched an anchored file outside every declared range \
         changes nothing observable and must be dropped; got:\n{out}"
    );
    Ok(())
}

#[test]
fn anchor_removal_renders_dev_null_deletion_body() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;
    let block = diff_block(&out, "a/file2.txt#L1-L3 b/dev/null");

    assert!(
        block.contains("deleted anchor\n"),
        "expected the `deleted anchor` header; got:\n{block}"
    );
    assert!(
        block.contains("..0000000000000000\n") && block.contains("+++ /dev/null\n"),
        "a removal's new side is /dev/null; got:\n{block}"
    );
    assert!(
        block.contains("@@ -1,3 +0,0 @@\n") && block.contains("-ALPHA\n"),
        "a removal carries the full deletion body at real coordinates; got:\n{block}"
    );

    let json = history_json(&repo, span)?;
    let c5 = commit_with(&json, "C5: remove file2");
    let removed = c5["anchors"]
        .as_array()
        .expect("anchors array")
        .iter()
        .find(|a| a["path"] == "file2.txt#L1-L3")
        .expect("removed anchor missing from C5");
    assert!(
        removed["diff"].as_str().unwrap_or("").contains("deleted anchor"),
        "a removal is a diff, never content; got: {removed}"
    );
    assert!(
        removed.get("content").is_none(),
        "a removal has no content key; got: {removed}"
    );
    Ok(())
}

#[test]
fn pure_reanchor_renders_rename_headers_without_hunks() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "mv";

    repo.write_file("src.txt", "TARGET-A\nTARGET-B\nTARGET-C\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the TARGET block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Displace the block downward and re-anchor to its new address in the same
    // commit: the extracted snapshot is byte-identical, only the address moved.
    repo.write_file(
        "src.txt",
        "head-1\nhead-2\nhead-3\nTARGET-A\nTARGET-B\nTARGET-C\n",
    )?;
    repo.span_stdout(["remove", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "src.txt#L4-L6"])?;
    repo.commit_all("re-anchor the TARGET block after displacement")?;

    let out = history_text(&repo, span)?;
    let block = diff_block(&out, "a/src.txt#L1-L3 b/src.txt#L4-L6");

    assert!(
        block.contains("similarity index 100%\n")
            && block.contains("rename from src.txt#L1-L3\n")
            && block.contains("rename to src.txt#L4-L6\n"),
        "a re-anchor pairs with its predecessor as a rename; got:\n{block}"
    );
    assert!(
        !block.contains("@@"),
        "a pure move renders the header block alone, no hunks; got:\n{block}"
    );
    Ok(())
}

#[test]
fn reanchor_with_edit_renders_rename_headers_and_hunks() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "mvx";

    repo.write_file("src.txt", "TARGET-A\nTARGET-B\nTARGET-C\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the TARGET block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    repo.write_file(
        "src.txt",
        "head-1\nhead-2\nhead-3\nTARGET-A\nTARGET-B-CHANGED\nTARGET-C\n",
    )?;
    repo.span_stdout(["remove", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "src.txt#L4-L6"])?;
    repo.commit_all("re-anchor and edit the TARGET block")?;

    let out = history_text(&repo, span)?;
    let block = diff_block(&out, "a/src.txt#L1-L3 b/src.txt#L4-L6");

    assert!(
        block.contains("rename from src.txt#L1-L3\n") && block.contains("similarity index "),
        "an edited re-anchor still pairs as a rename; got:\n{block}"
    );
    assert!(
        !block.contains("similarity index 100%"),
        "similarity must be genuinely computed, not assumed; got:\n{block}"
    );
    assert!(
        block.contains("-TARGET-B\n") && block.contains("+TARGET-B-CHANGED\n"),
        "an edited re-anchor renders hunks as well as headers; got:\n{block}"
    );
    assert!(
        block.contains("@@ -1,3 +4,3 @@\n"),
        "hunk headers use each side's real file coordinates; got:\n{block}"
    );
    Ok(())
}

#[test]
fn unavailable_content_renders_as_a_dev_null_side_never_as_prose() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "degraded";

    repo.write_file("src.txt", "line1\nline2\nline3\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "initial why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span with src.txt"])?;

    // Delete the source while the declaration keeps pointing at it. The
    // content is unavailable — a structural absence, not a note to render.
    repo.run_git(["rm", "src.txt"])?;
    repo.run_git(["commit", "-m", "delete src.txt"])?;

    let out = history_text(&repo, span)?;
    assert!(
        !out.contains("(file absent")
            && !out.contains("(line range past")
            && !out.contains("(binary or non-UTF-8"),
        "unavailability must never be painted as source; got:\n{out}"
    );
    let block = diff_block(&out, "a/src.txt#L1-L3 b/src.txt#L1-L3");
    assert!(
        block.contains("+++ /dev/null\n") && block.contains("@@ -1,3 +0,0 @@\n"),
        "a vanished anchor's new side is a true /dev/null side; got:\n{block}"
    );
    assert!(
        block.contains("-line1\n") && block.contains("-line3\n"),
        "the prior real content is the old side of that diff; got:\n{block}"
    );
    assert!(
        block.contains("..0000000000000000\n"),
        "an unavailable side carries the null hash; got:\n{block}"
    );

    let json = history_json(&repo, span)?;
    let deleted = commit_with(&json, "delete src.txt");
    let anchor = &deleted["anchors"].as_array().expect("anchors array")[0];
    assert_eq!(
        anchor["unavailable"], "absent",
        "unavailability is a status field, not prose; got: {anchor}"
    );
    assert!(
        anchor.get("content").is_none(),
        "an unavailable anchor never carries fabricated content; got: {anchor}"
    );
    Ok(())
}

#[test]
fn unrelated_unavailable_anchors_do_not_pair_as_a_rename() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "gone";

    repo.write_file("a.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("b.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "a.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "b.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks both heads"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Both sources vanish in one commit. Two independent absences are not
    // "the same content", so they must render as two independent losses.
    repo.run_git(["rm", "a.txt", "b.txt"])?;
    repo.run_git(["commit", "-m", "delete both sources"])?;

    let out = history_text(&repo, span)?;
    assert!(
        !out.contains("rename from") && !out.contains("similarity index"),
        "two unrelated unavailable anchors must not pair as a rename; got:\n{out}"
    );
    let json = history_json(&repo, span)?;
    let deleted = commit_with(&json, "delete both sources");
    let anchors = deleted["anchors"].as_array().expect("anchors array");
    assert_eq!(anchors.len(), 2, "both losses are reported; got: {deleted}");
    Ok(())
}

#[test]
fn anchors_that_swap_addresses_render_as_two_renames() -> Result<()> {
    let repo = swap_repo()?;
    let json = history_json(&repo, "swap")?;
    let swap = commit_with(&json, "swap the two blocks");
    let anchors = swap["anchors"].as_array().expect("anchors array");
    assert_eq!(anchors.len(), 2, "both blocks moved; got: {swap}");

    let out = history_text(&repo, "swap")?;
    // Per anchor, not across the pair: a joined "both mirror strings appear"
    // check is symmetric-blind and passes even when the two anchors received
    // each other's direction.
    for anchor in anchors {
        let path = anchor["path"].as_str().expect("path string");
        let diff = anchor["diff"].as_str().expect("diff string");
        let source = match path {
            "src.txt#L1-L3" => "src.txt#L5-L7",
            "src.txt#L5-L7" => "src.txt#L1-L3",
            other => panic!("unexpected address {other:?} in: {swap}"),
        };
        assert!(
            diff.contains(&format!("rename from {source}\nrename to {path}\n")),
            "this anchor's content came from {source}; got:\n{diff}"
        );
        assert!(
            diff.contains("similarity index 100%\n"),
            "each anchor pairs with its own content, byte for byte; got:\n{diff}"
        );
        assert!(
            !diff.contains("@@"),
            "a pure move carries no hunks; got:\n{diff}"
        );
        assert!(out.contains(diff), "the default output carries it too:\n{out}");
    }
    Ok(())
}

#[test]
fn swapped_anchors_render_as_proposals_in_the_current_block() -> Result<()> {
    let repo = swap_repo()?;
    // `stale` exits non-zero while anchors are stale, so read stdout directly.
    let stale = String::from_utf8_lossy(&repo.run_span(["stale"])?.stdout).into_owned();
    // `stale` is the authority on where each anchor's content went. The
    // current block must repeat that instruction, never invert it, and never
    // dress it up as a move that already happened.
    assert!(
        stale.contains("src.txt#L1-L3 — moved to src.txt#L5-L7")
            && stale.contains("src.txt#L5-L7 — moved to src.txt#L1-L3"),
        "fixture assumption: stale proposes the mirrored relocations; got:\n{stale}"
    );

    let json = history_json(&repo, "swap")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 2, "both anchors are stale; got: {json:#}");

    let out = history_text(&repo, "swap")?;
    for anchor in anchors {
        let path = anchor["path"].as_str().expect("path string");
        let proposed = anchor["proposed"].as_str().unwrap_or_else(|| {
            panic!("a relocated anchor carries the resolver's proposal; got: {anchor:#}")
        });
        // Direction is per anchor: the declared address is the `from` side of
        // stale's line, the proposal is its `to` side.
        assert!(
            stale.contains(&format!("{path} — moved to {proposed}")),
            "the proposal must point where stale points; got:\n{stale}"
        );
        let diff = anchor["diff"].as_str().expect("diff string");
        assert!(
            diff.contains(&format!("proposed anchor {proposed}\n")),
            "a relocation is a suggestion, not a completed move; got:\n{diff}"
        );
        assert!(
            !diff.contains("rename from") && !diff.contains("rename to"),
            "nothing was re-anchored: the declaration still says {path}; got:\n{diff}"
        );
        assert!(
            diff.contains(&format!("diff --git a/{path} b/{path}\n")),
            "both sides wear the declared address; got:\n{diff}"
        );
        assert!(
            !diff.contains("@@"),
            "the recorded bytes and the proposal's bytes are identical, so the \
             block is header-only; got:\n{diff}"
        );
        assert!(out.contains(diff), "the default output carries it too:\n{out}");
    }
    Ok(())
}

/// Every `rk64` token the declaration records, read from the worktree file and
/// from HEAD's copy of it — an uncommitted re-anchor moves a token from one to
/// the other, and both states are "recorded" for oracle purposes.
fn recorded_tokens(repo: &TestRepo, span: &str) -> Result<Vec<String>> {
    let rel = format!(".span/{span}");
    let worktree = std::fs::read_to_string(repo.path().join(&rel)).unwrap_or_default();
    let head = repo
        .git_stdout(["show", &format!("HEAD:{rel}")])
        .unwrap_or_default();
    Ok([worktree, head]
        .iter()
        .flat_map(|text| {
            text.lines()
                .filter_map(|line| line.split_once("rk64:"))
                .map(|(_, rest)| {
                    rest.split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .collect())
}

/// The old-side hash of every `index rk64:<old>..rk64:<new>` line in `diff`.
fn old_index_hashes(diff: &str) -> Vec<&str> {
    diff.lines()
        .filter_map(|line| line.strip_prefix("index rk64:"))
        .filter_map(|rest| rest.split_once(".."))
        .map(|(old, _)| old)
        .collect()
}

/// The oracle behind the whole current block: whatever content stands as an
/// old side must hash to the token the declaration recorded. It is enforced by
/// construction in `current_old_side`, which can only be checked from outside
/// — an assertion at the construction site would restate the predicate that
/// selected the value. So this re-reads the emitted `index` lines against the
/// declaration itself, across the scenarios that exercise every arm: a
/// proposal, an in-place edit, an uncommitted re-anchor, and content the
/// recorded snapshot can no longer supply.
#[test]
fn current_old_sides_carry_the_declarations_recorded_token() -> Result<()> {
    let mut scenarios: Vec<(&str, TestRepo, &str)> = vec![("swap", swap_repo()?, "swap")];

    let drift = TestRepo::new()?;
    drift.write_file("src.txt", "alpha\nbeta\ngamma\n")?;
    drift.commit_all("initial")?;
    drift.span_stdout(["add", "drift", "src.txt#L1-L3"])?;
    drift.span_stdout(["why", "drift", "tracks the block"])?;
    drift.run_git(["add", ".span"])?;
    drift.run_git(["commit", "-m", "create span"])?;
    drift.write_file("src.txt", "alpha\nBETA-CHANGED\ngamma\n")?;
    scenarios.push(("in-place drift", drift, "drift"));

    let reanchor = TestRepo::new()?;
    reanchor.write_file("src.txt", "TARGET-A\nTARGET-B\nTARGET-C\n")?;
    reanchor.commit_all("initial")?;
    reanchor.span_stdout(["add", "reanchor", "src.txt#L1-L3"])?;
    reanchor.span_stdout(["why", "reanchor", "tracks the TARGET block"])?;
    reanchor.run_git(["add", ".span"])?;
    reanchor.run_git(["commit", "-m", "create span"])?;
    reanchor.write_file("src.txt", "head-1\nhead-2\nhead-3\nTARGET-A\nTARGET-B\nTARGET-C\n")?;
    reanchor.span_stdout(["remove", "reanchor", "src.txt#L1-L3"])?;
    reanchor.span_stdout(["add", "reanchor", "src.txt#L4-L6"])?;
    scenarios.push(("uncommitted re-anchor", reanchor, "reanchor"));

    let truncated = TestRepo::new()?;
    truncated.write_file("src.txt", "one\ntwo\nthree\nfour\nfive\n")?;
    truncated.commit_all("initial")?;
    truncated.span_stdout(["add", "gone", "src.txt#L3-L5"])?;
    truncated.span_stdout(["why", "gone", "tracks the tail"])?;
    truncated.run_git(["add", ".span"])?;
    truncated.run_git(["commit", "-m", "create span"])?;
    truncated.write_file("src.txt", "one\ntwo\n")?;
    scenarios.push(("truncated away", truncated, "gone"));

    for (label, repo, span) in scenarios {
        let tokens = recorded_tokens(&repo, span)?;
        assert!(
            !tokens.is_empty(),
            "{label}: the fixture must record at least one token"
        );
        let json = history_json(&repo, span)?;
        let anchors = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"));
        assert!(
            !anchors.is_empty(),
            "{label}: the scenario must produce a current block to check"
        );
        for anchor in anchors {
            let diff = anchor["diff"].as_str().expect("diff string");
            let hashes = old_index_hashes(diff);
            assert!(
                !hashes.is_empty(),
                "{label}: every anchor diff carries an index line; got:\n{diff}"
            );
            for hash in hashes {
                assert!(
                    tokens.iter().any(|t| t == hash),
                    "{label}: old side rk64:{hash} is not a token the declaration \
                     recorded ({tokens:?}); the old side was fabricated from \
                     content nothing vouches for:\n{diff}"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn ordinary_pairing_is_unaffected_by_the_content_identity_pass() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "twins";

    // Two anchors with byte-identical content at different addresses: the
    // content-identity pass must not cross-pair them when nothing moved.
    repo.write_file("src.txt", "same\nsame\nsame\nmid\nsame\nsame\nsame\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "src.txt#L5-L7"])?;
    repo.span_stdout(["why", span, "tracks two identical blocks"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    repo.write_file("src.txt", "same\nsame\nsame\nmid\nsame\nEDITED\nsame\n")?;
    repo.commit_all("edit the second block")?;

    let out = history_text(&repo, span)?;
    assert!(
        !out.contains("rename from"),
        "nothing moved, so nothing renders as a rename; got:\n{out}"
    );
    let json = history_json(&repo, span)?;
    let edit = commit_with(&json, "edit the second block");
    let anchors = edit["anchors"].as_array().expect("anchors array");
    assert_eq!(anchors.len(), 1, "only the edited block changed; got: {edit}");
    assert_eq!(anchors[0]["path"], "src.txt#L5-L7");
    Ok(())
}

// ---------------------------------------------------------------------------
// `--limit` scoping
// ---------------------------------------------------------------------------

#[test]
fn limit_scopes_the_window_seeds_the_baseline_and_warns() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;

    let out = repo.run_span(["history", span, "--limit", "1", "--format=json"])?;
    assert!(
        out.status.success(),
        "scoped history is an explicit user request and must exit 0; stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("scoped") && stderr.contains("partial"),
        "a scoped window must be signalled on stderr; got:\n{stderr}"
    );

    let json: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(json["scoped"], Value::Bool(true), "expected scoped: true");
    let commits = json["commits"].as_array().expect("commits array");
    assert_eq!(commits.len(), 1, "`--limit 1` shows one commit: {json:#}");
    assert!(
        commits[0]["summary"]
            .as_str()
            .unwrap_or("")
            .contains("C5: remove file2"),
        "the single shown commit must be the newest; got: {}",
        commits[0]
    );

    // The baseline is seeded from real prior state, so file1's unchanged
    // pre-window anchor is neither re-emitted nor relabelled as a first-add.
    // (It still appears as a context line inside the declaration's own diff —
    // that is the declaration's real bytes, not a fabricated anchor entry.)
    let anchors = commits[0]["anchors"].as_array().expect("anchors array");
    assert!(
        anchors.iter().all(|a| a["path"] != "file1.txt#L1-L5"),
        "a pre-existing unchanged anchor must not resurface in a scoped window; got: {anchors:#?}"
    );
    assert!(
        anchors.iter().any(|a| a["path"] == "file3.txt" && a["content"].is_string()),
        "file3 is genuinely first-added at C5 and keeps its content snapshot; got: {anchors:#?}"
    );

    // The unscoped run carries no marker.
    let full = history_json(&repo, span)?;
    assert!(
        full.get("scoped").is_none(),
        "an unscoped run must not carry the flag; got: {full:#}"
    );
    Ok(())
}

#[test]
fn limit_counts_rendered_entries_not_walked_commits() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "narrow";

    std::fs::create_dir_all(repo.path().join("src"))?;
    repo.write_file("src/a.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("C0: initial")?;
    repo.span_stdout(["add", span, "src/a.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create span"])?;

    // Three commits that touch the anchored file *past* the declared range.
    // They qualify for the walk and change nothing observable — a walk-side
    // cap would spend the whole window on them and print nothing at all.
    for n in 1..=3 {
        let mut body = String::from("alpha\nbeta\ngamma\n");
        for k in 1..=n {
            body.push_str(&format!("tail-{k}\n"));
        }
        repo.write_file("src/a.txt", &body)?;
        repo.commit_all(&format!("C{}: append past the anchored range", n + 1))?;
    }

    let unlimited = history_json(&repo, span)?;
    assert_eq!(
        unlimited["commits"].as_array().expect("commits array").len(),
        1,
        "only the declaring commit changed anything observable; got: {unlimited:#}"
    );

    for n in ["1", "3"] {
        let out = repo.run_span(["history", span, "--limit", n])?;
        assert!(out.status.success(), "`--limit {n}` must exit 0");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(
            text.contains("C1: create span"),
            "`--limit {n}` must yield the one entry that exists, not an empty \
             window of no-op commits; got:\n{text}"
        );
    }

    // Nothing was dropped, so nothing is scoped.
    assert!(
        unlimited.get("scoped").is_none(),
        "got: {unlimited:#}"
    );
    let limited: Value =
        serde_json::from_slice(&repo.run_span(["history", span, "--limit", "1", "--format=json"])?.stdout)?;
    assert!(
        limited.get("scoped").is_none(),
        "a window that drops nothing is not scoped; got: {limited:#}"
    );

    // `--limit 0` is an explicitly empty — and explicitly partial — document.
    let zero = repo.run_span(["history", span, "--limit", "0", "--format=json"])?;
    assert!(zero.status.success());
    let zero_json: Value = serde_json::from_slice(&zero.stdout)?;
    assert_eq!(zero_json["scoped"], Value::Bool(true));
    assert_eq!(
        zero_json["commits"].as_array().expect("commits array").len(),
        0
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// The `current` (working tree) section
// ---------------------------------------------------------------------------

#[test]
fn uncommitted_drift_renders_headerless_before_the_first_commit() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    let first_line = out.lines().next().unwrap_or("");
    assert!(
        first_line.starts_with("diff --git a/file3.txt b/file3.txt"),
        "uncommitted drift renders first, with no commit header; got:\n{out}"
    );
    let first_commit = out.find("\ncommit ").expect("no commit entry rendered");
    assert!(
        out[..first_commit].contains("+SIXTH (uncommitted)"),
        "the drift diff must precede every commit entry; got:\n{out}"
    );
    Ok(())
}

#[test]
fn current_anchor_carries_both_diff_and_content() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;

    let current = &json["current"];
    assert!(
        current.get("span_diff").is_none(),
        "the worktree declaration matches HEAD here; got: {current}"
    );
    let anchors = current["anchors"].as_array().expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one anchor drifts; got: {current}");
    assert_eq!(anchors[0]["path"], "file3.txt");
    assert!(
        anchors[0]["diff"]
            .as_str()
            .expect("diff string")
            .contains("+SIXTH (uncommitted)"),
        "the current diff runs from the last recorded snapshot to live content; got: {}",
        anchors[0]
    );
    assert_eq!(
        anchors[0]["content"],
        "first\nsecond\nthird\nfourth\nfifth\nSIXTH (uncommitted)\n",
        "a current anchor also carries the full live snapshot"
    );
    Ok(())
}

#[test]
fn uncommitted_declaration_edit_surfaces_as_current_span_diff() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "w";

    repo.write_file("a.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("b.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial files")?;
    repo.span_stdout(["add", span, "a.txt#L1-L2"])?;
    repo.span_stdout(["why", span, "tracks a.txt head"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Uncommitted why edit plus an uncommitted anchor add: both are
    // declaration edits, and one worktree `span_diff` covers both.
    repo.span_stdout(["why", span, "tracks a.txt head and b.txt head"])?;
    repo.span_stdout(["add", span, "b.txt#L1-L2"])?;

    let json = history_json(&repo, span)?;
    let span_diff = json["current"]["span_diff"]
        .as_str()
        .expect("current.span_diff missing");
    assert!(
        span_diff.starts_with("diff --git a/.span/w b/.span/w\nindex "),
        "the worktree declaration diff is a real blob diff; got:\n{span_diff}"
    );
    assert!(
        span_diff.contains("+b.txt#L1-L2 rk64:"),
        "an uncommitted anchor add appears in the declaration diff; got:\n{span_diff}"
    );
    assert!(
        span_diff.contains("+tracks a.txt head and b.txt head"),
        "an uncommitted why edit appears in the same declaration diff; got:\n{span_diff}"
    );

    let out = history_text(&repo, span)?;
    assert!(
        out.starts_with("diff --git a/.span/w b/.span/w\n"),
        "the worktree declaration diff renders headerless, first; got:\n{out}"
    );
    Ok(())
}

#[test]
fn clean_worktree_has_no_current_section() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;

    // Commit the drifted source and re-anchor so the stored fingerprint matches
    // the live bytes — committing alone leaves committed-but-not-re-anchored
    // drift, the false negative this command exists to surface.
    repo.commit_all("commit the source edit")?;
    repo.span_stdout(["add", span, "file3.txt"])?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "re-anchor after source edit"])?;

    let stale = repo.run_span(["stale", span])?;
    assert!(
        stale.status.success(),
        "expected a clean `git span stale` after re-anchor; got:\n{}",
        String::from_utf8_lossy(&stale.stdout)
    );

    let json = history_json(&repo, span)?;
    assert!(
        json.get("current").is_none(),
        "no drift and a worktree matching HEAD means no current section; got: {json:#}"
    );

    let out = history_text(&repo, span)?;
    assert!(
        out.starts_with("commit "),
        "text output begins at the newest commit when nothing drifts; got:\n{out}"
    );
    Ok(())
}

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

    let json = history_json(&repo, span)?;
    assert!(
        json.get("current").is_none(),
        "an unedited whole-file anchor must not fabricate drift; got: {json:#}"
    );
    Ok(())
}

#[test]
fn current_surfaces_committed_drift_agreeing_with_stale() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "c";

    repo.write_file("src.txt", "one\ntwo\nthree\nfour\nfive\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head of src.txt"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Edit AND commit the source without re-anchoring: the worktree equals
    // HEAD, but the stored fingerprint no longer matches the live bytes.
    repo.write_file("src.txt", "ONE\nTWO\nthree\nfour\nfive\n")?;
    repo.commit_all("edit source without re-anchoring")?;

    let stale = repo.run_span(["stale", span])?;
    assert!(
        !stale.status.success(),
        "expected `git span stale` to flag committed drift; got:\n{}",
        String::from_utf8_lossy(&stale.stdout)
    );

    let json = history_json(&repo, span)?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert!(
        anchors.iter().any(|a| a["path"] == "src.txt#L1-L3"),
        "history must agree with stale about which anchor drifts; got: {json:#}"
    );
    Ok(())
}

#[test]
fn current_moved_anchor_reports_a_proposal_not_a_completed_rename() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "moved";

    repo.write_file(
        "src.txt",
        "header-a\nheader-b\nTARGET-ONE\nTARGET-TWO\nTARGET-THREE\nfooter\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L3-L5"])?;
    repo.span_stdout(["why", span, "tracks the TARGET block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Displace the identical block downward, committed, without re-anchoring.
    repo.write_file(
        "src.txt",
        "new-1\nnew-2\nnew-3\nheader-a\nheader-b\nTARGET-ONE\nTARGET-TWO\nTARGET-THREE\nfooter\n",
    )?;
    repo.commit_all("relocate the TARGET block downward")?;

    let stale = repo.run_span(["stale", span])?;
    assert!(
        String::from_utf8_lossy(&stale.stdout)
            .to_lowercase()
            .contains("moved"),
        "expected `git span stale` to classify the anchor as moved"
    );

    let json = history_json(&repo, span)?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one anchor moved; got: {json:#}");
    assert_eq!(
        anchors[0]["path"], "src.txt#L3-L5",
        "`path` is the DECLARED address — the same string `git span stale` \
         prints and the only key that joins back to the `.span` file"
    );
    assert_eq!(
        anchors[0]["proposed"], "src.txt#L6-L8",
        "the resolver's healed extent is a proposal, in its own field"
    );
    assert_eq!(
        anchors[0]["content"], "TARGET-ONE\nTARGET-TWO\nTARGET-THREE\n",
        "content is the relocated block, never a slice of the stale stored range"
    );

    let diff = anchors[0]["diff"].as_str().expect("diff string");
    assert!(
        !diff.contains("rename to") && !diff.contains("rename from"),
        "a proposal is not an accomplished move; got:\n{diff}"
    );
    assert!(
        diff.contains("proposed anchor src.txt#L6-L8\n"),
        "the human-visible representation of a proposal; got:\n{diff}"
    );
    // The bytes did not change — only the line numbers around them did. The
    // old side is the content the declaration *recorded*, so there is nothing
    // to show but the header.
    assert!(
        !diff.contains("@@"),
        "a pure move must not fabricate hunks; got:\n{diff}"
    );

    let out = history_text(&repo, span)?;
    assert!(
        out.contains("proposed anchor src.txt#L6-L8\n"),
        "the default output must report the move too; got:\n{out}"
    );
    Ok(())
}

#[test]
fn committed_in_place_drift_is_visible_in_both_formats() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "inplace";

    repo.write_file("src.txt", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Edit inside the anchored range and commit without re-anchoring. The
    // worktree is clean, so the only evidence is the recorded rk64 token.
    repo.write_file("src.txt", "alpha\nBETA-CHANGED\ngamma\ndelta\n")?;
    repo.commit_all("edit inside the anchored range")?;

    let stale = repo.run_span(["stale", span])?;
    assert!(
        !stale.status.success(),
        "expected `git span stale` to flag the drift; got:\n{}",
        String::from_utf8_lossy(&stale.stdout)
    );

    let out = history_text(&repo, span)?;
    let head = out.split("\ncommit ").next().unwrap_or("");
    assert!(
        head.contains("diff --git a/src.txt#L1-L3 b/src.txt#L1-L3"),
        "committed drift must appear in the default output, before the \
         timeline — it is exactly what `stale` reports; got:\n{out}"
    );
    assert!(
        head.contains("-beta\n") && head.contains("+BETA-CHANGED\n"),
        "the old side is the content the declaration RECORDED, so the edit \
         shows as a hunk; got:\n{out}"
    );

    let json = history_json(&repo, span)?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one anchor drifts; got: {json:#}");
    let diff = anchors[0]["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("-beta\n") && diff.contains("+BETA-CHANGED\n"),
        "JSON and human carry the identical patch; got:\n{diff}"
    );
    assert_eq!(
        anchors[0]["content"], "alpha\nBETA-CHANGED\ngamma\n",
        "a current anchor always carries the live snapshot too"
    );
    Ok(())
}

#[test]
fn uncommitted_reanchor_renders_as_a_rename() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "reanchor";

    repo.write_file("src.txt", "TARGET-A\nTARGET-B\nTARGET-C\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the TARGET block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    // Displace the block and re-anchor, both uncommitted.
    repo.write_file(
        "src.txt",
        "head-1\nhead-2\nhead-3\nTARGET-A\nTARGET-B\nTARGET-C\n",
    )?;
    repo.span_stdout(["remove", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "src.txt#L4-L6"])?;

    let json = history_json(&repo, span)?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    let moved = anchors
        .iter()
        .find(|a| a["path"] == "src.txt#L4-L6")
        .unwrap_or_else(|| panic!("re-anchored address missing from: {json:#}"));
    let diff = moved["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("rename from src.txt#L1-L3\n")
            && diff.contains("rename to src.txt#L4-L6\n"),
        "an uncommitted declaration edit genuinely moved the address, so it \
         pairs against the last recorded state as a rename; got:\n{diff}"
    );
    assert!(
        !diff.contains("new anchor"),
        "a re-anchor is not an addition; got:\n{diff}"
    );
    Ok(())
}

#[test]
fn every_current_anchor_carries_both_payloads_in_both_formats() -> Result<()> {
    for (repo, span) in [
        seed_history_scenario()?,
        {
            // Committed, unreconciled, clean worktree — the shape that used to
            // vanish from the default output entirely.
            let repo = TestRepo::new()?;
            repo.write_file("src.txt", "one\ntwo\nthree\nfour\n")?;
            repo.commit_all("initial")?;
            repo.span_stdout(["add", "cd", "src.txt#L1-L3"])?;
            repo.span_stdout(["why", "cd", "tracks the head"])?;
            repo.run_git(["add", ".span"])?;
            repo.run_git(["commit", "-m", "create span"])?;
            repo.write_file("src.txt", "ONE\ntwo\nthree\nfour\n")?;
            repo.commit_all("drift without re-anchoring")?;
            (repo, "cd")
        },
    ] {
        let json = history_json(&repo, span)?;
        let anchors = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("expected a current section in {json:#}"))
            .clone();
        assert!(!anchors.is_empty(), "expected drift in {json:#}");

        let out = history_text(&repo, span)?;
        for anchor in &anchors {
            let diff = anchor["diff"]
                .as_str()
                .unwrap_or_else(|| panic!("every current anchor carries a diff; got: {anchor}"));
            assert!(
                anchor.get("content").is_some() || anchor.get("unavailable").is_some(),
                "every current anchor carries a live snapshot or an \
                 unavailability reason; got: {anchor}"
            );
            assert!(
                out.contains(diff),
                "the human format must emit the same entry set as JSON; \
                 missing:\n{diff}\nfrom:\n{out}"
            );
        }
    }
    Ok(())
}

#[test]
fn current_paths_are_declared_addresses_present_in_the_live_span_file() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let declaration = std::fs::read_to_string(repo.path().join(".span").join(span))?;
    let json = history_json(&repo, span)?;

    for anchor in json["current"]["anchors"]
        .as_array()
        .expect("current anchors array")
    {
        let path = anchor["path"].as_str().expect("path string");
        let (file, _) = path.split_once('#').unwrap_or((path, ""));
        assert!(
            declaration.contains(file),
            "`current.path` must be the declared address a consumer can join \
             against the `.span` file; `{path}` is not in:\n{declaration}"
        );
    }
    Ok(())
}

#[test]
fn worktree_drift_is_not_rendered_as_a_total_deletion() -> Result<()> {
    // Regression: a resolved location read from the working tree carries
    // `blob: None` (see `AnchorLocation::blob`), so reading its text has to
    // fall back to disk. Without that fallback the live side comes back empty
    // and every worktree-drifted anchor renders as a total deletion.
    let repo = TestRepo::new()?;
    let span = "wt";

    repo.write_file("whole.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "whole.txt"])?;
    repo.span_stdout(["why", span, "tracks the whole file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span"])?;

    repo.write_file("whole.txt", "alpha\nbeta\ngamma\ndelta (uncommitted)\n")?;

    let json = history_json(&repo, span)?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one anchor drifts; got: {json:#}");
    assert_eq!(
        anchors[0]["content"], "alpha\nbeta\ngamma\ndelta (uncommitted)\n",
        "the live side is read from the working tree, not left empty"
    );
    let diff = anchors[0]["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("+delta (uncommitted)\n") && !diff.contains("-alpha\n"),
        "an uncommitted append is an append, not a total deletion; got:\n{diff}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Never-committed declarations
// ---------------------------------------------------------------------------

#[test]
fn uncommitted_declaration_with_drifted_anchor_is_a_header_only_drift() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "nodecl";

    repo.write_file("src.txt", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("initial")?;
    // Declare, then edit the anchored lines — both uncommitted. The recorded
    // rk64 hashes content that exists at no commit.
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head block"])?;
    repo.write_file("src.txt", "alpha\nBETA-DRIFTED\ngamma\ndelta\n")?;

    let stale = repo.run_span(["stale", span])?;
    assert!(
        !stale.status.success(),
        "expected `git span stale` to flag working-tree drift; got:\n{}",
        String::from_utf8_lossy(&stale.stdout)
    );

    let json = history_json(&repo, span)?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one anchor drifts; got: {json:#}");
    let anchor = &anchors[0];
    let diff = anchor["diff"].as_str().expect("diff string");

    assert!(
        !diff.contains("new anchor"),
        "an anchor whose live content contradicts the recorded hash is drift, \
         not a creation; got:\n{diff}"
    );
    assert!(
        !diff.contains("@@") && !diff.contains("+BETA-DRIFTED"),
        "with no recoverable recorded bytes there is no honest hunk to show, \
         and the drifted text is never presented as the declared content; \
         got:\n{diff}"
    );
    let index_line = diff
        .lines()
        .find(|l| l.starts_with("index "))
        .unwrap_or_else(|| panic!("no index line in:\n{diff}"));
    let (old_hash, new_hash) = index_line
        .trim_start_matches("index ")
        .split_once("..")
        .unwrap_or_else(|| panic!("malformed index line: {index_line}"));
    assert_ne!(
        old_hash, new_hash,
        "the recorded and live hashes differ — that mismatch is the finding"
    );
    assert!(
        old_hash.starts_with("rk64:") && new_hash.starts_with("rk64:"),
        "both sides carry real rk64 tokens; got: {index_line}"
    );
    assert_eq!(anchor["recorded"], "unrecoverable");
    assert_eq!(anchor["content"], "alpha\nBETA-DRIFTED\ngamma\n");

    let out = history_text(&repo, span)?;
    assert!(out.contains(diff), "the default output carries it too:\n{out}");
    Ok(())
}

#[test]
fn uncommitted_declaration_without_drift_reports_only_the_declaration() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "clean";

    repo.write_file("src.txt", "alpha\nbeta\ngamma\ndelta\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the head block"])?;

    let json = history_json(&repo, span)?;
    assert!(
        json["current"]["span_diff"].is_string(),
        "the uncommitted declaration itself is the whole story; got: {json:#}"
    );
    assert_eq!(
        json["current"]["anchors"]
            .as_array()
            .expect("current anchors array")
            .len(),
        0,
        "a freshly declared, undrifted anchor reports nothing; got: {json:#}"
    );

    // Paired with the drifted fixture above, this pins the whole rule: the
    // creation dialect is unreachable from the current block. A clean new
    // anchor is `Fresh` and reports nothing; a drifted one is a header-only
    // drift block. `new anchor` therefore only ever means "declared here", in
    // a timeline entry.
    let out = history_text(&repo, span)?;
    let before_timeline = out.split("\ncommit ").next().unwrap_or("");
    assert!(
        !before_timeline.contains("new anchor"),
        "the current block never speaks the creation dialect; got:\n{out}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Declaration diffs speak real git
// ---------------------------------------------------------------------------

/// `git diff <from> <to> -- <path>`, with index hashes normalized to 7 hex so
/// abbreviation-length differences do not defeat the comparison.
fn git_diff(repo: &TestRepo, from: &str, to: &str, path: &str) -> Result<String> {
    let raw = repo.git_stdout(["diff", "--no-color", from, to, "--", path])?;
    Ok(normalize_index_lines(&raw))
}

fn normalize_index_lines(patch: &str) -> String {
    patch
        .lines()
        .map(|line| match line.strip_prefix("index ") {
            Some(rest) => {
                let (hashes, suffix) = match rest.split_once(' ') {
                    Some((h, s)) => (h, format!(" {s}")),
                    None => (rest, String::new()),
                };
                match hashes.split_once("..") {
                    Some((a, b)) => format!(
                        "index {}..{}{suffix}",
                        &a[..a.len().min(7)],
                        &b[..b.len().min(7)]
                    ),
                    None => line.to_string(),
                }
            }
            None => line.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

#[test]
fn declaration_diffs_match_real_git_for_add_modify_and_delete() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "d";

    repo.write_file("src.txt", "alpha\nbeta\ngamma\n")?;
    let c0 = repo.commit_all("C0: initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L2"])?;
    repo.span_stdout(["why", span, "first why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C1: create the declaration"])?;
    let c1 = repo.head_sha()?;
    repo.span_stdout(["why", span, "second why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "C2: edit the declaration"])?;
    let c2 = repo.head_sha()?;
    repo.run_git(["rm", ".span/d"])?;
    repo.run_git(["commit", "-m", "C3: delete the declaration"])?;
    let c3 = repo.head_sha()?;

    let json = history_json(&repo, span)?;
    for (needle, from, to) in [
        ("C1: create the declaration", &c0, &c1),
        ("C2: edit the declaration", &c1, &c2),
        ("C3: delete the declaration", &c2, &c3),
    ] {
        let ours = commit_with(&json, needle)["span_diff"]
            .as_str()
            .unwrap_or_else(|| panic!("no span_diff on {needle}"));
        let theirs = git_diff(&repo, from, to, ".span/d")?;
        assert_eq!(
            normalize_index_lines(ours),
            theirs,
            "our declaration patch must be byte-identical to git's own for {needle}"
        );
    }

    // And spot-check the dialect markers the differential test enforces.
    let created = commit_with(&json, "C1: create the declaration")["span_diff"]
        .as_str()
        .expect("span_diff");
    assert!(
        created.starts_with("diff --git a/.span/d b/.span/d\nnew file mode 100644\nindex 0000000.."),
        "a creation is an add, with the real path on both sides; got:\n{created}"
    );
    assert!(
        !created.contains("a/dev/null") && !created.contains("100644\n--- "),
        "git never prefixes /dev/null with a/, nor puts a mode suffix on an \
         add's index line; got:\n{created}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Invariants that hold across the whole scenario
// ---------------------------------------------------------------------------

/// Every rendered `diff --git` block in `patch`, split on the header line.
fn diff_blocks(patch: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    for line in patch.lines() {
        if line.starts_with("diff --git ") {
            blocks.push(String::new());
        }
        if let Some(current) = blocks.last_mut() {
            current.push_str(line);
            current.push('\n');
        }
    }
    blocks
}

#[test]
fn equal_index_hashes_never_sit_above_hunks() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    for block in diff_blocks(&out) {
        let Some(index_line) = block.lines().find(|l| l.starts_with("index ")) else {
            continue;
        };
        let hashes = index_line.trim_start_matches("index ");
        let hashes = hashes.split(' ').next().unwrap_or(hashes);
        let Some((old, new)) = hashes.split_once("..") else {
            continue;
        };
        if old == new {
            assert!(
                !block.contains("@@"),
                "`index {old}..{new}` claims the two sides are identical, so \
                 the block cannot carry hunks:\n{block}"
            );
        }
    }
    Ok(())
}

#[test]
fn hunk_headers_agree_with_their_bodies() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    let mut header: Option<(u32, u32, String)> = None;
    let (mut old_seen, mut new_seen) = (0u32, 0u32);
    let check = |h: &Option<(u32, u32, String)>, old_seen: u32, new_seen: u32| {
        if let Some((old_len, new_len, line)) = h {
            assert_eq!(
                (*old_len, *new_len),
                (old_seen, new_seen),
                "hunk header `{line}` must count its own body lines"
            );
        }
    };
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("@@ -") {
            check(&header, old_seen, new_seen);
            let (old_part, rest) = rest.split_once(" +").expect("malformed hunk header");
            let new_part = rest.split(" @@").next().expect("malformed hunk header");
            let len = |spec: &str| -> u32 {
                spec.split_once(',')
                    .map(|(_, l)| l.parse().unwrap_or(1))
                    .unwrap_or(1)
            };
            header = Some((len(old_part), len(new_part), line.to_string()));
            old_seen = 0;
            new_seen = 0;
        } else if header.is_some() {
            match line.chars().next() {
                Some(' ') => {
                    old_seen += 1;
                    new_seen += 1;
                }
                Some('-') if !line.starts_with("--- ") => old_seen += 1,
                Some('+') if !line.starts_with("+++ ") => new_seen += 1,
                Some('\\') => {}
                _ => {
                    check(&header, old_seen, new_seen);
                    header = None;
                }
            }
        }
    }
    check(&header, old_seen, new_seen);
    Ok(())
}

#[test]
fn human_date_line_carries_gits_full_author_date() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    let dates: Vec<&str> = out
        .lines()
        .filter_map(|l| l.strip_prefix("Date:   "))
        .collect();
    assert!(!dates.is_empty(), "expected Date: lines in:\n{out}");
    for date in dates {
        chrono::DateTime::parse_from_str(date, "%a %b %e %H:%M:%S %Y %z").unwrap_or_else(|e| {
            panic!("`Date:` must use git's own default rendering, got {date:?}: {e}")
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Not-found handling
// ---------------------------------------------------------------------------

#[test]
fn a_namespace_name_errors_instead_of_panicking() -> Result<()> {
    let repo = TestRepo::new()?;

    repo.write_file("src.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", "ns/one", "src.txt#L1-L2"])?;
    repo.span_stdout(["why", "ns/one", "tracks the head"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span under a namespace"])?;

    for name in ["ns", "ns/", ""] {
        let out = repo.run_span(["history", name])?;
        let code = out.status.code();
        assert_eq!(
            code,
            Some(1),
            "`git span history {name:?}` must fail closed with a CliError, not \
             panic; stderr:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !stderr.contains("panicked"),
            "no panic for {name:?}; got:\n{stderr}"
        );
    }

    // The namespace case is worth naming explicitly.
    let out = repo.run_span(["history", "ns"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("namespace") && stderr.contains("ns/one"),
        "a namespace miss should name the spans underneath it; got:\n{stderr}"
    );
    Ok(())
}
