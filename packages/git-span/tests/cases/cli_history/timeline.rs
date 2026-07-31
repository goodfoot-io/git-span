//! Timeline entries: adds, edits, re-anchors, removals.

use super::*;

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
        removed["diff"]
            .as_str()
            .unwrap_or("")
            .contains("deleted anchor"),
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
        assert!(
            out.contains(diff),
            "the default output carries it too:\n{out}"
        );
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
        assert!(
            out.contains(diff),
            "the default output carries it too:\n{out}"
        );
    }
    Ok(())
}


/// The oracle behind the whole current block: whatever content stands as an
/// old side must hash to the token the declaration recorded. It is enforced by
/// construction in `current_old_side`, which can only be checked from outside
/// — an assertion at the construction site would restate the predicate that
/// selected the value. So this re-reads the emitted `index` lines against the
/// declaration itself, across the scenarios that exercise every arm: a
/// proposal, an in-place edit, and content the recorded snapshot can no longer
/// supply. A resolved-pending-commit declaration edit deliberately has no
/// current anchor, so it is outside this current-anchor oracle.
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
