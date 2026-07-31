//! Drift and re-anchor recovery: recorded snapshots, declaration swaps, rebinding.

use super::*;


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
    assert!(
        out.contains(diff),
        "the default output carries it too:\n{out}"
    );
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
    assert!(
        out.contains(diff),
        "the default output carries it too:\n{out}"
    );
    Ok(())
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
    assert!(
        out.contains(diff),
        "both formats carry the same block:\n{out}"
    );
    Ok(())
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
    assert_eq!(
        anchors.len(),
        4,
        "two deletes and two creates; got: {json:#}"
    );
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
    assert_eq!(
        anchors.len(),
        4,
        "two deletes and two creates; got: {json:#}"
    );
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
    assert_eq!(
        old_token(diff),
        before,
        "the index line names the old binding"
    );
    assert_eq!(
        new_token(diff),
        after,
        "the index line names the new binding"
    );

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
