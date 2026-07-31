//! The `current` (working tree) section, including never-committed declarations.

use super::*;

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
    let anchors = current["anchors"]
        .as_array()
        .expect("current anchors array");
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
        anchors[0]["content"], "first\nsecond\nthird\nfourth\nfifth\nSIXTH (uncommitted)\n",
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
fn changed_bytes_beneath_a_promoted_submodule_keep_stales_cause_in_both_formats() -> Result<()> {
    let repo = directory_promoted_to_submodule(false)?;

    let stale_human = repo.run_span(["stale", "sp"])?;
    assert_eq!(stale_human.status.code(), Some(1));
    let stale_human = String::from_utf8_lossy(&stale_human.stdout);
    assert!(
        stale_human.contains("lib/f.txt#L1-L3 — submodule"),
        "stale must retain the resolver's terminal cause:\n{stale_human}"
    );

    let stale_json = repo.run_span(["stale", "sp", "--format=json"])?;
    assert_eq!(stale_json.status.code(), Some(1));
    let stale_json: Value = serde_json::from_slice(&stale_json.stdout)?;
    let findings = stale_json["findings"].as_array().expect("stale findings");
    assert_eq!(findings.len(), 1, "one promoted anchor: {stale_json:#}");
    assert_eq!(findings[0]["anchored"]["path"], "lib/f.txt");
    assert_eq!(
        findings[0]["anchored"]["extent"],
        serde_json::json!({ "kind": "lines", "start": 1, "end": 3 })
    );
    assert_eq!(findings[0]["status"]["code"], "SUBMODULE");

    let history = history_json(&repo, "sp")?;
    let anchors = history["current"]["anchors"]
        .as_array()
        .expect("history current anchors");
    assert_eq!(
        anchors.len(),
        findings.len(),
        "history and stale must agree anchor-for-anchor: {history:#}"
    );
    assert_eq!(anchors[0]["path"], "lib/f.txt#L1-L3");
    assert_eq!(anchors[0]["unavailable"], "submodule");
    let diff = anchors[0]["diff"].as_str().expect("history diff");
    assert!(
        diff.contains("content unavailable submodule\n"),
        "the human cause must be derived from the same unavailable state:\n{diff}"
    );
    assert!(
        !diff.contains("@@ ") && !diff.lines().any(|line| line.starts_with('-')),
        "unread submodule content must not fabricate a deletion hunk:\n{diff}"
    );
    let history_human = history_text(&repo, "sp")?;
    assert!(
        history_human.contains(diff),
        "human and JSON history must carry the identical anchor block:\n{history_human}"
    );
    Ok(())
}


#[test]
fn equal_bytes_beneath_a_promoted_submodule_remain_informational_only() -> Result<()> {
    let repo = directory_promoted_to_submodule(true)?;

    let stale = repo.run_span(["stale", "sp"])?;
    assert_eq!(
        stale.status.code(),
        Some(0),
        "ResolvedPendingCommit does not count as stale"
    );
    let stale_human = String::from_utf8_lossy(&stale.stdout);
    assert!(
        stale_human.contains("lib/f.txt#L1-L3 — resolved, pending commit"),
        "stale retains its informational line:\n{stale_human}"
    );

    let stale_json = repo.run_span(["stale", "sp", "--format=json"])?;
    assert_eq!(stale_json.status.code(), Some(0));
    let stale_json: Value = serde_json::from_slice(&stale_json.stdout)?;
    assert_eq!(
        stale_json["findings"][0]["status"]["code"],
        "RESOLVED_PENDING_COMMIT"
    );

    let history = history_json(&repo, "sp")?;
    assert!(
        history.get("current").is_none(),
        "an informational resolver state must not manufacture current: {history:#}"
    );

    let declaration = std::fs::read_to_string(repo.path().join(".span/sp"))?;
    let token = declaration
        .split_whitespace()
        .find(|word| word.starts_with("rk64:"))
        .expect("recorded anchor token");
    let equal_hash_header = format!("index {token}..{token}");
    let history_human = history_text(&repo, "sp")?;
    assert!(
        !history_human.contains(&equal_hash_header),
        "history must not render a self-refuting equal-hash current block:\n{history_human}"
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
fn resolved_pending_reanchor_reports_only_the_declaration_diff() -> Result<()> {
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
    let current = &json["current"];
    let diff = current["span_diff"]
        .as_str()
        .expect("the declaration edit must remain visible");
    assert!(
        diff.contains("-src.txt#L1-L3 rk64:") && diff.contains("+src.txt#L4-L6 rk64:"),
        "the declaration patch carries the re-anchor:\n{diff}"
    );
    assert!(
        current["anchors"].as_array().is_some_and(Vec::is_empty),
        "ResolvedPendingCommit is informational in stale and must not create a current anchor: {json:#}"
    );
    Ok(())
}


#[test]
fn every_current_anchor_carries_both_payloads_in_both_formats() -> Result<()> {
    for (repo, span) in [seed_history_scenario()?, {
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
    }] {
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
    assert!(
        out.contains(diff),
        "the default output carries it too:\n{out}"
    );
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
