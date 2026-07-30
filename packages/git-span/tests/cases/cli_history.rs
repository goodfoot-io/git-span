//! CLI: `git span history <span>` — the v2 output contract.
//!
//! Two formats: git-log-style text (the default) and `schema_version: 2` JSON
//! carrying the identical raw patch strings. Both are newest-first, and every
//! observable change is a unified diff in git's dialect — declaration edits as
//! real blob diffs (`span_diff`), anchor changes as pseudo-diffs between
//! extracted snapshots.
//!
//! # Projection inventory
//!
//! An oracle can miss a defect two ways that no state enumeration and no
//! skip-condition inventory will show. It can be *handed* the right data and
//! throw the discriminating part away (its **projection**), or it can be
//! pointed at the wrong data and never receive the case at all (its
//! **aperture**). Both are recorded here, one line each, with the assertion
//! that covers what is dropped or a sentence on why dropping it is safe.
//!
//! This is not hypothetical. The aperture question — "what was this oracle
//! never handed?" — was written down during this wave and caught its fourth
//! instance within the hour, biting a *fix* rather than the implementation:
//! the key sweep below discards nothing in its return shape, but its aperture
//! is the `current.anchors[]` heading it parses, so it simply never received a
//! timeline anchor object, and the first timeline-only keys in the schema's
//! life were about to land in an emitter with no contract above it and no
//! sweep below it.
//!
//! | Oracle | Projection — what the shape discards | Aperture — what it is never handed |
//! |---|---|---|
//! | [`block_form`] | Everything but the form: addresses, hashes, hunk bodies. The sweeps re-read all three off the raw `diff` beside it. Reads only the header region (before `\n--- `), so a hunk body quoting a marker phrase cannot be mistaken for one | One block's patch string; it cannot see sibling blocks or the entry around them |
//! | [`timeline_form`] | Same, and resolves `Rebound` from the structured `rebound` field rather than the patch text — `rebound anchor` is a phrase this repository's own tracked source contains | One anchor object |
//! | [`newest_commit_forms`] | `path`. `[Rebound, Modified]` cannot distinguish one address rendering both facts from two addresses rendering one each — use [`newest_commit_blocks`] where that is the point | Only `commits[0]`; older entries and the `current` block are outside it |
//! | [`newest_commit_blocks`] | Hashes, hunks, `unavailable`, `rebound`'s payload — asserted directly off the JSON in the tests that care | Only `commits[0]` |
//! | [`declared_pairs`] | The why-prose and every non-`rk64:` line of the declaration | One `.span` file at one rev; it says nothing about content at any address — [`read_address`] is the oracle for that |
//! | [`current_forms`] | `path` and payloads, exactly as `newest_commit_forms` does | The `current` array only; timeline entries are outside it |
//! | [`documented_anchor_fields`] | Every word of each field's prose — it compares *names*, not meanings, which is how a worked example contradicting its own rule survived (`no_documented_example_shows_a_rename_below_the_threshold` compares the values) | One heading's bullet list. Two adjacent lists exist and each is parsed alone, deliberately: one list vouching for the other's keys is how a sweep certifies a false document |
//! | The key sweeps | Nothing from the objects they walk — both directions, no exemptions (the binary re-anchor fixture emits `unavailable`, closing the hatch the `current` sweep used to carry) | Each walks exactly one array against exactly one list, drawn from that array's own fixture enumeration ([`every_current_state`] / [`every_timeline_state`]). The aperture is no longer key names alone: [`documented_field_values`] extends it to the *value* space of `unavailable`, so a documented value with no producing fixture fails the same way a documented key would. A key sweep that never looks inside the values is how `range-past-eof` stayed documented-but-unreachable from `current[]` through eight rounds |
//! | [`documented_field_values`] | Every word of the prose around the values, and every field but the one named — it reads `` `"…"` `` spans out of one bullet | One field's bullet in one array's list. It requires each documented value to have a producer; it cannot notice a value the product emits and the document never mentions (the key sweeps' other direction covers keys, not values) |
//! | [`payload_fields`] | `path` and `diff` — deliberately. `path` is the join key every object differs in trivially, so including it would make any two objects "distinct" for free; `diff` is the patch string whose parsing `--format json` exists to spare consumers, and a discriminator recoverable only from a marker line inside it is not a contract | Two keys of one anchor object. It is the *narrowest* view a consumer might take, which is the point: distinguishability that survives this projection survives any wider one |
//! | [`every_current_state`] | — | Current-block states only. `Rebound` is timeline-only and `Proposed` current-block-only, so this set structurally cannot reach every form |
//! | [`every_timeline_state`] | — | Timeline states only, and only each fixture's *newest* entry is form-checked |
//! | The null-hash distinguishability matrix | Everything [`payload_fields`] drops | The three null-hash states reachable in `current[]`, enumerated by **route** (four objects — past-EOF contributes both of its). Enumerating by state was the trap: past-EOF has two routes that used to render differently, so a state-keyed matrix passes on whichever route the implementer fixtured first. The fourth null-hash state, the `/dev/null` side of a genuine create, cannot reach `current[]` at all — an uncommitted addition renders `anchors: []` — so it is outside this aperture and covered by the timeline sweeps |

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

/// Commit `alpha/beta/gamma` anchored at `f.txt#L1-L3`, then prepend two
/// lines in the worktree and edit `beta` — the ordinary drift state, with the
/// declaration untouched. `stale` calls it "changed in the working tree" and
/// proposes nothing.
fn drifted_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    repo.write_file("f.txt", "h1\nh2\nalpha\nBETA\ngamma\n")?;
    Ok(repo)
}

#[test]
fn a_changed_anchor_is_read_at_its_declared_address_and_proposes_nothing() -> Result<()> {
    let repo = drifted_repo("ch")?;
    let stale = String::from_utf8_lossy(&repo.run_span(["stale"])?.stdout).into_owned();
    assert!(
        stale.contains("f.txt#L1-L3 — changed in the working tree"),
        "fixture assumption: stale reports drift and no relocation; got:\n{stale}"
    );
    assert!(
        !stale.contains("moved to"),
        "fixture assumption: no relocation instruction; got:\n{stale}"
    );

    let json = history_json(&repo, "ch")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one drifted anchor; got: {json:#}");
    let anchor = &anchors[0];
    assert_eq!(anchor["path"], "f.txt#L1-L3");
    assert!(
        anchor.get("proposed").is_none() || anchor["proposed"].is_null(),
        "the resolver proposed nothing, so neither may history; got: {anchor:#}"
    );
    // A `Changed` anchor's resolved `current` extent is only where the search
    // landed. The declared range is taken at face value: its live bytes are
    // the new side, drift and all.
    assert_eq!(
        anchor["content"], "h1\nh2\nalpha\n",
        "the new side is the declared range's live content; got: {anchor:#}"
    );
    let diff = anchor["diff"].as_str().expect("diff string");
    assert!(
        !diff.contains("proposed anchor"),
        "no relocation instruction anywhere in the block; got:\n{diff}"
    );
    assert!(
        diff.contains("diff --git a/f.txt#L1-L3 b/f.txt#L1-L3\n")
            && diff.contains("@@ -1,3 +1,3 @@\n"),
        "both labels and both coordinates name the declared range; got:\n{diff}"
    );
    assert!(
        diff.contains("+h1\n") && diff.contains("+h2\n") && diff.contains("-beta\n"),
        "the diff is between the recorded content and the declared range's \
         live bytes — the displacement is the drift; got:\n{diff}"
    );
    let out = history_text(&repo, "ch")?;
    assert!(out.contains(diff), "the default output carries it too:\n{out}");
    Ok(())
}

#[test]
fn a_drifted_reanchor_labels_the_old_side_with_heads_address() -> Result<()> {
    let repo = drifted_repo("re")?;
    // Re-anchor by rewriting the address in place, keeping the recorded token:
    // this is the state `git span stale --fix` leaves behind, and unlike
    // `remove`+`add` it does not re-record the drifted content as the anchored
    // content. A genuine declaration re-anchor carrying content drift.
    let decl = repo.path().join(".span/re");
    let text = std::fs::read_to_string(&decl)?.replace("f.txt#L1-L3", "f.txt#L3-L5");
    std::fs::write(&decl, text)?;

    let json = history_json(&repo, "re")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    let anchor = anchors
        .iter()
        .find(|a| a["path"] == "f.txt#L3-L5")
        .unwrap_or_else(|| panic!("re-anchored address missing from: {json:#}"));
    assert!(
        anchor.get("proposed").is_none() || anchor["proposed"].is_null(),
        "the anchor is `Changed`, not relocated; got: {anchor:#}"
    );
    assert_eq!(
        anchor["content"], "alpha\nBETA\ngamma\n",
        "three declared lines, read at the declared address; got: {anchor:#}"
    );
    let diff = anchor["diff"].as_str().expect("diff string");
    // The old side is the recorded content, which lived at HEAD's address —
    // never at the address the worktree declaration now names.
    assert!(
        diff.contains("diff --git a/f.txt#L1-L3 b/f.txt#L3-L5\n")
            && diff.contains("rename from f.txt#L1-L3\n")
            && diff.contains("rename to f.txt#L3-L5\n"),
        "the old side wears the address whose content it is; got:\n{diff}"
    );
    assert!(
        diff.contains("@@ -1,3 +3,3 @@\n"),
        "the old coordinate agrees with the old label, the new with the new; \
         got:\n{diff}"
    );
    assert!(
        diff.contains("-beta\n") && diff.contains("+BETA\n") && !diff.contains("-alpha\n"),
        "exactly the in-place edit, with no fabricated deletions; got:\n{diff}"
    );
    let out = history_text(&repo, "re")?;
    assert!(out.contains(diff), "the default output carries it too:\n{out}");
    Ok(())
}

/// A declaration added but never committed, whose anchored lines are then
/// edited: the recorded token describes bytes that no commit ever carried, so
/// no snapshot this command can reach hashes to it.
fn never_recorded_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    // The declaration stays in the worktree, and the anchored content moves on
    // without it.
    repo.write_file("f.txt", "alpha\nZZZ\nCCC\n")?;
    Ok(repo)
}

#[test]
fn an_unrecoverable_recorded_snapshot_is_named_in_the_human_block() -> Result<()> {
    let repo = never_recorded_repo("ff")?;
    let json = history_json(&repo, "ff")?;
    let anchor = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array")
        .iter()
        .find(|a| a["recorded"] == "unrecoverable")
        .unwrap_or_else(|| panic!("no unrecoverable anchor in: {json:#}"));
    let diff = anchor["diff"].as_str().expect("diff string");
    assert!(
        !diff.contains("@@"),
        "an unrecoverable old side cannot produce hunks; got:\n{diff}"
    );
    // Without the marker the human block is two differing hashes and nothing
    // else — the hidden-drift shape, indistinguishable from a renderer that
    // dropped its hunks.
    assert!(
        diff.contains("\nrecorded snapshot unrecoverable\n"),
        "the state JSON reports as `recorded: unrecoverable` must be legible \
         in the patch itself; got:\n{diff}"
    );
    let out = history_text(&repo, "ff")?;
    assert!(
        out.contains("recorded snapshot unrecoverable\n"),
        "the default output is where the explanation is needed; got:\n{out}"
    );
    assert!(out.contains(diff), "both formats carry the same block:\n{out}");
    Ok(())
}

/// Rewrite the worktree declaration, leaving the recorded tokens alone. This
/// is how a user (or `git span stale --fix`) re-anchors: the address moves,
/// the token stays, and HEAD's copy still names the old address.
fn rewrite_declaration(repo: &TestRepo, span: &str, from: &str, to: &str) -> Result<()> {
    let decl = repo.path().join(format!(".span/{span}"));
    let text = std::fs::read_to_string(&decl)?;
    assert!(text.contains(from), "declaration has no {from}:\n{text}");
    std::fs::write(&decl, text.replace(from, to))?;
    Ok(())
}

/// Two anchors whose *declared addresses* are exchanged in the worktree — each
/// token is now declared where the other's content lives — with both blocks
/// also edited, so the resolver can no longer find either recorded block and
/// the only place those bytes survive is the last recorded state.
fn declaration_swap_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "f.txt",
        "AAA-1\nAAA-2\nAAA-3\nmiddle\nBBB-1\nBBB-2\nBBB-3\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "f.txt#L5-L7"])?;
    repo.span_stdout(["why", span, "tracks both blocks"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L9-L11")?;
    rewrite_declaration(&repo, span, "f.txt#L5-L7", "f.txt#L1-L3")?;
    rewrite_declaration(&repo, span, "f.txt#L9-L11", "f.txt#L5-L7")?;
    repo.write_file(
        "f.txt",
        "AAA-1\nAAA-EDITED\nAAA-3\nmiddle\nBBB-1\nBBB-EDITED\nBBB-3\n",
    )?;
    Ok(repo)
}

#[test]
fn a_declaration_swap_recovers_both_old_sides() -> Result<()> {
    let repo = declaration_swap_repo("dswap")?;
    let json = history_json(&repo, "dswap")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    // Each anchor's recorded block leaves its old address and each new
    // address arrives: `AAA-*` and `BBB-EDITED` share nothing, so pairing them
    // into one rename would spell an edit nobody made.
    assert_eq!(anchors.len(), 4, "two deletes and two creates; got: {json:#}");
    for anchor in anchors {
        // The recorded bytes sit under the *sibling's* address in the last
        // recorded state. Searching only under this anchor's own label
        // reported content that is one line away as lost — a data-loss claim
        // whose documented remedy is destructive.
        assert!(
            anchor.get("recorded").is_none(),
            "the recorded bytes are in the last recorded state; got: {anchor:#}"
        );
        assert!(
            !anchor["diff"]
                .as_str()
                .expect("diff string")
                .contains("recorded snapshot unrecoverable"),
            "no false data-loss claim; got: {anchor:#}"
        );
    }
    for (address, recorded_block) in [("f.txt#L1-L3", "-AAA-1\n"), ("f.txt#L5-L7", "-BBB-1\n")] {
        let diff = anchors
            .iter()
            .filter_map(|a| a["diff"].as_str())
            .find(|d| d.starts_with(&format!("diff --git a/{address} b/dev/null\n")))
            .unwrap_or_else(|| panic!("{address} never leaves; got: {json:#}"));
        assert!(
            diff.contains("deleted anchor\n") && diff.contains(recorded_block),
            "the recorded block is shown whole where HEAD declared it; got:\n{diff}"
        );
    }
    let out = history_text(&repo, "dswap")?;
    assert!(
        !out.contains("recorded snapshot unrecoverable"),
        "nor in the human surface; got:\n{out}"
    );
    Ok(())
}

/// Re-anchor onto an address the declaration never used, then edit inside the
/// new range while the recorded block sits untouched elsewhere — the one shape
/// where a declaration re-anchor and a resolver relocation both apply.
fn reanchor_over_relocation_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\nfour\nfive\nsix\nseven\neight\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks the greek block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L6-L8")?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\nfour\nfive\nsix\nEDITED\neight\n")?;
    Ok(repo)
}

#[test]
fn a_reanchor_over_a_relocation_never_states_two_directions() -> Result<()> {
    let repo = reanchor_over_relocation_repo("both")?;
    let json = history_json(&repo, "both")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 2, "a delete and a create; got: {json:#}");
    let arrived = anchor_at(anchors, "f.txt#L6-L8");
    let diff = arrived["diff"].as_str().expect("diff string");

    // The declaration itself moved this anchor, so the block says nothing
    // about relocation: a `proposed anchor f.txt#L1-L3` beside a header
    // naming `f.txt#L6-L8` would be two contradictory instructions in five
    // lines, and only one of them can be acted on.
    for anchor in anchors {
        assert!(
            anchor.get("proposed").is_none() || anchor["proposed"].is_null(),
            "a re-anchor states the user's intent; got: {anchor:#}"
        );
    }
    // The recorded block and the newly covered block share nothing, so they
    // are reported as what they are: one anchor left, another arrived.
    let gone = anchor_at(anchors, "f.txt#L1-L3");
    let gone_diff = gone["diff"].as_str().expect("diff string");
    assert!(
        gone_diff.contains("diff --git a/f.txt#L1-L3 b/dev/null\n")
            && gone_diff.contains("deleted anchor\n"),
        "the recorded block leaves under HEAD's address; got:\n{gone_diff}"
    );
    assert!(
        diff.contains("diff --git a/dev/null b/f.txt#L6-L8\n") && diff.contains("new anchor\n"),
        "the declaration's new address arrives on its own; got:\n{diff}"
    );
    // The b/ side's bytes are read where its label says: the declared range,
    // including the user's edit. Reading them at the relocation target made
    // the two hashes equal and the edit vanish entirely.
    assert_eq!(
        arrived["content"], "six\nEDITED\neight\n",
        "the live side is the declared range's content; got: {arrived:#}"
    );
    assert!(
        diff.contains("+EDITED\n"),
        "the user's edit is the whole point of the block; got:\n{diff}"
    );
    Ok(())
}

/// Two anchors in *different files* whose declared addresses are exchanged in
/// the worktree declaration, content untouched. The resolver cannot follow a
/// token across files, so both anchors come out `changed` and the recorded
/// bytes survive only in the snapshots the render itself prints. Reachable
/// without hand-editing: resolving a `.span` conflict after a merge or rebase
/// leaves exactly this state.
fn cross_file_swap_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "AAA-1\nAAA-2\nAAA-3\n")?;
    repo.write_file("g.txt", "BBB-1\nBBB-2\nBBB-3\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "g.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "tracks both files"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "tmp.txt#L1-L1")?;
    rewrite_declaration(&repo, span, "g.txt#L1-L3", "f.txt#L1-L3")?;
    rewrite_declaration(&repo, span, "tmp.txt#L1-L1", "g.txt#L1-L3")?;
    Ok(repo)
}

#[test]
fn a_cross_file_declaration_swap_recovers_both_old_sides() -> Result<()> {
    let repo = cross_file_swap_repo("xswap")?;
    let out = history_text(&repo, "xswap")?;
    // The recorded blocks are printed in full further down this very render.
    assert!(
        !out.contains("recorded snapshot unrecoverable"),
        "a loss the same output disproves twenty lines lower; got:\n{out}"
    );

    let json = history_json(&repo, "xswap")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 4, "two deletes and two creates; got: {json:#}");
    for anchor in anchors {
        assert!(
            anchor.get("recorded").is_none(),
            "the token's bytes are in the render; got: {anchor:#}"
        );
    }
    // Nothing in either file changed — `git diff` is empty — so no block may
    // pair the two unrelated tokens into a rename and spell out an edit.
    assert!(
        repo.git_stdout(["diff", "--", ".", ":(exclude).span"])?
            .is_empty(),
        "fixture assumption: the swap is declaration-only"
    );
    assert!(
        !out.contains("rename "),
        "a rename here asserts an edit the repository does not show; got:\n{out}"
    );
    for (source, recorded_line) in [("f.txt#L1-L3", "-AAA-1\n"), ("g.txt#L1-L3", "-BBB-1\n")] {
        let diff = anchors
            .iter()
            .filter_map(|a| a["diff"].as_str())
            .find(|d| d.starts_with(&format!("diff --git a/{source} b/dev/null\n")))
            .unwrap_or_else(|| panic!("{source} never leaves; got: {json:#}"));
        assert!(
            diff.contains("deleted anchor\n") && diff.contains(recorded_line),
            "the recorded block is shown whole, labelled where HEAD declared \
             it; got:\n{diff}"
        );
    }
    Ok(())
}

/// The minimal false-unrecoverable reproduction: re-anchor by editing the
/// declaration, then replace the recorded block's content in the worktree. The
/// token's bytes are gone from the worktree but still sit in HEAD at an
/// address this anchor never pairs with.
fn abandoned_block_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\nmid\nAAA\nBBB\nCCC\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "the block matters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L5-L7")?;
    repo.write_file("f.txt", "XXX\nYYY\nZZZ\nmid\nAAA\nBBB\nCCC\n")?;
    Ok(repo)
}

#[test]
fn a_reanchor_that_abandons_its_recorded_block_still_shows_it() -> Result<()> {
    let repo = abandoned_block_repo("re2")?;
    let out = history_text(&repo, "re2")?;
    assert!(
        !out.contains("recorded snapshot unrecoverable"),
        "HEAD still carries the recorded block; got:\n{out}"
    );

    let json = history_json(&repo, "re2")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    // `alpha/beta/gamma` and `AAA/BBB/CCC` share nothing, so the two blocks
    // are two blocks — a rename between them would assert an edit that never
    // happened, and git refuses the form below its own threshold.
    assert_eq!(anchors.len(), 2, "a delete and a create; got: {json:#}");
    let gone = anchor_at(anchors, "f.txt#L1-L3");
    let arrived = anchor_at(anchors, "f.txt#L5-L7");
    assert!(gone.get("recorded").is_none(), "got: {gone:#}");
    assert_eq!(
        gone["content"], "alpha\nbeta\ngamma\n",
        "the abandoned block is still shown, whole; got: {gone:#}"
    );
    let gone_diff = gone["diff"].as_str().expect("diff string");
    assert!(
        gone_diff.contains("diff --git a/f.txt#L1-L3 b/dev/null\n")
            && gone_diff.contains("deleted anchor\n")
            && gone_diff.contains("-alpha\n"),
        "the recorded block leaves under the address HEAD declared for it; \
         got:\n{gone_diff}"
    );
    // `path` and `content` must describe the same three lines: a consumer
    // joining on `path` is misled by bytes that address does not hold.
    assert_eq!(
        arrived["content"], "AAA\nBBB\nCCC\n",
        "content is what the declared address holds; got: {arrived:#}"
    );
    let arrived_diff = arrived["diff"].as_str().expect("diff string");
    assert!(
        arrived_diff.contains("diff --git a/dev/null b/f.txt#L5-L7\n")
            && arrived_diff.contains("new anchor\n")
            && arrived_diff.contains("+AAA\n"),
        "the newly covered block arrives whole; got:\n{arrived_diff}"
    );
    assert!(!out.contains("rename "), "nothing was renamed; got:\n{out}");
    // ORACLE — `stale`, a different command reading the same declaration: it
    // reports the new address as changed and issues no move, so history must
    // not pair the two blocks into a move of its own.
    let stale = String::from_utf8_lossy(&repo.run_span(["stale"])?.stdout).into_owned();
    assert!(
        stale.contains("f.txt#L5-L7 — changed") && !stale.contains("moved to"),
        "fixture assumption: a re-anchor onto non-matching content; got:\n{stale}"
    );
    Ok(())
}

/// The single `current` anchor entry whose `path` is `address`.
fn anchor_at<'a>(anchors: &'a [Value], address: &str) -> &'a Value {
    let mut found = anchors.iter().filter(|a| a["path"] == address);
    let first = found
        .next()
        .unwrap_or_else(|| panic!("no current anchor at {address} in {anchors:#?}"));
    assert!(
        found.next().is_none(),
        "more than one current anchor at {address} in {anchors:#?}"
    );
    first
}

/// Two anchors in different files holding *identical* content, so one `rk64`
/// token binds both addresses — then drift one of them. `rk64` is a
/// content-only fingerprint, so a token→snapshot lookup that ignores the
/// asking anchor's own address can hand back the sibling's snapshot.
fn twin_token_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("x.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("y.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "x.txt#L1-L3"])?;
    repo.span_stdout(["add", span, "y.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "two copies of one block"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    repo.write_file("x.txt", "alpha\nBETA\ngamma\n")?;
    Ok(repo)
}

#[test]
fn anchors_sharing_a_token_resolve_against_their_own_address() -> Result<()> {
    let repo = twin_token_repo("twin")?;
    let json = history_json(&repo, "twin")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "only x.txt drifted; got: {json:#}");
    let anchor = &anchors[0];
    assert_eq!(anchor["path"], "x.txt#L1-L3");
    let diff = anchor["diff"].as_str().expect("diff string");
    // The sibling's snapshot hashes to the same token. Serving it here would
    // put a body under a label that never held it and dress a one-line edit as
    // a cross-file rename.
    assert!(
        diff.contains("diff --git a/x.txt#L1-L3 b/x.txt#L1-L3\n"),
        "both sides wear the declared address; got:\n{diff}"
    );
    assert!(
        !diff.contains("rename from") && !diff.contains("proposed anchor"),
        "nothing moved and nothing is proposed; got:\n{diff}"
    );
    assert!(
        diff.contains("-beta\n") && diff.contains("+BETA\n"),
        "the block is the edit the user made; got:\n{diff}"
    );
    Ok(())
}

/// The five shapes a rendered anchor block can take, as a reader of the patch
/// would classify it — from the header lines alone, never from the code that
/// produced them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum BlockForm {
    /// `deleted anchor` — the address left the declaration.
    Deleted,
    /// `new anchor` — the address entered it.
    Created,
    /// `rename from`/`rename to`. `similarity` is `None` when the block
    /// carries no `similarity index` line — a shape the classifier must be
    /// able to *represent*, because a classifier that cannot represent the
    /// absent case cannot test for it, and the alternative (parsing to some
    /// default) would fabricate inside the oracle the very number the
    /// renderer was fixed to stop fabricating.
    Renamed { similarity: Option<u8> },
    /// `proposed anchor <address>` — the resolver's move instruction.
    Proposed,
    /// `rebound anchor` — the address kept its content but changed which
    /// recorded token the declaration binds to it.
    Rebound,
    /// No status line: same address, changed content.
    Modified,
}

fn block_form(diff: &str) -> BlockForm {
    let head = diff.split("\n--- ").next().unwrap_or(diff);
    if head.contains("\nrebound anchor\n") {
        BlockForm::Rebound
    } else if head.contains("\ndeleted anchor\n") {
        BlockForm::Deleted
    } else if head.contains("\nnew anchor\n") {
        BlockForm::Created
    } else if head.contains("\nrename from ") {
        let similarity = head.lines().find_map(|l| {
            let value = l.strip_prefix("similarity index ")?.strip_suffix('%');
            Some(
                value
                    .and_then(|n| n.parse().ok())
                    .unwrap_or_else(|| panic!("an unreadable similarity index:\n{diff}")),
            )
        });
        BlockForm::Renamed { similarity }
    } else if head.contains("\nproposed anchor ") {
        BlockForm::Proposed
    } else {
        BlockForm::Modified
    }
}

/// The `(address, token)` pairs `.span/<span>` declares, read from the
/// worktree file (`rev` = `None`) or from a committed copy — an oracle for
/// "does this declaration still bind this token here" that shares nothing with
/// the renderer. The pair, not the address alone: a swap leaves every address
/// declared while moving every token.
fn declared_pairs(repo: &TestRepo, span: &str, rev: Option<&str>) -> Result<Vec<(String, String)>> {
    let text = match rev {
        Some(rev) => repo.git_stdout(["show", &format!("{rev}:.span/{span}")])?,
        None => std::fs::read_to_string(repo.path().join(format!(".span/{span}")))?,
    };
    Ok(text
        .lines()
        .filter_map(|l| l.split_once(' '))
        .filter(|(_, token)| token.starts_with("rk64:"))
        .map(|(addr, token)| (addr.to_string(), token.trim().to_string()))
        .collect())
}

/// Every block rendered for one address. One address carries more than one
/// block whenever two independent facts are true of it at once — a rebinding
/// and a content edit in the same commit — which is why this exists beside
/// [`anchor_at`], whose single-block assertion is the right one everywhere
/// else.
fn anchors_at<'a>(anchors: &'a [Value], address: &str) -> Vec<&'a Value> {
    anchors.iter().filter(|a| a["path"] == address).collect()
}

/// The new-side `rk64:` token an anchor block's `index` line names.
fn new_token(diff: &str) -> String {
    diff.lines()
        .find_map(|l| l.strip_prefix("index "))
        .and_then(|rest| rest.split_once(".."))
        .map(|(_, new)| new.trim().to_string())
        .unwrap_or_else(|| panic!("no index line in:\n{diff}"))
}

/// The token `.span/<span>` records for `address` at `rev`.
fn declared_token(repo: &TestRepo, span: &str, rev: Option<&str>, address: &str) -> Result<String> {
    Ok(declared_pairs(repo, span, rev)?
        .into_iter()
        .find(|(addr, _)| addr == address)
        .unwrap_or_else(|| panic!("{address} is not declared at {rev:?}"))
        .1)
}

/// The old-side `rk64:` token an anchor block's `index` line names.
fn old_token(diff: &str) -> String {
    diff.lines()
        .find_map(|l| l.strip_prefix("index "))
        .and_then(|rest| rest.split_once(".."))
        .map(|(old, _)| old.to_string())
        .unwrap_or_else(|| panic!("no index line in:\n{diff}"))
}

/// `n` files with distinct three-line blocks, all anchored, then one commit
/// that rotates the addresses among the recorded tokens. Every anchor is
/// broken by that commit and not one byte of content changed — the state a
/// content-keyed pairing cannot see, since a permutation of declarations
/// preserves both the address set and the content at every address.
fn rebinding_repo(span: &str, n: usize) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    for i in 0..n {
        let tag = (b'A' + i as u8) as char;
        repo.write_file(&format!("f{i}.txt"), &format!("{tag}-1\n{tag}-2\n{tag}-3\n"))?;
    }
    repo.commit_all("initial")?;
    for i in 0..n {
        repo.span_stdout(["add", span, &format!("f{i}.txt#L1-L3")])?;
    }
    repo.span_stdout(["why", span, "one block per file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rotate_address_column(&repo, span, n)?;
    repo.commit_all("rebind every anchor to its neighbour's block")?;
    Ok(repo)
}

/// Rotate a declaration's address column, leaving the token column alone:
/// every token now names a block it does not describe, while every address and
/// every byte in the repository stays exactly where it was.
fn rotate_address_column(repo: &TestRepo, span: &str, n: usize) -> Result<()> {
    let decl = repo.path().join(format!(".span/{span}"));
    let text = std::fs::read_to_string(&decl)?;
    let lines: Vec<&str> = text.lines().collect();
    let addresses: Vec<&str> = lines
        .iter()
        .filter_map(|l| l.split_once(' '))
        .filter(|(_, token)| token.starts_with("rk64:"))
        .map(|(addr, _)| addr)
        .collect();
    let mut rotated = String::new();
    let mut seen = 0;
    for line in &lines {
        match line.split_once(' ') {
            Some((_, token)) if token.starts_with("rk64:") => {
                rotated.push_str(&format!("{} {token}\n", addresses[(seen + 1) % n]));
                seen += 1;
            }
            _ => {
                rotated.push_str(line);
                rotated.push('\n');
            }
        }
    }
    // A rewrite that matched nothing produces a fixture that proves the
    // absence of a defect it never created.
    assert_ne!(
        rotated, text,
        "the declaration rewrite matched nothing:\n{text}"
    );
    std::fs::write(&decl, rotated)?;
    assert!(
        !repo.git_stdout(["status", "--porcelain"])?.is_empty(),
        "the declaration rewrite left the worktree clean"
    );
    Ok(())
}

/// A rebinding and a content edit landing in the *same* commit at the same
/// address — the composed state, and the one every other rebinding fixture
/// misses by pairing its rebinding with untouched content.
///
/// `f0.txt`'s block is rewritten in the rotation commit, so that address
/// carries both facts at once: its declaration now records a token describing
/// some other file's block, and its own bytes changed. A render that shows
/// only the content hunk describes an ordinary edit, and the repair an
/// ordinary edit invites is a re-hash — which here would permanently bind the
/// why-prose to content it was never written about.
fn rebound_and_edited_repo(span: &str, n: usize) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    for i in 0..n {
        let tag = (b'A' + i as u8) as char;
        repo.write_file(&format!("f{i}.txt"), &format!("{tag}-1\n{tag}-2\n{tag}-3\n"))?;
    }
    repo.commit_all("initial")?;
    for i in 0..n {
        repo.span_stdout(["add", span, &format!("f{i}.txt#L1-L3")])?;
    }
    repo.span_stdout(["why", span, "one block per file"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;

    rotate_address_column(&repo, span, n)?;
    repo.write_file("f0.txt", "A-1\nA-EDITED\nA-3\n")?;
    assert!(
        !repo
            .git_stdout(["diff", "--name-only", "--", "f0.txt"])?
            .is_empty(),
        "the content edit matched nothing, so no address carries both facts"
    );
    repo.commit_all("rebind every anchor and edit one of the blocks")?;
    Ok(repo)
}

/// A commit that breaks anchors must account for them. The declaration
/// permutation is invisible to a content comparison — same addresses, same
/// bytes at every one — so the timeline showed the one commit that broke every
/// anchor as the one commit with no anchor-level output, while `stale`
/// reported them all changed.
#[test]
fn no_commit_that_breaks_an_anchor_is_anchor_silent() -> Result<()> {
    for (label, n) in [("swap", 2), ("3-cycle rotation", 3)] {
        let span = "rb";
        let repo = rebinding_repo(span, n)?;
        // Nothing in any file changed; only the bindings moved.
        assert!(
            repo.git_stdout(["diff", "HEAD~1", "HEAD", "--", ".", ":(exclude).span"])?
                .is_empty(),
            "{label}: fixture assumption — the commit is declaration-only"
        );
        // ORACLE — `stale`. The worktree is exactly the breaking commit, so
        // `stale` here is `stale` evaluated at it.
        let stale = String::from_utf8_lossy(&repo.run_span(["stale"])?.stdout).into_owned();
        let broken: Vec<String> = stale
            .lines()
            .filter_map(|l| l.strip_prefix("- "))
            .filter(|l| l.contains(" — changed"))
            .filter_map(|l| l.split_once(' '))
            .map(|(addr, _)| addr.to_string())
            .collect();
        assert_eq!(
            broken.len(),
            n,
            "{label}: fixture assumption — every anchor is broken; got:\n{stale}"
        );

        let json = history_json(&repo, span)?;
        // Existence before absence: an entry that is not there satisfies every
        // negative assertion about its contents.
        let newest = &json["commits"][0];
        assert!(
            newest["summary"]
                .as_str()
                .is_some_and(|s| s.contains("rebind")),
            "{label}: the breaking commit has no timeline entry at all; got: {json:#}"
        );
        let anchors = newest["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no anchors array; got: {json:#}"));
        assert_eq!(
            anchors.len(),
            n,
            "{label}: the breaking commit must account for every anchor it \
             broke; got: {newest:#}"
        );
        for address in &broken {
            let anchor = anchor_at(anchors, address);
            let diff = anchor["diff"].as_str().expect("diff string");
            assert_eq!(
                block_form(diff),
                BlockForm::Rebound,
                "{label}: content is unchanged, so the block is the binding \
                 transition itself; got:\n{diff}"
            );
            assert!(
                !diff.contains("@@"),
                "{label}: nothing was edited, so there are no hunks; got:\n{diff}"
            );
        }

        // The current block was already right about a committed rebinding —
        // one honest in-place diff per broken anchor, recorded against live.
        // The timeline gains blocks; this loses none.
        //
        // This holds because every span resolves at `SameCommit`: the `[config]`
        // block is never parsed and `SpanConfig` is built from defaults at its
        // one construction site, so `any-file-in-repo` is unreachable. Under a
        // cross-file level the resolver could report a rotated anchor `Moved` —
        // its recorded bytes do sit intact in a sibling file — and the current
        // block would render `proposed anchor` lines instead of these in-place
        // diffs. Whoever makes that level reachable inherits this assumption.
        let current = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current block; got: {json:#}"));
        assert_eq!(
            current.len(),
            n,
            "{label}: one in-place diff per broken anchor; got: {json:#}"
        );
        for address in &broken {
            let anchor = anchor_at(current, address);
            assert_eq!(
                block_form(anchor["diff"].as_str().expect("diff string")),
                BlockForm::Modified,
                "{label}: the declared address is where the drift is; \
                 got: {anchor:#}"
            );
        }
    }
    Ok(())
}

/// Whether an address was rebound is a question about the declaration, and it
/// is answered per address — not per commit, and not only when the content
/// happens to have stood still.
///
/// The check used to be reachable only where a content diff rendered nothing,
/// so a commit that rebound an address *and* edited it rendered a benign
/// one-line hunk: the newly recorded token appeared nowhere in the block, and
/// the repair such a block invites is a re-hash — which would permanently bind
/// the why-prose to content it was never written about. The truth wants the
/// rebinding reverted.
#[test]
fn a_rebinding_that_also_edits_its_block_states_both_facts() -> Result<()> {
    let span = "rbe";
    let edited = "f0.txt#L1-L3";
    let repo = rebound_and_edited_repo(span, 3)?;

    // ORACLE — git. Exactly one file's bytes moved in the breaking commit, so
    // exactly one address carries both facts and the rest carry only the
    // rebinding. A fixture where nothing was edited would prove nothing here.
    let touched = repo.git_stdout([
        "diff",
        "--name-only",
        "HEAD~1",
        "HEAD",
        "--",
        ".",
        ":(exclude).span",
    ])?;
    assert_eq!(
        touched.lines().collect::<Vec<_>>(),
        ["f0.txt"],
        "fixture assumption — one edited file beside the rebinding; got:\n{touched}"
    );

    // ORACLE — `stale`. The worktree is exactly the breaking commit.
    let stale = String::from_utf8_lossy(&repo.run_span(["stale"])?.stdout).into_owned();
    let broken: Vec<String> = stale
        .lines()
        .filter_map(|l| l.strip_prefix("- "))
        .filter(|l| l.contains(" — changed"))
        .filter_map(|l| l.split_once(' '))
        .map(|(addr, _)| addr.to_string())
        .collect();
    assert_eq!(
        broken.len(),
        3,
        "fixture assumption — every anchor is broken; got:\n{stale}"
    );

    let json = history_json(&repo, span)?;
    // Existence before absence.
    let newest = &json["commits"][0];
    assert!(
        newest["summary"]
            .as_str()
            .is_some_and(|s| s.contains("rebind")),
        "the breaking commit has no timeline entry at all; got: {json:#}"
    );
    let anchors = newest["anchors"]
        .as_array()
        .unwrap_or_else(|| panic!("no anchors array; got: {json:#}"));

    // The criterion is per address: every address whose recorded token changed
    // carries a rebinding indication, whether or not a content diff renders
    // for it too. Read `(path, form)` pairs, not a bag of forms — a bag cannot
    // tell one address rendering both facts from two addresses rendering one
    // each, which is the entire distinction under test.
    let blocks = newest_commit_blocks(&repo, span)?;
    for address in &broken {
        assert!(
            blocks
                .iter()
                .any(|(p, f)| p == address && *f == BlockForm::Rebound),
            "{address} was rebound and the commit never says so; got: {blocks:?}"
        );
    }

    // Two objects at one address, neither contaminating the other. Block
    // identity here is `(path, form)`: keying by `path` alone would drop one
    // of them, and if the content block won, the rebinding would be invisible
    // to a consumer while both of this command's surfaces stayed correct.
    let mut at_edited: Vec<BlockForm> = blocks
        .iter()
        .filter(|(p, _)| p == edited)
        .map(|(_, f)| *f)
        .collect();
    at_edited.sort();
    let mut expected = vec![BlockForm::Rebound, BlockForm::Modified];
    expected.sort();
    assert_eq!(
        at_edited, expected,
        "the edited address states the rebinding and the edit; got: {blocks:?}"
    );
    let blocks = anchors_at(anchors, edited);

    // ORACLE — the declaration at the two commits, read from git. The token
    // the declaration now records must be visible in this address's render: a
    // block in which it appears nowhere cannot be describing a rebinding.
    let before = declared_token(&repo, span, Some("HEAD~1"), edited)?;
    let after = declared_token(&repo, span, Some("HEAD"), edited)?;
    assert_ne!(
        before, after,
        "fixture assumption — the declaration rebound {edited}"
    );
    let rebound = blocks
        .iter()
        .find(|a| timeline_form(a) == BlockForm::Rebound)
        .expect("the rebound block asserted above");
    // Structured fields, not a scan of the patch text: `rebound.from`/`.to`
    // are the contract a consumer reads, and they are spelled the way the
    // `.span` file spells them so either side joins against it directly.
    assert_eq!(
        rebound["rebound"]["from"], before,
        "the structured transition names the old binding; got: {rebound:#}"
    );
    assert_eq!(
        rebound["rebound"]["to"], after,
        "the structured transition names the new binding; got: {rebound:#}"
    );
    // Raw-patch parity: the `index` line and the structured fields are two
    // renderings of one pair of tokens and can never disagree.
    let diff = rebound["diff"].as_str().expect("diff string");
    assert_eq!(old_token(diff), before, "the index line names the old binding");
    assert_eq!(new_token(diff), after, "the index line names the new binding");

    // ORACLE — git's own diff of the edited file. The content block answers
    // the same question any `Modified` block answers, and the rebound block
    // beside it must not have absorbed or displaced its hunks.
    let content = blocks
        .iter()
        .find(|a| block_form(a["diff"].as_str().expect("diff string")) == BlockForm::Modified)
        .expect("the content block asserted above");
    let content_diff = content["diff"].as_str().expect("diff string");
    let added: Vec<&str> = content_diff
        .lines()
        .skip_while(|l| !l.starts_with("@@ "))
        .filter_map(|l| l.strip_prefix('+'))
        .collect();
    let git_added: Vec<String> = repo
        .git_stdout(["diff", "HEAD~1", "HEAD", "--", "f0.txt"])?
        .lines()
        .skip_while(|l| !l.starts_with("@@ "))
        .filter_map(|l| l.strip_prefix('+'))
        .map(str::to_string)
        .collect();
    assert_eq!(
        added, git_added,
        "the content block must show git's own edit; got:\n{content_diff}"
    );
    Ok(())
}

/// Every anchor block form the `current` section renders, in order.
fn current_forms(repo: &TestRepo, span: &str) -> Result<Vec<BlockForm>> {
    let json = history_json(repo, span)?;
    Ok(json["current"]["anchors"]
        .as_array()
        .unwrap_or_else(|| panic!("no current anchors in {json:#}"))
        .iter()
        .map(|a| block_form(a["diff"].as_str().expect("diff string")))
        .collect())
}

/// The block form of one timeline anchor object. An anchor that carries
/// `content` instead of `diff` is a first-add, which is the timeline's
/// spelling of `new anchor`.
fn timeline_form(anchor: &Value) -> BlockForm {
    // The structured discriminator, not a scan of the patch text. `rebound
    // anchor` is a phrase that appears in this repository's own tracked
    // source, so a consumer — or an oracle — that recognises the form by
    // string-matching the patch body has a live false-positive class.
    if anchor.get("rebound").is_some() {
        return BlockForm::Rebound;
    }
    match anchor["diff"].as_str() {
        Some(diff) => block_form(diff),
        None => BlockForm::Created,
    }
}

/// Every anchor block form the newest timeline entry renders, in order.
///
/// **Projection:** discards `path`. A `Vec<BlockForm>` cannot tell one address
/// rendering two facts from two addresses rendering one each — use
/// [`newest_commit_blocks`] wherever that distinction is the point.
fn newest_commit_forms(repo: &TestRepo, span: &str) -> Result<Vec<BlockForm>> {
    Ok(newest_commit_blocks(repo, span)?
        .into_iter()
        .map(|(_, form)| form)
        .collect())
}

/// Every anchor block the newest timeline entry renders, as `(path, form)`.
///
/// Block identity in the timeline array is the *pair*, not `path` alone: one
/// address renders two objects whenever two independent facts are true of it
/// at once — a rebinding and a content edit in the same commit. A reader that
/// keeps only the forms can assert that both facts appear somewhere in the
/// entry; only this one can assert that they appear at the same address.
fn newest_commit_blocks(repo: &TestRepo, span: &str) -> Result<Vec<(String, BlockForm)>> {
    let json = history_json(repo, span)?;
    Ok(json["commits"][0]["anchors"]
        .as_array()
        .unwrap_or_else(|| panic!("no anchors on the newest commit in {json:#}"))
        .iter()
        .map(|a| {
            (
                a["path"].as_str().expect("path string").to_string(),
                timeline_form(a),
            )
        })
        .collect())
}

/// The same declaration change must describe the same event whether it is
/// still in the worktree or already committed. The timeline path has enforced
/// git's rename floor since it was written ([`pair_anchors`]); the current
/// block bypassed it, so one re-anchor rendered as a 0% rename before the
/// commit and as `deleted anchor` + `new anchor` after — the same edit
/// reported two incompatible ways, one of which asserts a rewrite nobody made.
#[test]
fn the_current_block_and_the_timeline_agree_on_a_reanchors_form() -> Result<()> {
    // Below the floor: two unrelated blocks.
    let repo = abandoned_block_repo("re2")?;
    let mut before = current_forms(&repo, "re2")?;
    repo.commit_all("re-anchor onto the other block")?;
    let mut after = newest_commit_forms(&repo, "re2")?;
    // The two paths order their blocks differently; the claim is about which
    // blocks the event produces, not the sequence they print in.
    before.sort();
    after.sort();
    assert_eq!(
        before, after,
        "the same re-anchor, committed or not, is the same event"
    );
    assert!(
        before.contains(&BlockForm::Deleted) && before.contains(&BlockForm::Created),
        "unrelated blocks do not pair; got: {before:?}"
    );

    // At or above it: one anchor, edited and moved.
    let repo = drifted_repo("re")?;
    rewrite_declaration(&repo, "re", "f.txt#L1-L3", "f.txt#L3-L5")?;
    let before = current_forms(&repo, "re")?;
    repo.commit_all("re-anchor onto the drifted block")?;
    let after = newest_commit_forms(&repo, "re")?;
    assert_eq!(
        before, after,
        "a rename before the commit is the same rename after it, similarity \
         and all"
    );
    assert!(
        matches!(
            before.as_slice(),
            [BlockForm::Renamed {
                similarity: Some(similarity)
            }] if *similarity >= 50
        ),
        "an edited move stays one anchor; got: {before:?}"
    );
    Ok(())
}

/// One repository per shape a *timeline* anchor block can take, with the block
/// forms its newest commit entry must render.
///
/// The two render paths do not share a state space, which is why this exists
/// beside [`every_current_state`] instead of extending it. `Proposed` is
/// current-block-only — the resolver's move instruction is about the working
/// tree, and there is nothing to propose about a commit that already happened.
/// `Rebound` is timeline-only — a rebinding is a transition between two
/// committed declaration states. Enumerating one path's states and calling it
/// the enumeration is exactly how `Rebound` came to be hand-entered into the
/// oracle map after the fact.
///
/// The expected forms are written out per fixture rather than derived, so a
/// change in what a state renders shows up here as a diff rather than as a
/// sweep that quietly checks a different thing.
fn every_timeline_state() -> Result<Vec<(&'static str, TestRepo, &'static str, Vec<BlockForm>)>> {
    let committed_drift = {
        let repo = drifted_repo("tdrift")?;
        repo.commit_all("edit the anchored block")?;
        repo
    };
    let committed_reanchor = {
        let repo = drifted_repo("tre")?;
        rewrite_declaration(&repo, "tre", "f.txt#L1-L3", "f.txt#L3-L5")?;
        repo.commit_all("re-anchor onto the drifted block")?;
        repo
    };
    let first_declaration = {
        let repo = TestRepo::new()?;
        repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
        repo.commit_all("initial")?;
        repo.span_stdout(["add", "tnew", "f.txt#L1-L3"])?;
        repo.span_stdout(["why", "tnew", "three greek letters"])?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "declare"])?;
        repo
    };
    // An anchor abandoned for an unrelated block in another file: nothing
    // pairs, so the commit renders two independent events rather than one
    // rename asserting an edit between texts that share nothing.
    let unrelated_move = {
        let repo = TestRepo::new()?;
        repo.write_file("f.txt", "AAA-1\nAAA-2\nAAA-3\n")?;
        repo.write_file("g.txt", "BBB-1\nBBB-2\nBBB-3\n")?;
        repo.commit_all("initial")?;
        repo.span_stdout(["add", "tmv", "f.txt#L1-L3"])?;
        repo.span_stdout(["why", "tmv", "the first block"])?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "declare"])?;
        rewrite_declaration(&repo, "tmv", "f.txt#L1-L3", "g.txt#L1-L3")?;
        repo.commit_all("abandon the block for an unrelated one")?;
        repo
    };
    // The anchored file is deleted while the declaration still names it: the
    // new side has no bytes at all, which is the timeline's only producer of
    // `unavailable`. Without it that key would need an exemption in the field
    // sweep's reverse direction, and an exemption is how a key stops being
    // checked.
    let vanished_file = {
        let repo = drifted_repo("tgone")?;
        std::fs::remove_file(repo.path().join("f.txt"))?;
        repo.commit_all("delete the anchored file")?;
        repo
    };
    // The commit path's own past-EOF verdict, enumerated so the reference
    // implementation the worktree path was conformed to is itself under the
    // sweeps rather than being trusted because it was correct once.
    let truncated = {
        let repo = truncated_past_eof_repo("ttrunc")?;
        repo.commit_all("truncate below the declared range")?;
        repo
    };
    // Both states carry the null hash and an empty body, so the commit that
    // moves between them is invisible to every content comparison there is.
    let past_eof_then_deleted = {
        let repo = truncated_past_eof_repo("tboth")?;
        repo.commit_all("truncate below the declared range")?;
        repo.run_git(["rm", "f.txt"])?;
        repo.run_git(["commit", "-m", "delete the file outright"])?;
        repo
    };
    // The timeline's producer of `unavailable: "binary"`. Without it that
    // *value* has no producer on this array, and the field sweep only compares
    // key names — which is how a documented value shipped with no producer
    // anywhere in the tree.
    let binarized = {
        let repo = TestRepo::new()?;
        repo.write_file("f.bin", "alpha\nbeta\ngamma\n")?;
        repo.commit_all("initial")?;
        repo.span_stdout(["add", "tbin", "f.bin"])?;
        repo.span_stdout(["why", "tbin", "the pinned file"])?;
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "declare"])?;
        repo.write_file_bytes("f.bin", b"BIN\x00\xff\xfe-two\n")?;
        repo.commit_all("replace the text with bytes")?;
        repo
    };
    Ok(vec![
        ("first declaration", first_declaration, "tnew", vec![BlockForm::Created]),
        (
            "anchored file deleted",
            vanished_file,
            "tgone",
            vec![BlockForm::Modified],
        ),
        (
            "declared range truncated past its end",
            truncated,
            "ttrunc",
            vec![BlockForm::Modified],
        ),
        (
            "past-EOF range then the file deleted",
            past_eof_then_deleted,
            "tboth",
            vec![BlockForm::Modified],
        ),
        (
            "anchored text replaced by bytes",
            binarized,
            "tbin",
            vec![BlockForm::Modified],
        ),
        ("committed drift", committed_drift, "tdrift", vec![BlockForm::Modified]),
        (
            "committed re-anchor at the floor",
            committed_reanchor,
            "tre",
            vec![BlockForm::Renamed { similarity: Some(66) }],
        ),
        (
            "committed abandonment for an unrelated block",
            unrelated_move,
            "tmv",
            vec![BlockForm::Deleted, BlockForm::Created],
        ),
        (
            "committed rebinding",
            rebinding_repo("tro", 3)?,
            "tro",
            vec![BlockForm::Rebound; 3],
        ),
        (
            "committed rebinding with an edit",
            rebound_and_edited_repo("trbe", 3)?,
            "trbe",
            vec![
                BlockForm::Rebound,
                BlockForm::Rebound,
                BlockForm::Rebound,
                BlockForm::Modified,
            ],
        ),
    ])
}

/// Every invariant a *timeline* block must satisfy, checked across every shape
/// the timeline can render, each branch naming the oracle outside `history`'s
/// renderer that anchors it.
#[test]
fn timeline_block_invariants_hold_in_every_state() -> Result<()> {
    let mut covered: Vec<BlockForm> = Vec::new();
    for (label, repo, span, expected) in every_timeline_state()? {
        let json = history_json(&repo, span)?;
        // Existence before absence: an entry that is not there satisfies every
        // negative assertion about its contents.
        let newest = &json["commits"][0];
        let hash = newest["hash"]
            .as_str()
            .unwrap_or_else(|| panic!("{label}: the newest commit has no entry; got: {json:#}"));
        let anchors = newest["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no anchors array; got: {newest:#}"));
        let mut forms: Vec<BlockForm> = anchors.iter().map(timeline_form).collect();
        forms.sort();
        let mut want = expected.clone();
        want.sort();
        assert_eq!(
            forms, want,
            "{label}: the enumeration and the render disagree; got: {newest:#}"
        );
        covered.extend(forms.iter().copied());

        // ORACLE — the declaration at this commit and its parent, read from
        // git. Every timeline block is a claim about what changed between two
        // committed declaration states, so that pair of files answers all of
        // them without sharing a line with the renderer.
        let now = declared_pairs(&repo, span, Some(hash))?;
        let before = declared_pairs(&repo, span, Some(&format!("{hash}~1"))).unwrap_or_default();
        for anchor in anchors {
            let path = anchor["path"].as_str().expect("path string");
            // A first-add carries `content` and no `diff`: there is no old
            // side to diff against, and the form is a creation by
            // construction. Its oracle is the declaration pair, same as any
            // other creation.
            let Some(diff) = anchor["diff"].as_str() else {
                assert!(
                    now.iter().any(|(a, _)| a == path),
                    "{label}: {path} is not declared at this commit; got: {anchor:#}"
                );
                assert!(
                    !before.iter().any(|(a, _)| a == path),
                    "{label}: {path} was already declared; got: {anchor:#}"
                );
                continue;
            };
            let header = diff.lines().next().unwrap_or_default();
            let (a_side, b_side) = header
                .strip_prefix("diff --git a/")
                .and_then(|rest| rest.split_once(" b/"))
                .unwrap_or_else(|| panic!("{label}: malformed header {header:?}"));
            let bound = |pairs: &[(String, String)], addr: &str, token: &str| {
                pairs
                    .iter()
                    .any(|(a, t)| a == addr && t == token)
            };
            match block_form(diff) {
                BlockForm::Deleted => {
                    assert!(
                        bound(&before, a_side, &old_token(diff)),
                        "{label}: {a_side} never held this binding before; got:\n{diff}"
                    );
                    assert!(
                        !now.iter().any(|(a, _)| a == a_side),
                        "{label}: {a_side} is still declared; got:\n{diff}"
                    );
                }
                BlockForm::Created => {
                    assert!(
                        now.iter().any(|(a, _)| a == b_side),
                        "{label}: {b_side} is not declared at this commit; got:\n{diff}"
                    );
                    assert!(
                        !before.iter().any(|(a, _)| a == b_side),
                        "{label}: {b_side} was already declared; got:\n{diff}"
                    );
                }
                // A rebinding says the address stood still while the token
                // under it changed — both halves readable straight off the two
                // declaration files.
                BlockForm::Rebound => {
                    assert_eq!(a_side, path, "{label}: a rebinding stands still");
                    assert_eq!(b_side, path, "{label}: a rebinding stands still");
                    assert!(
                        !diff.contains("@@"),
                        "{label}: the token transition is the whole block; got:\n{diff}"
                    );
                    assert!(
                        bound(&before, path, &old_token(diff))
                            && bound(&now, path, &new_token(diff)),
                        "{label}: the index line must name the two recorded \
                         bindings; got:\n{diff}"
                    );
                    assert_ne!(
                        old_token(diff),
                        new_token(diff),
                        "{label}: an unchanged binding is not a rebinding"
                    );
                    // Raw-patch parity: the structured fields and the `index`
                    // line render one pair of tokens two ways.
                    assert_eq!(
                        anchor["rebound"]["from"], old_token(diff),
                        "{label}: structured and patch disagree; got: {anchor:#}"
                    );
                    assert_eq!(
                        anchor["rebound"]["to"], new_token(diff),
                        "{label}: structured and patch disagree; got: {anchor:#}"
                    );
                }
                // The same token, declared at one address before and another
                // after: the move is the declaration's own statement.
                BlockForm::Renamed { similarity } => {
                    let token = old_token(diff);
                    assert!(
                        bound(&before, a_side, &token) && bound(&now, b_side, &token),
                        "{label}: a rename must carry one binding between two \
                         addresses; got:\n{diff}"
                    );
                    assert!(
                        similarity.is_some_and(|s| s >= 50),
                        "{label}: timeline pairing excludes non-text bodies, so \
                         every rename it renders is measured and at the floor; \
                         got:\n{diff}"
                    );
                }
                BlockForm::Modified => {
                    assert_eq!(a_side, path, "{label}: a modification stands still");
                    assert_eq!(b_side, path, "{label}: a modification stands still");
                    assert!(
                        now.iter().any(|(a, _)| a == path),
                        "{label}: {path} is not declared at this commit; got:\n{diff}"
                    );
                }
                // The resolver's move instruction is about the working tree.
                // A commit that already happened has nothing to propose.
                BlockForm::Proposed => panic!("{label}: the timeline never proposes:\n{diff}"),
            }
        }
    }
    // The enumeration is only worth what it covers. `Proposed` is deliberately
    // absent — it belongs to the other path — and its absence is asserted
    // above rather than assumed here.
    for form in [
        BlockForm::Deleted,
        BlockForm::Created,
        BlockForm::Rebound,
        BlockForm::Modified,
    ] {
        assert!(
            covered.contains(&form),
            "no timeline fixture reaches {form:?}; the enumeration is short"
        );
    }
    assert!(
        covered
            .iter()
            .any(|f| matches!(f, BlockForm::Renamed { .. })),
        "no timeline fixture reaches a rename; the enumeration is short"
    );
    Ok(())
}

/// A re-anchor the renderer cannot measure still states the move — the user's
/// declaration asserted it — but states nothing about how alike the two blocks
/// are, because it could not read one of them.
///
/// The two verdicts are different and must not be conflated. *Continuity
/// disproven* (both sides readable, similarity below git's floor) means the
/// two blocks are unrelated, and the honest render is `deleted anchor` + `new
/// anchor`. *Continuity unknown* (the recorded side is unrecoverable) means
/// nothing was disproven; splitting it would fabricate a delete and a create
/// where the user declared one move, and measuring it through the
/// empty-string fallback fabricates a number — which is how a confident
/// `similarity index 0%` came to sit one line above `recorded snapshot
/// unrecoverable`.
#[test]
fn an_unmeasurable_reanchor_states_the_move_and_no_similarity() -> Result<()> {
    let repo = unrecoverable_reanchor_repo("ur")?;
    let json = history_json(&repo, "ur")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    // Existence before absence, and the declared move is one event.
    assert_eq!(anchors.len(), 1, "one declared move; got: {json:#}");
    let anchor = &anchors[0];
    assert_eq!(
        anchor["recorded"], "unrecoverable",
        "fixture assumption — the recorded side is unreadable; got: {anchor:#}"
    );
    let diff = anchor["diff"].as_str().expect("diff string");
    assert_eq!(
        block_form(diff),
        BlockForm::Renamed { similarity: None },
        "a declared move with nothing to measure; got:\n{diff}"
    );
    assert!(
        diff.contains("rename from f.txt#L1-L3\n") && diff.contains("rename to f.txt#L5-L7\n"),
        "the declaration asserted the move, so the block states it; got:\n{diff}"
    );
    assert!(
        !diff.contains("similarity index"),
        "there was nothing to measure; got:\n{diff}"
    );
    assert!(
        !diff.contains("@@"),
        "hunks would have to invent the side just declared unreadable; got:\n{diff}"
    );
    // The marker is unqualified: the search behind it ran across every
    // snapshot in the render, not merely under this anchor's own address.
    assert!(
        diff.contains("\nrecorded snapshot unrecoverable\n"),
        "an empty body needs its explanation; got:\n{diff}"
    );
    // The JSON `diff` string is the same bytes as the default output's block,
    // so a consumer never needs a caveat saying the number inside it is
    // meaningless — the number does not exist.
    let out = history_text(&repo, "ur")?;
    assert!(out.contains(diff), "both formats carry the same block:\n{out}");
    Ok(())
}

/// One repository per shape a `current` anchor can take, labelled. Every
/// property asserted over the current block is asserted over this whole set,
/// so a state that only one fixture reaches cannot drift unobserved.
fn every_current_state() -> Result<Vec<(&'static str, TestRepo, &'static str)>> {
    Ok(vec![
        ("resolver relocation", swap_repo()?, "swap"),
        ("declaration swap", declaration_swap_repo("dswap")?, "dswap"),
        (
            "re-anchor over relocation",
            reanchor_over_relocation_repo("both")?,
            "both",
        ),
        ("in-place drift", drifted_repo("ch")?, "ch"),
        ("cross-file swap", cross_file_swap_repo("xswap")?, "xswap"),
        ("abandoned block", abandoned_block_repo("re2")?, "re2"),
        ("never recorded", never_recorded_repo("ff")?, "ff"),
        ("twin tokens", twin_token_repo("twin")?, "twin"),
        ("drifted re-anchor", {
            let repo = drifted_repo("re")?;
            rewrite_declaration(&repo, "re", "f.txt#L1-L3", "f.txt#L3-L5")?;
            repo
        }, "re"),
        (
            "re-anchor with unrecoverable recorded token",
            unrecoverable_reanchor_repo("ur")?,
            "ur",
        ),
        ("binary re-anchor", binary_reanchor_repo("bin")?, "bin"),
        // The three states that render with a null hash, one fixture each.
        // Two of the three used to be indistinguishable from a third state in
        // every field a consumer can read, which is why they are enumerated
        // here rather than living only in the test that compares them.
        (
            "re-anchor past end of file",
            reanchored_past_eof_repo("pe2")?,
            "pe2",
        ),
        (
            "truncated below the declared range",
            truncated_past_eof_repo("tp2")?,
            "tp2",
        ),
        (
            "anchored file absent",
            vanished_worktree_file_repo("na2")?,
            "na2",
        ),
        (
            "empty recorded extent",
            empty_extent_reanchor_repo("nz2")?,
            "nz2",
        ),
    ])
}

/// A re-anchor whose recorded bytes cannot be read anywhere — the product of
/// two states already enumerated above ("never recorded" and "drifted
/// re-anchor"), and the one where a similarity number has nothing to measure.
///
/// The declaration is committed in the same commit that drifts the block it
/// names, so no state the walk renders ever hashes to the recorded token; then
/// the worktree moves the declared address, making the current state a
/// re-anchor. Both sides of the comparison a rename would assert are therefore
/// unavailable on the recorded side — and `text()` answers `""` for an
/// unavailable body, which is how a confident `similarity index 0%` came to
/// sit directly above the line saying the side could not be read.
fn unrecoverable_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file(
        "f.txt",
        "AAA-1\nAAA-2\nAAA-3\nmiddle\nCCC-1\nCCC-2\nCCC-3\n",
    )?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "the first block"])?;
    // The declaration and the drift land together, so the recorded token names
    // bytes that no rendered state in this walk ever held.
    repo.write_file(
        "f.txt",
        "ZZZ-1\nZZZ-2\nZZZ-3\nmiddle\nCCC-1\nCCC-2\nCCC-3\n",
    )?;
    repo.commit_all("declare and drift in one commit")?;

    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L5-L7")?;
    assert!(
        !repo.git_stdout(["status", "--porcelain"])?.is_empty(),
        "the declaration rewrite left the worktree clean"
    );
    Ok(repo)
}

/// A whole-file pin on a non-UTF-8 file, committed, then re-anchored in the
/// worktree to a *different* non-UTF-8 file. The recorded token is the binary
/// fingerprint of `a.bin`, and the same render's declare entry prints that
/// token as first-add content — so nothing about this state is lost, and no
/// side of it may be decoded as prose.
fn binary_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file_bytes("a.bin", b"BINA\x00\xff\xfe-one\n")?;
    repo.write_file_bytes("b.bin", b"BINB\x00\xfe\xff-two\n")?;
    repo.commit_all("binaries")?;
    repo.span_stdout(["add", span, "a.bin"])?;
    repo.span_stdout(["why", span, "the binary block"])?;
    repo.commit_all("declare the binary pin")?;
    rewrite_declaration(&repo, span, "a.bin", "b.bin")?;
    Ok(repo)
}

/// The worktree read path applies the same decoding policy as the commit read
/// path: non-UTF-8 content is `unavailable: "binary"` — structural, never a
/// lossily-decoded `content` string of control bytes and U+FFFD replacement
/// characters. The module contract says unextractable content is structural,
/// never prose, and a lossy decode is prose wearing content's key.
#[test]
fn a_binary_live_side_is_structural_never_lossy_prose() -> Result<()> {
    let repo = binary_reanchor_repo("bin")?;
    let json = history_json(&repo, "bin")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one declared move; got: {json:#}");
    let anchor = &anchors[0];
    assert_eq!(
        anchor["unavailable"], "binary",
        "the live bytes are not UTF-8, exactly as a commit read would say; \
         got: {anchor:#}"
    );
    assert!(
        anchor.get("content").is_none(),
        "no honest text exists for these bytes; got: {anchor:#}"
    );
    let raw = serde_json::to_string(&json)?;
    assert!(
        !raw.contains('\u{FFFD}'),
        "a replacement character is a lossy decode leaking through as \
         content:\n{raw}"
    );
    Ok(())
}

/// A binary recorded side whose token is rendered as first-add content in the
/// same output is recoverable by that render's own account: the by-hash search
/// behind `recorded: "unrecoverable"` runs over every snapshot the render
/// produced, binary ones included. The block states the declared move with
/// git's binary line and no similarity — nothing can be measured, and nothing
/// was lost.
#[test]
fn a_binary_recorded_side_is_recovered_not_declared_lost() -> Result<()> {
    let repo = binary_reanchor_repo("bin")?;
    let json = history_json(&repo, "bin")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one declared move; got: {json:#}");
    let anchor = &anchors[0];
    assert!(
        anchor.get("recorded").is_none(),
        "the recorded token is rendered as first-add content in this very \
         output, so it is not lost; got: {anchor:#}"
    );
    let diff = anchor["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("rename from a.bin\n") && diff.contains("rename to b.bin\n"),
        "the declaration asserted the move, so the block states it; got:\n{diff}"
    );
    assert!(
        diff.contains("Binary files "),
        "two binary sides have no hunks — git's own line says so; got:\n{diff}"
    );
    assert!(
        !diff.contains("similarity index"),
        "binary sides cannot be measured; got:\n{diff}"
    );
    assert!(
        !diff.contains("recorded snapshot unrecoverable"),
        "a loss claim the same render disproves; got:\n{diff}"
    );
    Ok(())
}

/// Every invariant the current block must satisfy no matter which state an
/// anchor is in, checked across every shape at once.
///
/// The predicates these enforce were each, at some point, guaranteed only by
/// the presence of one line of code — so replacing that line reopened the
/// defect with the suite still green. Asserting the property instead of the
/// output string is what makes the next replacement fail loudly.
#[test]
fn current_block_invariants_hold_in_every_state() -> Result<()> {
    for (label, repo, span) in every_current_state()? {
        let stale = String::from_utf8_lossy(&repo.run_span(["stale"])?.stdout).into_owned();
        let render = history_text(&repo, span)?;
        // Nothing in the product produces this line any more, on either render
        // path: a measurable pair below the floor splits into two blocks, and
        // an unmeasurable one omits the number instead of inventing it. The
        // cheapest possible regression check for both, over the whole render.
        assert!(
            !render.contains("similarity index 0%"),
            "{label}: `similarity index 0%` has no producer left; got:\n{render}"
        );
        // Git omits a hunk side's length when it is 1 (`@@ -2 +4 @@`). The
        // rendered patch is promised to be git's own dialect, and `git apply`
        // reads the short form.
        for header in render.lines().filter(|l| l.starts_with("@@ ")) {
            for side in header.trim_start_matches("@@ ").split(' ').take(2) {
                assert!(
                    !side.ends_with(",1"),
                    "{label}: git spells a one-line side without its count; \
                     got: {header:?}"
                );
            }
        }
        let json = history_json(&repo, span)?;
        let anchors = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"));
        assert!(!anchors.is_empty(), "{label}: nothing to check");
        for anchor in anchors {
            let path = anchor["path"].as_str().expect("path string");
            let diff = anchor["diff"].as_str().expect("diff string");
            let header = diff.lines().next().unwrap_or_default();
            let (a_side, b_side) = header
                .strip_prefix("diff --git a/")
                .and_then(|rest| rest.split_once(" b/"))
                .unwrap_or_else(|| panic!("{label}: malformed header {header:?}"));

            // Which of the five block forms this is, read off the header
            // lines. Each form below names the source of truth outside
            // `history`'s renderer that anchors it — a form added without one
            // fails here rather than passing on the strength of the code that
            // produced it.
            let form = block_form(diff);
            match form {
                // ORACLE — the worktree declaration and HEAD's copy of it.
                // A `deleted anchor` says this address is no longer declared;
                // a `new anchor` says it now is.
                BlockForm::Deleted => {
                    assert_eq!(a_side, path, "{label}: a deletion wears its own address");
                    assert_eq!(b_side, "dev/null", "{label}: nothing arrives; got:\n{diff}");
                    let bound = (path.to_string(), old_token(diff));
                    assert!(
                        !declared_pairs(&repo, span, None)?.contains(&bound),
                        "{label}: {bound:?} is still declared, so nothing was dropped"
                    );
                    assert!(
                        declared_pairs(&repo, span, Some("HEAD"))?.contains(&bound),
                        "{label}: {bound:?} was never declared in HEAD either"
                    );
                }
                BlockForm::Created => {
                    assert_eq!(a_side, "dev/null", "{label}: nothing left; got:\n{diff}");
                    assert_eq!(b_side, path, "{label}: a creation wears its own address");
                    assert!(
                        declared_pairs(&repo, span, None)?
                            .iter()
                            .any(|(addr, _)| addr == path),
                        "{label}: {path} is not declared, so nothing arrived"
                    );
                }
                // ORACLE — the render's own account of what it could read,
                // produced by a different predicate than the one that decides
                // the header (the recorded snapshot is looked for by content
                // hash across the whole render), plus git's measured rename
                // behaviour: `git mv` with a total replacement renders `new
                // file` + `deleted file` even at `--find-renames=0%`.
                //
                // Two distinct questions, kept apart. *Was there a move?* is
                // answered by the declaration — a re-anchor is the user moving
                // a recorded token between addresses — so the rename lines are
                // never in doubt. *How alike are the two blocks?* is a
                // measurement, and the `similarity index` line may appear
                // exactly when there were two texts to measure. Its absence is
                // therefore a positive claim ("unknown"), which is why this is
                // a biconditional and not a lower bound: a bound alone passes
                // vacuously on a block that simply omits the line, and the
                // defect this replaced was a `similarity index 0%` sitting
                // directly above `recorded snapshot unrecoverable`.
                BlockForm::Renamed { similarity } => {
                    assert_eq!(b_side, path, "{label}: the b/ side is the declared address");
                    // Three ways a side can fail to be text: the recorded one
                    // is unrecoverable, either one is binary, or the live one
                    // has no bytes at all — a file that is gone, or a declared
                    // range that starts past its end. The last is why this
                    // reads `unavailable`: a range the file does not have is
                    // not an empty string, and measuring against one decided
                    // the disproven-versus-unknown question by fabrication.
                    let measurable = anchor.get("recorded")
                        != Some(&Value::from("unrecoverable"))
                        && !diff.contains("Binary files ")
                        && anchor.get("unavailable").is_none();
                    assert_eq!(
                        similarity.is_some(),
                        measurable,
                        "{label}: a rename carries a similarity index exactly \
                         when both sides are text; got:\n{diff}"
                    );
                    // Continuity disproven (measurable, below the floor) is a
                    // different verdict from continuity unknown (unmeasurable):
                    // the first splits into two unrelated blocks, the second
                    // stays one declaration-asserted move with no number.
                    if let Some(similarity) = similarity {
                        assert!(
                            similarity >= 50,
                            "{label}: git emits no rename below 50%; got:\n{diff}"
                        );
                    }
                    // ORACLE — the worktree. A rename's hunks assert that the
                    // recorded bytes *became* the live ones. If those bytes
                    // are still sitting untouched at the old address, no such
                    // edit happened and the hunk is fabricated.
                    let recorded_lines: String = diff
                        .lines()
                        .skip_while(|l| !l.starts_with("@@ "))
                        .filter_map(|l| l.strip_prefix('-'))
                        .map(|l| format!("{l}\n"))
                        .collect();
                    if !recorded_lines.is_empty() {
                        if let Some(still_there) = read_address(&repo, a_side) {
                            assert!(
                                !still_there.contains(&recorded_lines),
                                "{label}: the block claims these lines were \
                                 edited away, but {a_side} still holds them:\n{diff}"
                            );
                        }
                    }
                }
                // ORACLE — the recorded bindings in the two declaration
                // states, read from git. A rebinding block claims the address
                // stood still while its token moved.
                BlockForm::Rebound => {
                    assert_eq!(a_side, path, "{label}: a rebinding stands still");
                    assert_eq!(b_side, path, "{label}: a rebinding stands still");
                    assert!(
                        !diff.contains("@@"),
                        "{label}: a rebinding edits nothing; got:\n{diff}"
                    );
                }
                BlockForm::Proposed | BlockForm::Modified => {
                    assert_eq!(b_side, path, "{label}: the b/ side is the declared address");
                }
            }

            match anchor.get("proposed").and_then(Value::as_str) {
                Some(proposed) => {
                    // A proposal relabels nothing: it is an instruction to move,
                    // so a header claiming the move already happened would point
                    // the opposite way from the instruction beside it.
                    assert_eq!(
                        a_side, path,
                        "{label}: a proposal must not relabel the old side; got:\n{diff}"
                    );
                    assert!(
                        diff.contains(&format!("proposed anchor {proposed}\n")),
                        "{label}: the marker names the proposal; got:\n{diff}"
                    );
                    assert!(
                        !diff.contains("rename from"),
                        "{label}: a proposal is never a completed rename; got:\n{diff}"
                    );
                    assert!(
                        stale.contains(&format!("{path} — moved to {proposed}")),
                        "{label}: the proposal must agree with stale; got:\n{stale}"
                    );
                    assert!(
                        anchor.get("recorded").is_none(),
                        "{label}: a relocation's old side is always recoverable; \
                         got: {anchor:#}"
                    );
                }
                None => assert!(
                    !diff.contains("proposed anchor"),
                    "{label}: no proposal field, so no proposal line; got:\n{diff}"
                ),
            }

            // `path` and `content` must name the same bytes. The one exception
            // is a relocation, whose whole point is that the recorded bytes are
            // *not* at the declared address — and which says so in `proposed`.
            // A deletion's `content` is the bytes leaving, which the address
            // they leave need not still hold.
            if anchor.get("proposed").is_none() && !matches!(form, BlockForm::Deleted) {
                if let (Some(content), Some(actual)) =
                    (anchor["content"].as_str(), read_address(&repo, path))
                {
                    assert_eq!(
                        content, actual,
                        "{label}: `content` must be the bytes at `path`"
                    );
                }
            }

            // The marker appears exactly where the structured field does, and
            // nowhere else: it is a claim of lost data, and a spurious one
            // invites a destructive remedy.
            let claims_loss = diff.contains("recorded snapshot unrecoverable");
            assert_eq!(
                claims_loss,
                anchor.get("recorded") == Some(&Value::from("unrecoverable")),
                "{label}: the marker and the `recorded` field must agree; \
                 got: {anchor:#}"
            );
            if claims_loss {
                // The strongest available refutation: if the token's bytes are
                // rendered as live content anywhere in this same output, the
                // claim of loss is false, however the predicate is written.
                let token = diff
                    .lines()
                    .find_map(|l| l.strip_prefix("index rk64:"))
                    .and_then(|rest| rest.split_once(".."))
                    .map(|(old, _)| old.to_string())
                    .unwrap_or_else(|| panic!("{label}: no index line in:\n{diff}"));
                let live_elsewhere = format!("..rk64:{token}");
                let contradicted = render
                    .lines()
                    .filter(|line| line.starts_with("index "))
                    .filter(|line| !diff.contains(*line))
                    .any(|line| line.ends_with(&live_elsewhere));
                assert!(
                    !contradicted,
                    "{label}: rk64:{token} is rendered as live content \
                     elsewhere in this very output, so it is not lost:\n{render}"
                );
            }
        }
    }
    Ok(())
}

/// The keys the normative field list in `docs/history-example-output.md`
/// declares for one anchor array (`commits[].anchors[]` or
/// `current.anchors[]`), read out of the document itself so the contract
/// cannot be satisfied by a stale copy of it living in a test.
///
/// The two arrays get separate lists because their emitters have inverted
/// presence rules — one list covering both would have to be vague enough to be
/// true of neither, and a sweep against it would certify a false document.
fn documented_anchor_fields(array: &str) -> Result<Vec<String>> {
    let doc = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("docs")
            .join("history-example-output.md"),
    )?;
    let heading = format!("### `{array}` field list (normative)");
    let heading = heading.as_str();
    let start = doc
        .find(heading)
        .unwrap_or_else(|| panic!("the field list heading {heading:?} is gone from the doc"));
    let section = &doc[start + heading.len()..];
    // Stop at the next heading of any level: the two field lists are adjacent
    // `###` sections, so ending only at `## ` would silently merge them and
    // let each list vouch for the other's keys.
    let end = section
        .find("\n## ")
        .into_iter()
        .chain(section.find("\n### "))
        .min()
        .unwrap_or(section.len());
    let fields: Vec<String> = section[..end]
        .lines()
        .filter_map(|line| line.strip_prefix("- `"))
        .filter_map(|rest| rest.split_once('`'))
        .map(|(key, _)| key.to_string())
        .collect();
    assert!(!fields.is_empty(), "the field list parsed as empty");
    Ok(fields)
}

/// The values one documented field's bullet enumerates, read out of the same
/// normative list [`documented_anchor_fields`] reads its keys from.
///
/// The key sweeps compare *names*, which is an aperture one level too coarse: a
/// documented value with no producer anywhere stays green as long as some other
/// value keeps the key alive. `"range-past-eof"` was named on both normative
/// lists and had zero occurrences in the entire test tree, because the binary
/// fixture's `"binary"` was covering the key for it.
fn documented_field_values(array: &str, field: &str) -> Result<Vec<String>> {
    let doc = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("docs")
            .join("history-example-output.md"),
    )?;
    let heading = format!("### `{array}` field list (normative)");
    let start = doc
        .find(heading.as_str())
        .unwrap_or_else(|| panic!("the field list heading {heading:?} is gone from the doc"));
    let section = &doc[start + heading.len()..];
    let end = section
        .find("\n## ")
        .into_iter()
        .chain(section.find("\n### "))
        .min()
        .unwrap_or(section.len());
    // One bullet, from its own `- ` marker to the next one at column zero:
    // continuation lines are indented, so the bullet keeps its wrapped text and
    // stops before its sibling's.
    let bullet_start = format!("- `{field}` — ");
    let list = &section[..end];
    let at = list.find(bullet_start.as_str()).unwrap_or_else(|| {
        panic!("the {array} field list no longer documents `{field}`")
    });
    let bullet = &list[at..];
    let bullet_end = bullet[1..].find("\n- ").map(|i| i + 1).unwrap_or(bullet.len());
    let bullet = &bullet[..bullet_end];

    // Values are spelled as they appear in JSON, inside backticks: `"absent"`.
    // The span must be exactly one quoted token — no whitespace, and the
    // closing quote immediately followed by the closing backtick — so prose
    // that merely quotes JSON (`"content": ""`) does not read as a value.
    let mut values: Vec<String> = Vec::new();
    for piece in bullet.split("`\"").skip(1) {
        let Some((value, rest)) = piece.split_once('"') else {
            continue;
        };
        if !rest.starts_with('`') || value.is_empty() || value.contains(char::is_whitespace) {
            continue;
        }
        if !values.iter().any(|v| v == value) {
            values.push(value.to_string());
        }
    }
    assert!(
        !values.is_empty(),
        "the `{field}` bullet in the {array} list enumerates no values"
    );
    Ok(values)
}

/// Every `unavailable` value the `current` contract documents is produced by
/// some state in the enumeration.
///
/// The key sweep beside this one asks whether `unavailable` is emitted at all,
/// and one fixture answers that for every value at once. This asks the question
/// behind the key: a documented vocabulary word with no producer is a promise to
/// consumers that nothing in the product keeps, and main-195 would style a state
/// that never arrives.
#[test]
fn every_documented_current_unavailable_value_has_a_producer() -> Result<()> {
    let documented = documented_field_values("current.anchors[]", "unavailable")?;
    let mut seen: Vec<String> = Vec::new();
    for (label, repo, span) in every_current_state()? {
        let json = history_json(&repo, span)?;
        for anchor in json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"))
        {
            let Some(value) = anchor.get("unavailable") else {
                continue;
            };
            let value = value.as_str().expect("unavailable string").to_string();
            assert!(
                documented.contains(&value),
                "{label}: `unavailable: {value:?}` is emitted but undocumented; \
                 the list names {documented:?}"
            );
            if !seen.contains(&value) {
                seen.push(value);
            }
        }
    }
    for value in &documented {
        assert!(
            seen.contains(value),
            "the document promises `unavailable: {value:?}` on a current \
             anchor, but no state in the sweep produces it; seen: {seen:?}"
        );
    }
    Ok(())
}

/// The same value-level sweep for the *timeline* array against its own list —
/// separate for the same reason the key sweeps are separate: the two arrays have
/// different emitters, and one list vouching for the other's vocabulary is how a
/// sweep certifies a false document.
#[test]
fn every_documented_timeline_unavailable_value_has_a_producer() -> Result<()> {
    let documented = documented_field_values("commits[].anchors[]", "unavailable")?;
    let mut seen: Vec<String> = Vec::new();
    for (label, repo, span, _) in every_timeline_state()? {
        let json = history_json(&repo, span)?;
        for commit in json["commits"].as_array().expect("commits array") {
            for anchor in commit["anchors"]
                .as_array()
                .unwrap_or_else(|| panic!("{label}: no anchors array in {commit:#}"))
            {
                let Some(value) = anchor.get("unavailable") else {
                    continue;
                };
                let value = value.as_str().expect("unavailable string").to_string();
                assert!(
                    documented.contains(&value),
                    "{label}: `unavailable: {value:?}` is emitted but \
                     undocumented; the list names {documented:?}"
                );
                if !seen.contains(&value) {
                    seen.push(value);
                }
            }
        }
    }
    for value in &documented {
        assert!(
            seen.contains(value),
            "the document promises `unavailable: {value:?}` on a timeline \
             anchor, but no state in the sweep produces it; seen: {seen:?}"
        );
    }
    Ok(())
}

/// The document states the threshold as a rule and then shows worked examples
/// of it; the field-list guard compares names, not values, so a captured
/// example contradicting the rule 95 lines above it went unnoticed. This
/// compares the values.
#[test]
fn no_documented_example_shows_a_rename_below_the_threshold() -> Result<()> {
    let doc = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("docs")
            .join("history-example-output.md"),
    )?;
    let mut seen = 0;
    for line in doc.lines() {
        let Some(rest) = line.trim().strip_prefix("similarity index ") else {
            continue;
        };
        let percent: u8 = rest
            .trim_end_matches('%')
            .parse()
            .unwrap_or_else(|_| panic!("unparseable similarity line: {line:?}"));
        assert!(
            percent >= 50,
            "a worked example shows a rename git would never emit: {line:?}"
        );
        seen += 1;
    }
    assert!(seen > 0, "the rename form is no longer illustrated at all");
    Ok(())
}

/// The documented field list is the contract, so a key the renderer can emit
/// and the document does not name is a silent extension of it — which is how
/// `proposed`, `recorded`, and `unavailable` all shipped with zero mentions in
/// any markdown a consumer would read.
#[test]
fn every_current_anchor_key_appears_in_the_documented_field_list() -> Result<()> {
    let documented = documented_anchor_fields("current.anchors[]")?;
    let mut seen: Vec<String> = Vec::new();
    for (label, repo, span) in every_current_state()? {
        let json = history_json(&repo, span)?;
        let anchors = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"));
        for anchor in anchors {
            for key in anchor.as_object().expect("anchor object").keys() {
                assert!(
                    documented.contains(key),
                    "{label}: `{key}` is emitted but undocumented; the field \
                     list names {documented:?}"
                );
                if !seen.contains(key) {
                    seen.push(key.clone());
                }
            }
        }
    }
    // The reverse direction: a documented field no fixture can produce is
    // either dead contract or an untested state, and both need saying. No
    // exemptions — the binary re-anchor fixture emits `unavailable`, closing
    // the hatch this sweep used to carry for it.
    for key in &documented {
        assert!(
            seen.contains(key),
            "the document promises `{key}`, but no state in the sweep emits it"
        );
    }
    Ok(())
}

/// The same contract check for the *timeline* array, against its own list.
///
/// The two arrays cannot share one sweep, because they cannot share one list:
/// a timeline object carries `content` xor `diff` and structurally never
/// carries `proposed` or `recorded`, while a `current` object carries `diff`
/// unconditionally. Pointing the existing sweep at both arrays would go green
/// against a document that is false of one of them — and until this existed,
/// the timeline emitter was the one place in the schema with no contract above
/// it and no sweep below it, which is where the first timeline-only keys were
/// about to land.
#[test]
fn every_timeline_anchor_key_appears_in_the_documented_field_list() -> Result<()> {
    let documented = documented_anchor_fields("commits[].anchors[]")?;
    let mut seen: Vec<String> = Vec::new();
    for (label, repo, span) in every_timeline_state()?
        .into_iter()
        .map(|(label, repo, span, _)| (label, repo, span))
    {
        let json = history_json(&repo, span)?;
        for commit in json["commits"].as_array().expect("commits array") {
            let anchors = commit["anchors"]
                .as_array()
                .unwrap_or_else(|| panic!("{label}: no anchors array in {commit:#}"));
            for anchor in anchors {
                for key in anchor.as_object().expect("anchor object").keys() {
                    assert!(
                        documented.contains(key),
                        "{label}: `{key}` is emitted but undocumented; the field \
                         list names {documented:?}"
                    );
                    if !seen.contains(key) {
                        seen.push(key.clone());
                    }
                }
            }
        }
    }
    // Both directions, no exemptions: a documented key no timeline fixture
    // produces is dead contract or an unenumerated state.
    for key in &documented {
        assert!(
            seen.contains(key),
            "the document promises `{key}` on a timeline anchor, but no state \
             in the sweep emits it; seen: {seen:?}"
        );
    }
    Ok(())
}

/// The span-diff body of `render` for `.span/<span>`: everything from the
/// first hunk header to the end of that block, which is the part git itself
/// can be asked to produce independently.
fn span_diff_body<'a>(render: &'a str, span: &str) -> &'a str {
    let block = diff_block(render, &format!("a/.span/{span} "));
    let at = block
        .find("@@ ")
        .unwrap_or_else(|| panic!("no hunk header in:\n{block}"));
    &block[at..]
}

/// git's own rendering of the same blob pair, with the header lines dropped.
fn git_diff_body(repo: &TestRepo, span: &str) -> Result<String> {
    let out = repo.git_stdout([
        "-c",
        "core.pager=cat",
        "diff",
        "--no-color",
        "--unified=3",
        "HEAD~1",
        "HEAD",
        "--",
        &format!(".span/{span}"),
    ])?;
    let at = out
        .find("@@ ")
        .unwrap_or_else(|| panic!("no hunk header in git's own diff:\n{out}"));
    Ok(format!("{}\n", &out[at..]))
}

/// Item 25's conformance oracle, stated the only way that cannot drift with
/// the renderer: for a one-line declaration file, the rendered hunk must be
/// byte-identical to what `git diff` prints for the same two blobs — which
/// means `@@ -1 +1 @@`, with neither side carrying a `,1` count.
#[test]
fn a_one_line_declaration_hunk_matches_gits_own_bytes() -> Result<()> {
    let repo = TestRepo::new()?;
    let span = "oneline";
    repo.commit_file("f.txt", "alpha\nbeta\ngamma\n", "seed")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    let declaration = std::fs::read_to_string(repo.path().join(".span").join(span))?;
    let token = declaration
        .split_whitespace()
        .find(|w| w.starts_with("rk64:"))
        .expect("declaration must record a token")
        .to_string();
    repo.write_file(&format!(".span/{span}"), &format!("f.txt#L1-L3 {token}\n"))?;
    repo.commit_all("declare")?;
    repo.write_file(&format!(".span/{span}"), &format!("f.txt#L1-L2 {token}\n"))?;
    repo.commit_all("edit")?;

    let render = history_text(&repo, span)?;
    assert_eq!(
        span_diff_body(&render, span),
        git_diff_body(&repo, span)?,
        "the span diff must be git's own bytes:\n{render}"
    );
    Ok(())
}

/// The live bytes at `address` (`path#Lstart-Lend` or a bare path), read from
/// the worktree — an oracle for `content` that shares no code with the
/// renderer. `None` when the file or the range is absent.
fn read_address(repo: &TestRepo, address: &str) -> Option<String> {
    let (path, range) = match address.split_once("#L") {
        Some((p, r)) => (p, Some(r)),
        None => (address, None),
    };
    let text = std::fs::read_to_string(repo.path().join(path)).ok()?;
    let Some(range) = range else {
        return Some(text);
    };
    let (start, end) = range.split_once("-L")?;
    let (start, end): (usize, usize) = (start.parse().ok()?, end.parse().ok()?);
    let mut out = text
        .lines()
        .skip(start - 1)
        .take(end + 1 - start)
        .collect::<Vec<_>>()
        .join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    Some(out)
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


// ---------------------------------------------------------------------------
// Past end of file: one policy across both read paths
// ---------------------------------------------------------------------------

/// An anchored file truncated *below* its declared range, with the file itself
/// still on disk — the declared L3-L5 now runs off the end of a one-line file.
///
/// This is one of the two routes to a past-EOF live read, and the one where the
/// resolver reports the anchor deleted and binds no live location at all: the
/// reason has to be recovered from the declared address, because "the resolver
/// found nothing" and "there is no such file" are different facts and only the
/// second is `absent`.
fn truncated_past_eof_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nalpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L3-L5"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    repo.write_file("f.txt", "one\n")?;
    Ok(repo)
}

/// The other route: a hand-edited re-anchor onto a range the file does not
/// have. `git span add` fails closed on such a range; editing `.span` by hand —
/// the ordinary way a reconcile loop leaves a declaration — does not, and here
/// the resolver *does* bind a location, so the past-EOF classification has to
/// happen inside the read rather than around it.
fn reanchored_past_eof_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    rewrite_declaration(&repo, span, "f.txt#L1-L3", "f.txt#L8-L10")?;
    Ok(repo)
}

/// The anchored file deleted in the working tree, declaration untouched — the
/// state whose name `absent` actually is.
fn vanished_worktree_file_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    std::fs::remove_file(repo.path().join("f.txt"))?;
    Ok(repo)
}

/// A re-anchor onto a genuinely empty file — the *honest* twin of the past-EOF
/// render, and the reason the dishonest one was plausible.
///
/// `git span add` on an empty file records `rk64:0000000000000000`, so this
/// anchor's content, its recorded token, and both sides of its `index` line are
/// all legitimately null. Everything the fabricated past-EOF block used to
/// print, this block prints truthfully.
fn empty_extent_reanchor_repo(span: &str) -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "alpha\nbeta\ngamma\n")?;
    repo.write_file("e.txt", "")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", span, "f.txt#L1-L3"])?;
    repo.span_stdout(["why", span, "three greek letters"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "declare"])?;
    rewrite_declaration(&repo, span, "f.txt#L1-L3", "e.txt")?;
    Ok(repo)
}

/// The declared range's live state, as the two structured fields a consumer
/// reads: `(content, unavailable)`. `path` and `diff` are deliberately excluded
/// — `path` is the join key every object differs in trivially, and `diff` is
/// the patch string whose parsing `--format json` exists to spare consumers.
fn payload_fields(anchor: &Value) -> (Option<&str>, Option<&str>) {
    (
        anchor.get("content").map(|c| c.as_str().expect("content string")),
        anchor
            .get("unavailable")
            .map(|u| u.as_str().expect("unavailable string")),
    )
}

/// A live anchor whose declared range starts past end of file is *structurally*
/// unavailable, exactly as it is when read from a commit.
///
/// Before this, the worktree read sliced the range to `""` and called it
/// content, and one file state got two accounts depending on whether it had
/// been committed. Four claims came out of the one fabricated side: signed
/// deletion lines for content `git diff` does not show; `"content": ""`
/// asserting an empty range where the truth is that the range does not exist; a
/// `new anchor` block against a declaration whose recorded token the same
/// output prints; and a `similarity index` measured against the empty string,
/// which decided the disproven-versus-unknown question wrongly. Continuity here
/// is *unknown*, so the declaration-asserted rename is the honest block.
///
/// ORACLE — `git diff` over the worktree, and the timeline's account of the
/// same declaration change once committed.
#[test]
fn a_reanchor_past_end_of_file_is_unavailable_not_empty_content() -> Result<()> {
    let repo = reanchored_past_eof_repo("pe")?;

    // The user edited a declaration, not a file: any signed line in this render
    // is an edit the repository can be asked about and does not have.
    let worktree_diff = repo.git_stdout(["diff", "--", ".", ":(exclude).span"])?;
    assert!(
        worktree_diff.trim().is_empty(),
        "fixture assumption: no source edit at all; got:\n{worktree_diff}"
    );

    let json = history_json(&repo, "pe")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(
        anchors.len(),
        1,
        "one declared move, one block; got: {json:#}"
    );
    let anchor = &anchors[0];
    assert_eq!(
        payload_fields(anchor),
        (None, Some("range-past-eof")),
        "the range does not exist, which is not the same as being empty; \
         got: {anchor:#}"
    );

    let diff = anchor["diff"].as_str().expect("diff string");
    assert_eq!(
        block_form(diff),
        BlockForm::Renamed { similarity: None },
        "the declaration asserts the move and nothing can measure it; \
         got:\n{diff}"
    );
    assert!(
        !diff.lines().any(|l| l.starts_with('-') && !l.starts_with("---")),
        "no signed line may assert an edit `git diff` does not show; \
         got:\n{diff}"
    );
    assert!(
        !diff.contains("@@"),
        "hunks need two comparable bodies; got:\n{diff}"
    );
    Ok(())
}

/// Item 52b's route to the same state: the file is still there, so `"absent"` —
/// glossed "no such file" — was a claim the file system contradicts.
///
/// ORACLE — the file system, and `git span stale`, which separates these two
/// states on the same fixtures.
#[test]
fn a_truncated_file_is_past_eof_not_absent() -> Result<()> {
    let repo = truncated_past_eof_repo("tp")?;
    assert!(
        repo.path().join("f.txt").exists(),
        "fixture assumption: the file is present, only shorter"
    );

    let json = history_json(&repo, "tp")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors array");
    assert_eq!(anchors.len(), 1, "one drifted anchor; got: {json:#}");
    assert_eq!(
        payload_fields(&anchors[0]),
        (None, Some("range-past-eof")),
        "`absent` means no such file, and the file is on disk; \
         got: {:#}",
        anchors[0]
    );
    Ok(())
}

/// The same declaration state, before and after committing it, must not get two
/// different accounts — the failure shape where a user commits to see whether
/// an alarming diff resolves and concludes the commit fixed something.
///
/// ORACLE — the commit read path, which already renders this state correctly
/// and is therefore the in-tree reference implementation. This asserts the
/// worktree path conformed to it *and* that the reference itself did not move.
#[test]
fn both_read_paths_give_one_account_of_a_past_eof_range() -> Result<()> {
    let repo = truncated_past_eof_repo("cp")?;
    let before = history_json(&repo, "cp")?;
    let live = &before["current"]["anchors"].as_array().expect("anchors")[0];

    repo.commit_all("truncate the file below the declared range")?;
    let after = history_json(&repo, "cp")?;
    let committed = &commit_with(&after, "truncate the file")["anchors"]
        .as_array()
        .expect("anchors")[0];

    assert_eq!(
        payload_fields(live),
        payload_fields(committed),
        "one file state, one account; committing must not rewrite the story"
    );
    assert_eq!(
        live["diff"], committed["diff"],
        "the two paths render the same event byte for byte"
    );
    assert_eq!(
        payload_fields(committed),
        (None, Some("range-past-eof")),
        "and the account both paths give is the commit path's original one"
    );

    // The sharpest form of the same defect: the declaration still names the
    // pre-truncation content, so one render carries both accounts of one file
    // at one instant. Before the fix this single document said
    // `range-past-eof` in `commits[]` and `absent` in `current[]`.
    let live_now = &after["current"]["anchors"]
        .as_array()
        .expect("the recorded token still describes the old content, so the anchor is drifted")[0];
    assert_eq!(
        payload_fields(live_now),
        payload_fields(committed),
        "one document, one instant, one file — it cannot be two states at once"
    );
    Ok(())
}

/// Every state that renders with a null hash must be tellable apart from every
/// other one, using only structured fields.
///
/// The null hash means four different things — an absent file, a past-EOF
/// range, the `/dev/null` side of a create or delete, and a genuinely empty
/// recorded extent — so nothing downstream can recover the state from it. Three
/// of the four are reachable in the `current` block, and two of those three
/// pairs used to be indistinguishable in *both* formats: the fabricated
/// past-EOF block and the honest empty-extent block emitted the same keys with
/// the same values, and the truncate route emitted `"absent"` for a file that
/// exists, colliding with a genuine deletion. A consumer had no way to ask why
/// an extent has no bytes.
///
/// The comparison reads `content` and `unavailable` only. `diff` is excluded on
/// purpose: a discriminator that lives in a marker line inside the patch string
/// is not a contract, it is parsing — the same rule that gave the rebound block
/// its structured `rebound` field.
///
/// The enumeration is by *route*, not by state: past-EOF is reachable two ways
/// and the two ways used to render differently from each other (`content: ""`
/// one way, `"absent"` the other), each colliding with a different other state.
/// Enumerating states would let a fix for one route pass while the other stayed
/// wrong, since the surviving route would simply not be looked at.
#[test]
fn every_null_hash_state_is_distinguishable_from_structured_fields() -> Result<()> {
    // (state, route, repo, span, the declared address whose object carries it)
    let routes: Vec<(&str, &str, TestRepo, &str, &str)> = vec![
        (
            "genuinely empty recorded extent",
            "re-anchored onto an empty file",
            empty_extent_reanchor_repo("nz")?,
            "nz",
            "e.txt",
        ),
        (
            "declared range past end of file",
            "declaration re-anchored past the end",
            reanchored_past_eof_repo("np")?,
            "np",
            "f.txt#L8-L10",
        ),
        (
            "declared range past end of file",
            "file truncated below the declared range",
            truncated_past_eof_repo("nt")?,
            "nt",
            "f.txt#L3-L5",
        ),
        (
            "anchored file absent",
            "file deleted from the working tree",
            vanished_worktree_file_repo("na")?,
            "na",
            "f.txt#L1-L3",
        ),
    ];

    let mut payloads: Vec<(&str, &str, (Option<String>, Option<String>))> = Vec::new();
    for (state, route, repo, span, address) in &routes {
        let json = history_json(repo, span)?;
        let anchors = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{route}: no current anchors in {json:#}"));
        // Fail closed: a selector that matches nothing would make every
        // remaining pair "distinct" by never being compared. Each route has to
        // have actually produced its object.
        let anchor = anchors
            .iter()
            .find(|a| a["path"] == Value::from(*address))
            .unwrap_or_else(|| {
                panic!("{route}: no object at {address}; the fixture no longer reaches this state:\n{json:#}")
            });
        let (content, unavailable) = payload_fields(anchor);
        payloads.push((
            state,
            route,
            (
                content.map(str::to_string),
                unavailable.map(str::to_string),
            ),
        ));
    }
    assert_eq!(
        payloads.len(),
        4,
        "every enumerated route must have produced its object"
    );

    for (i, (state_a, route_a, a)) in payloads.iter().enumerate() {
        for (state_b, route_b, b) in payloads.iter().skip(i + 1) {
            if state_a == state_b {
                assert_eq!(
                    a, b,
                    "one state reached two ways is still one state, but \
                     `{route_a}` and `{route_b}` disagree about it — a \
                     consumer's reading of the value would depend on how the \
                     user got there"
                );
            } else {
                assert_ne!(
                    a, b,
                    "{state_a} ({route_a}) and {state_b} ({route_b}) render \
                     identically in every structured field a consumer can \
                     read, so nothing downstream can tell them apart"
                );
            }
        }
    }
    Ok(())
}

/// A commit that moves an anchor between two unreadable states renders an
/// entry, even though both states carry the null hash and an empty body.
///
/// Truncating a file past its declared range and then deleting the file are two
/// different things, and the second used to render nothing at all: change
/// detection compared null to null, saw no difference, and dropped the commit —
/// an `unavailable` value visibly changing across states with no entry, against
/// the contract's own "every observable change is expressed once".
///
/// ORACLE — `git log`, which has a commit for the deletion, and `git status`,
/// which agrees the file is gone.
#[test]
fn a_change_of_unavailable_reason_renders_an_entry() -> Result<()> {
    let repo = truncated_past_eof_repo("ur2")?;
    repo.commit_all("truncate below the declared range")?;
    repo.run_git(["rm", "f.txt"])?;
    repo.run_git(["commit", "-m", "delete the file outright"])?;

    let json = history_json(&repo, "ur2")?;
    let deletion = commit_with(&json, "delete the file outright");
    let anchors = deletion["anchors"].as_array().expect("anchors array");
    assert_eq!(
        anchors.len(),
        1,
        "the commit that deleted the file has an anchor-level account; \
         got: {deletion:#}"
    );
    assert_eq!(
        payload_fields(&anchors[0]),
        (None, Some("absent")),
        "and the account is the new reason; got: {:#}",
        anchors[0]
    );

    // The block is bodyless — there are no bytes on either side — so without a
    // marker it would read as a renderer that lost its hunks, which is the gap
    // the `recorded snapshot unrecoverable` line was added to close.
    let diff = anchors[0]["diff"].as_str().expect("diff string");
    assert!(
        diff.contains("\ncontent unavailable range-past-eof..absent\n"),
        "a bodyless block states what changed; got:\n{diff}"
    );
    let out = history_text(&repo, "ur2")?;
    assert!(
        out.contains(diff),
        "both formats carry the same block:\n{out}"
    );
    Ok(())
}
