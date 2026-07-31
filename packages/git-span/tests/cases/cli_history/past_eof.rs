//! Past end of file: one policy across both read paths.

use super::*;


/// Emptying a file under a *whole-file* anchor is an honest empty extent, not a
/// range that ran off the end.
///
/// This is the one render `lo >= hi` could plausibly have broken, and the reason
/// it cannot is structural rather than incidental: the `WholeFile` extent arm
/// returns the decoded text directly and never calls `slice_line_range`, so
/// only the `LineRange` arm can reach the
/// boundary at all. A property that holds by construction is exactly the kind
/// that belongs in a test rather than in someone's reasoning — the construction
/// can change, and the next reader has no way to notice.
///
/// Note what separates this from the line-range case one line away: a range
/// declared from line 1 over this same emptied file *is* past end of file,
/// because a range names lines and there are none. A whole file names the file,
/// and the file is there and empty. The two answers differ because the two
/// declarations ask different questions.
///
/// ORACLE — the file system, and `git span add` on an empty file, which records
/// the null token for a legitimately empty extent (see
/// [`empty_extent_reanchor_repo`]).
#[test]
fn emptying_a_file_under_a_whole_file_anchor_is_an_empty_extent_not_past_eof() -> Result<()> {
    let repo = emptied_whole_file_repo("wf")?;
    assert_eq!(
        std::fs::read_to_string(repo.path().join("f.txt"))?,
        "",
        "fixture assumption: the file is present and empty"
    );

    let json = history_json(&repo, "wf")?;
    let live = sole_anchor_in(&json["current"], "f.txt", "current[], emptied whole file");
    assert_eq!(
        payload_fields(live),
        (Some(""), None),
        "the file exists and holds nothing, which is content — an empty extent \
         has something to show and a past-EOF range does not; got: {live:#}"
    );

    repo.commit_all("empty the file")?;
    let after = history_json(&repo, "wf")?;
    let committed = sole_anchor_in(
        commit_with(&after, "empty the file"),
        "f.txt",
        "commits[], emptied whole file",
    );
    assert_eq!(
        committed.get("unavailable"),
        None,
        "and the commit read agrees there is nothing unavailable about it; \
         got: {committed:#}"
    );
    Ok(())
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
        !diff
            .lines()
            .any(|l| l.starts_with('-') && !l.starts_with("---")),
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


/// The clip/past-EOF boundary is a *range* of depths, and every depth in it has
/// to give the same answer.
///
/// For a declared start `S`, a file of `0..S-1` lines overlaps the range in zero
/// lines — past end of file, however many lines the file has left — and a file
/// of `S` lines or more overlaps in at least one and is clipped. The defect was
/// the seam between those two zones: `lo == hi` is zero overlap read as an
/// empty-but-valid slice, so `file_lines == S - 1` fell through the guard and
/// fabricated content.
///
/// A sweep is the only form that catches this, and the reason is the round it
/// escaped: the previous fixture picked one depth well inside the past-EOF zone,
/// and the route matrix, the fail-closed count and the intra-document assertion
/// all inherited that single depth. A boundary tested at one point is not tested.
///
/// The `S = 1` case is not garnish — it is the everyday face of the same bug.
/// `start - 1` is 0 there, so the boundary is reached whenever the file is
/// merely *emptied*: cleared, regenerated empty, truncated to zero. Sweeping
/// only `S = 4` would leave that face untested while the exotic one passed,
/// which is the fixture-choice hazard one level down.
///
/// ORACLE — the file system (the file is present at every depth, so `absent` is
/// contradicted outright) and the commit read path, swept at the same depths.
#[test]
fn the_past_eof_boundary_holds_at_every_depth_below_the_declared_start() -> Result<()> {
    // (start, end): a mid-file range, and a line-1 range whose past-EOF zone is
    // the single depth an emptied file has.
    //
    // Every depth is measured before anything is asserted: a sweep that stops
    // at its first failure reports one point again, which is the shape of
    // evidence that let this bug through.
    let mut problems: Vec<String> = Vec::new();
    for (start, end) in [(4u32, 6u32), (1u32, 3u32)] {
        let address = format!("f.txt#L{start}-L{end}");
        for depth in 0..end {
            let span = format!("d{start}{depth}");
            let repo = truncated_to_depth_repo(&span, start, end, depth)?;
            assert!(
                repo.path().join("f.txt").exists(),
                "fixture assumption: at depth {depth} the file is present, only shorter"
            );
            let past_eof = depth < start;
            let where_ = format!("{address} over a {depth}-line file");

            // Aperture 1: the working-tree read.
            let live = history_json(&repo, &span)?;
            let live_anchor =
                sole_anchor_in(&live["current"], &address, &format!("current[], {where_}"));
            if past_eof {
                if payload_fields(live_anchor) != (None, Some("range-past-eof")) {
                    problems.push(format!(
                        "  current[], {where_}: overlaps zero lines, so it is past end \
                         of file at every depth in that zone; got {:?}",
                        payload_fields(live_anchor)
                    ));
                }
            } else {
                let clipped: String = (start..=depth).map(|i| format!("line{i}\n")).collect();
                if payload_fields(live_anchor) != (Some(clipped.as_str()), None) {
                    problems.push(format!(
                        "  current[], {where_}: overlaps the file, so it is clipped to \
                         {clipped:?}; got {:?}",
                        payload_fields(live_anchor)
                    ));
                }
            }

            // Aperture 2: the same state read back out of a commit.
            let summary = format!("truncate to {depth} lines");
            repo.commit_all(&summary)?;
            let after = history_json(&repo, &span)?;
            let entry = commit_with(&after, &summary);
            let committed = sole_anchor_in(entry, &address, &format!("commits[], {where_}"));
            // Presence before value, in sweep form: at the boundary this object
            // carried no `unavailable` key at all and a fabricated
            // emptied-extent hunk, which reads as agreement to anything that
            // compares values.
            let committed_reason = committed.get("unavailable").and_then(Value::as_str);
            match (past_eof, committed_reason) {
                (true, Some("range-past-eof")) | (false, None) => {}
                (true, Some(other)) => problems.push(format!(
                    "  commits[], {where_}: the commit read says {other:?}"
                )),
                (true, None) => problems.push(format!(
                    "  commits[], {where_}: no `unavailable` key at all — a body was \
                     fabricated for a range the file does not have: {committed:#}"
                )),
                (false, Some(other)) => problems.push(format!(
                    "  commits[], {where_}: the range overlaps the file, so there is \
                     something to show, but the commit read says {other:?}"
                )),
            }
            // The two apertures are compared on `unavailable` alone: `content`
            // is a `current[]`-only key (a timeline object carries its bytes in
            // `diff`), so comparing full payloads would fail in the clip zone
            // for a reason that has nothing to do with this boundary.
            let live_reason = live_anchor.get("unavailable").and_then(Value::as_str);
            if live_reason != committed_reason {
                problems.push(format!(
                    "  {where_}: one file state, two accounts — current[] says \
                     {live_reason:?}, commits[] says {committed_reason:?}"
                ));
            }

            // Both formats carry the same block, as the rest of this section
            // asserts for its single-depth fixtures.
            let diff = committed["diff"].as_str().expect("diff string");
            let text = history_text(&repo, &span)?;
            if !text.contains(diff) {
                problems.push(format!(
                    "  {where_}: the text render does not carry the JSON's block:\n{text}"
                ));
            }
        }
    }
    assert!(
        problems.is_empty(),
        "{} depth(s) across the boundary render wrongly:\n{}",
        problems.len(),
        problems.join("\n")
    );
    Ok(())
}


/// The default output must tell a past-EOF range from an absent file, on a
/// *matched* pair: same anchor, same declared address, same recorded content.
///
/// The JSON half of this obligation has been green for rounds. The human half
/// was never looked at, and it carried no distinction at all: `+++ /dev/null`
/// over the same deletion hunk for both states, byte for byte. That is the
/// format the command produces by default, and the two states want opposite
/// repairs — restore the file, or re-anchor onto one that is sitting right
/// there — so the reader of the default output was pointed at the wrong repair
/// exactly half the time and had no way to know it.
///
/// The comparison is matched-form deliberately. An honest empty extent
/// necessarily uses a whole-file address (a line range over an empty file *is*
/// past-EOF), so any contrast drawn against it also varies the address shape and
/// cannot separate "the renderer distinguishes these states" from "the addresses
/// happen to differ". These two fixtures differ in nothing but the state.
///
/// ORACLE — `git span stale`, which separates the same two states in prose on
/// the same fixtures, and the file system.
#[test]
fn the_human_format_tells_a_past_eof_range_from_an_absent_file() -> Result<()> {
    let past_eof = truncated_to_depth_repo("hp", 4, 6, 3)?;
    let absent = truncated_to_depth_repo("ha", 4, 6, 3)?;
    std::fs::remove_file(absent.path().join("f.txt"))?;

    let past_eof_text = history_text(&past_eof, "hp")?;
    let absent_text = history_text(&absent, "ha")?;
    let past_eof_block = diff_block(&past_eof_text, "f.txt#L4-L6");
    let absent_block = diff_block(&absent_text, "f.txt#L4-L6");

    // Fail closed: if the two fixtures stopped reaching two different states,
    // the blocks would differ for the wrong reason (or not at all).
    assert_eq!(
        payload_fields(sole_anchor_in(
            &history_json(&past_eof, "hp")?["current"],
            "f.txt#L4-L6",
            "current[], truncated"
        )),
        (None, Some("range-past-eof")),
        "fixture assumption: this one is the past-EOF state"
    );
    assert_eq!(
        payload_fields(sole_anchor_in(
            &history_json(&absent, "ha")?["current"],
            "f.txt#L4-L6",
            "current[], deleted"
        )),
        (None, Some("absent")),
        "fixture assumption: this one is the absent state"
    );

    assert_ne!(
        past_eof_block, absent_block,
        "two states, one rendering — the default output cannot say which repair \
         the reader needs"
    );
    // Presence is not enough: the wave's existing human assertion checks only
    // that a bodyless block carries *a* marker, which is why this went
    // undetected. Assert the reason.
    assert!(
        past_eof_block.contains("\ncontent unavailable range-past-eof\n"),
        "the block names the reason the `/dev/null` side cannot; got:\n{past_eof_block}"
    );
    assert!(
        !absent_block.contains("content unavailable"),
        "a plain absence is honestly rendered by `/dev/null` alone and must not \
         be annotated; got:\n{absent_block}"
    );

    // The marker lives in the header, so both formats stay the same bytes — the
    // invariant that keeps `--format json`'s `diff` and the default output one
    // artifact rather than two renderings.
    let json_diff = sole_anchor_in(
        &history_json(&past_eof, "hp")?["current"],
        "f.txt#L4-L6",
        "current[], truncated",
    )["diff"]
        .as_str()
        .expect("diff string")
        .to_string();
    assert!(
        json_diff.contains("\ncontent unavailable range-past-eof\n"),
        "the marker belongs to the patch string both formats share; got:\n{json_diff}"
    );
    assert!(
        past_eof_block.contains(&json_diff),
        "the human block carries the JSON's patch string verbatim; got:\n{past_eof_block}"
    );
    Ok(())
}


/// `history` may not invent a distinction the resolver never made.
///
/// This is a different detector from the depth sweep beside it, and deliberately
/// so. The sweep asks whether `history` matches the *documented* line-range
/// predicate — it needs that predicate to be right. This asks a question with no
/// reference document in it at all: across the depths where `git span stale`
/// returns one unchanging verdict, does `history` also return one unchanging
/// answer? Two commands, one resolver state, and any disagreement is
/// manufactured downstream of it.
///
/// It is the assertion that survives being wrong about the policy. At the
/// unfixed boundary `stale` said `DELETED` at file lengths 1, 2 and 3 while
/// `history` said `range-past-eof`, `range-past-eof`, `absent` — same input,
/// same resolver verdict, two different values out. Whichever of those two
/// values one believes is correct, they cannot both be, and this catches that
/// without taking a position.
///
/// It also names the shape of the defect precisely, which matters because the
/// adjacent item 52b was its mirror image: there the resolver *computed* a
/// distinction and `history` projected it away, and the fix was to carry the
/// reason through. Here the resolver computes no distinction and `history`
/// manufactures one, so the fix is to stop.
///
/// ORACLE — `git span stale --format json`, an independently rendered read of
/// the same resolver state.
#[test]
fn history_invents_no_distinction_the_resolver_did_not_make() -> Result<()> {
    for (start, end) in [(4u32, 6u32), (1u32, 3u32)] {
        let address = format!("f.txt#L{start}-L{end}");
        // The zone where the anchored content is destroyed rather than moved:
        // every depth in it is one resolver state.
        let mut verdicts: Vec<(u32, String, Option<String>)> = Vec::new();
        for depth in 0..start {
            let span = format!("c{start}{depth}");
            let repo = truncated_to_depth_repo(&span, start, end, depth)?;
            let json = history_json(&repo, &span)?;
            let anchor = sole_anchor_in(&json["current"], &address, "current[]");
            verdicts.push((
                depth,
                stale_status(&repo, &span)?,
                anchor
                    .get("unavailable")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            ));
        }

        let resolver: Vec<&str> = verdicts.iter().map(|(_, s, _)| s.as_str()).collect();
        assert!(
            resolver.windows(2).all(|w| w[0] == w[1]),
            "fixture assumption for {address}: the resolver must see one state \
             across these depths, or there is nothing for `history` to invent \
             a distinction against; got {verdicts:?}"
        );
        let rendered: Vec<Option<&str>> = verdicts.iter().map(|(_, _, u)| u.as_deref()).collect();
        assert!(
            rendered.windows(2).all(|w| w[0] == w[1]),
            "{address}: `git span stale` returns {:?} at every one of these file \
             lengths, so the resolver drew no line between them — but `history` \
             did: {verdicts:?}",
            resolver[0]
        );
    }
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
            (content.map(str::to_string), unavailable.map(str::to_string)),
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
