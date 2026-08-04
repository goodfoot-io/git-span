//! The documented output contract: field/value sweeps, sources, declaration hunk bytes.

use super::*;


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


/// Every `sources` value the `current` contract documents is produced by some
/// state in the enumeration — the same question `unavailable` gets asked, for
/// the same reason.
///
/// It is a sharper question here, because the vocabulary is not this command's
/// to invent: `sources` republishes `git span drift`'s three layer names, and a
/// documented layer no fixture reaches means `current` is silent about a state
/// `drift` reports every day. `INDEX` was exactly that until this sweep forced
/// a staged fixture into the set.
#[test]
fn every_documented_current_sources_value_has_a_producer() -> Result<()> {
    let documented = documented_field_values("current.anchors[]", "sources")?;
    let mut seen: Vec<String> = Vec::new();
    for (label, repo, span) in every_current_state()? {
        let json = history_json(&repo, span)?;
        for anchor in json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"))
        {
            let Some(value) = anchor.get("sources") else {
                continue;
            };
            let list = value
                .as_array()
                .unwrap_or_else(|| panic!("{label}: `sources` must be an array; got {value:#}"));
            // Never `[]`. Presence is the whole test, so an empty array would
            // make a consumer distinguish "no layer" from "empty" — two
            // spellings of one fact, which is how a key stops meaning anything.
            assert!(
                !list.is_empty(),
                "{label}: `sources` is present but empty; the key is omitted \
                 when there is no layer to name"
            );
            for entry in list {
                let entry = entry.as_str().expect("sources entry string").to_string();
                assert!(
                    documented.contains(&entry),
                    "{label}: `sources` carries {entry:?}, which the field list \
                     does not name; the list names {documented:?}"
                );
                if !seen.contains(&entry) {
                    seen.push(entry);
                }
            }
        }
    }
    for value in &documented {
        assert!(
            seen.contains(value),
            "the document promises `sources` can carry {value:?}, but no state \
             in the sweep produces it; seen: {seen:?}"
        );
    }
    Ok(())
}


/// `sources` and the `drift source` marker are one fact with two spellings, and
/// they are emitted from one place so they cannot disagree. This asserts the
/// agreement over every state in the enumeration, in both directions: a block
/// carrying the key carries the marker, and a block carrying neither carries
/// neither.
///
/// The half that mattered is the marker's. The key was added first and the
/// marker appended in the human renderer, which left the below-threshold
/// re-anchor split — the one shape whose two blocks are built by a different
/// constructor — publishing `sources` in JSON and saying nothing at all in the
/// default output, the format the command exists to produce.
#[test]
fn the_drift_source_marker_accompanies_the_sources_key_in_every_current_state() -> Result<()> {
    for (label, repo, span) in every_current_state()? {
        let json = history_json(&repo, span)?;
        let text = history_text(&repo, span)?;
        for anchor in json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"))
        {
            let diff = anchor["diff"].as_str().expect("current diff string");
            let marker = diff
                .lines()
                .find(|line| line.starts_with("drift source "))
                .map(str::to_string);
            match anchor.get("sources") {
                Some(value) => {
                    let expected: Vec<String> = value
                        .as_array()
                        .expect("sources array")
                        .iter()
                        .map(|v| v.as_str().expect("sources entry").to_ascii_lowercase())
                        .collect();
                    let marker = marker.unwrap_or_else(|| {
                        panic!(
                            "{label}: `sources` is emitted with no `drift source` \
                             line beside it; the default output cannot say where \
                             the drift lives:\n{diff}"
                        )
                    });
                    assert_eq!(
                        marker,
                        format!("drift source {}", expected.join(", ")),
                        "{label}: the marker and the key must be the same fact, \
                         in the same order"
                    );
                }
                None => assert!(
                    marker.is_none(),
                    "{label}: a `drift source` line with no `sources` key states \
                     something no consumer can read:\n{diff}"
                ),
            }
            // The marker reaches the reader through the header both formats are
            // built from, so the human block is these bytes exactly.
            assert!(
                text.contains(diff),
                "{label}: the human block and the JSON `diff` string diverged:\n{text}"
            );
        }
    }
    Ok(())
}


/// One anchor, drifted at two layers at once, read on both surfaces.
///
/// This is the case a scalar `source` field cannot express: the edit is
/// committed *and* the working tree has moved on again, and the two states want
/// different repairs — the committed face wants re-anchoring, the working-tree
/// face wants saving or reverting. A scalar has to pick the shallowest and drop
/// the other, and dropping the committed face is dropping the one that changes
/// what the reader should do. `git span drift` has always published both; this
/// asserts `history` publishes the same pair, in the same order.
#[test]
fn an_anchor_drifted_at_two_layers_names_both_in_both_formats() -> Result<()> {
    let repo = composed_drift_repo("cx")?;

    // Fixture assumption, read off `drift` rather than assumed: the anchor is
    // genuinely drifted at both layers, and this is the order `drift` uses.
    // `drift` exits 1 on drift, which is the point of the fixture, so its
    // stdout is read directly rather than through the exit-zero helper.
    let drift = repo.run_span(["drift", "--format", "json"])?;
    let drift: serde_json::Value = serde_json::from_slice(&drift.stdout)?;
    let layers: Vec<&str> = drift["findings"]
        .as_array()
        .expect("findings array")
        .iter()
        .filter_map(|f| f["source"].as_str())
        .collect();
    assert!(
        layers.contains(&"WORKTREE") && layers.contains(&"HEAD"),
        "fixture assumption: drift reports both layers; got {layers:?}"
    );

    let json = history_json(&repo, "cx")?;
    let anchor = &json["current"]["anchors"][0];
    assert_eq!(
        anchor["sources"],
        serde_json::json!(["WORKTREE", "HEAD"]),
        "both layers, shallow-to-deep, in `drift`'s own order: {anchor:#}"
    );

    let text = history_text(&repo, "cx")?;
    assert!(
        text.contains("\ndrift source worktree, head\n"),
        "the default output names both layers on one line; got:\n{text}"
    );
    Ok(())
}


/// The resolver sequence is extent-dependent, not a globally sortable layer
/// priority. Both history formats must preserve the exact sequence `drift`
/// publishes for each anchor.
#[test]
fn staged_and_worktree_sources_preserve_drifts_extent_dependent_order() -> Result<()> {
    let repo = extent_dependent_source_order_repo("orders")?;
    let drift_out = repo.run_span(["drift", "orders", "--format=json"])?;
    let drift: Value = serde_json::from_slice(&drift_out.stdout)?;

    let drift_sources = |path: &str| -> Vec<&str> {
        drift["findings"]
            .as_array()
            .expect("drift findings")
            .iter()
            .filter(|finding| finding["anchored"]["path"] == path)
            .map(|finding| finding["source"].as_str().expect("source string"))
            .collect()
    };
    assert_eq!(
        drift_sources("range.txt"),
        vec!["WORKTREE", "INDEX", "HEAD"],
        "line ranges retain the resolver's relative-layer sequence: {drift:#}"
    );
    assert_eq!(
        drift_sources("whole.txt"),
        vec!["INDEX", "WORKTREE", "HEAD"],
        "whole-file anchors retain the resolver's absolute-layer sequence: {drift:#}"
    );

    let json = history_json(&repo, "orders")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("history current anchors");
    let history_sources = |path: &str| -> Vec<&str> {
        anchors
            .iter()
            .find(|anchor| anchor["path"] == path)
            .unwrap_or_else(|| panic!("no current anchor for {path:?}: {json:#}"))["sources"]
            .as_array()
            .expect("sources array")
            .iter()
            .map(|source| source.as_str().expect("source string"))
            .collect()
    };
    assert_eq!(
        history_sources("range.txt#L1-L3"),
        drift_sources("range.txt")
    );
    assert_eq!(history_sources("whole.txt"), drift_sources("whole.txt"));

    let text = history_text(&repo, "orders")?;
    assert!(
        diff_block(&text, "range.txt#L1-L3").contains("\ndrift source worktree, index, head\n"),
        "human range marker must preserve drift's order:\n{text}"
    );
    assert!(
        diff_block(&text, "whole.txt").contains("\ndrift source index, worktree, head\n"),
        "human whole-file marker must preserve drift's order:\n{text}"
    );
    Ok(())
}


/// HEAD is the resolver's observation layer. A declaration moved only in the
/// worktree can compare against HEAD's declaration and produce HEAD even when
/// the anchored source has no uncommitted or newly committed content change.
#[test]
fn head_source_does_not_claim_a_worktree_only_reanchor_was_committed() -> Result<()> {
    let repo = worktree_only_reanchor_repo("observed")?;
    repo.run_git(["diff", "--quiet", "HEAD", "--", "f.txt"])?;
    assert!(
        !repo
            .git_stdout(["status", "--short", "--", ".span/observed"])?
            .is_empty(),
        "fixture assumption: only the declaration is edited in the worktree"
    );

    let json = history_json(&repo, "observed")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("worktree declaration re-anchor must produce current anchors");
    assert_eq!(
        anchors.len(),
        2,
        "a below-threshold declaration move splits into delete plus create: {json:#}"
    );
    for anchor in anchors {
        assert_eq!(
            anchor["sources"],
            serde_json::json!(["HEAD"]),
            "HEAD describes the comparison against the committed declaration: {json:#}"
        );
    }
    assert_eq!(
        json["commits"].as_array().expect("commits").len(),
        1,
        "the only timeline entry is declaration creation; the worktree move has no commit"
    );

    let text = history_text(&repo, "observed")?;
    assert!(
        text.contains("\ndrift source head\n"),
        "human output must publish the same observation:\n{text}"
    );

    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let guidance = std::fs::read_to_string(
        workspace.join("plugins-claude/git-span/skills/reconcile/SKILL.md"),
    )?;
    let guidance = guidance.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        guidance.contains(
            "If only the declaration changed, inspect it and either commit or revert it rather than searching timeline entries"
        ),
        "reconciliation guidance must direct a worktree-only declaration edit toward inspect/commit/revert"
    );
    Ok(())
}


/// The normative prose and its worked fence both spell the same full author
/// date that the renderer emits. JSON deliberately keeps its ISO-8601 form.
#[test]
fn documented_human_and_json_dates_match_the_renderer_contracts() -> Result<()> {
    let doc = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("docs")
            .join("history-example-output.md"),
    )?;
    assert!(
        doc.contains("`Date:   <weekday> <month> <day> HH:MM:SS YYYY <±HHMM>`"),
        "the normative human rule must state Git's full default author date"
    );
    assert!(
        doc.contains("Date:   Wed Jul 29 14:53:08 2026 -0400"),
        "the normative worked fence must demonstrate the full human date"
    );
    assert!(
        doc.contains("full ISO-8601 timestamp with UTC offset"),
        "the JSON date contract must remain ISO-8601"
    );
    assert!(
        !doc.lines().any(|line| {
            line.strip_prefix("Date:   ")
                .is_some_and(|date| date.len() == "YYYY-MM-DD".len())
        }),
        "no human output fence may retain a date-only example"
    );

    let (repo, span) = seed_history_scenario()?;
    let text = history_text(&repo, span)?;
    let json = history_json(&repo, span)?;
    let human_date = text
        .lines()
        .find_map(|line| line.strip_prefix("Date:   "))
        .expect("human Date line");
    assert_eq!(
        human_date.split_whitespace().count(),
        6,
        "Git's default author date has weekday, month, day, time, year, and offset"
    );
    let iso = json["commits"][0]["date"].as_str().expect("JSON date");
    assert!(
        iso.contains('T') && iso.rfind(['+', '-']).is_some_and(|at| at > 9),
        "JSON date remains an ISO-8601 timestamp with offset: {iso:?}"
    );
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
    assert_eq!(
        anchors.len(),
        1,
        "only the edited block changed; got: {edit}"
    );
    assert_eq!(anchors[0]["path"], "src.txt#L5-L7");
    Ok(())
}
