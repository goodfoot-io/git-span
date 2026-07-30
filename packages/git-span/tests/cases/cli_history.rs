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
fn degradation_note_transition_renders_as_a_content_change() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "degraded";

    repo.write_file("src.txt", "line1\nline2\nline3\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "src.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "initial why"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "create span with src.txt"])?;

    // Delete the source while the declaration keeps pointing at it. The
    // extraction degrades to a note rather than aborting the report, and the
    // Text→Note transition is an ordinary content change.
    repo.run_git(["rm", "src.txt"])?;
    repo.run_git(["commit", "-m", "delete src.txt"])?;

    let out = history_text(&repo, span)?;
    assert!(
        out.contains("+(file absent at this commit)"),
        "a Text→Note transition diffs like any other content change; got:\n{out}"
    );
    assert!(
        out.contains("-line1\n"),
        "the prior real content is the old side of that diff; got:\n{out}"
    );
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
fn current_moved_anchor_diffs_against_the_relocated_block() -> Result<()> {
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

    // Displace the identical block downward without re-anchoring.
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
        anchors[0]["path"], "src.txt#L6-L8",
        "the current path is the relocated address"
    );
    assert_eq!(
        anchors[0]["content"], "TARGET-ONE\nTARGET-TWO\nTARGET-THREE\n",
        "content is the relocated block, never a slice of the stale stored range"
    );

    let diff = anchors[0]["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("rename from src.txt#L3-L5\n") && diff.contains("rename to src.txt#L6-L8\n"),
        "a relocation renders rename headers; got:\n{diff}"
    );
    // The old side is the *last recorded timeline snapshot at its recorded
    // address* — which, after the displacing commit, extracts the wrong lines.
    // That stale extraction is precisely the drift being visualized: taking
    // declared ranges at face value is what makes the displacement visible.
    assert!(
        diff.contains("@@ -3,3 +6,3 @@\n")
            && diff.contains("-new-3\n")
            && diff.contains("+TARGET-ONE\n"),
        "the hunk must show the declared range's stale extraction against the \
         relocated block; got:\n{diff}"
    );
    Ok(())
}
