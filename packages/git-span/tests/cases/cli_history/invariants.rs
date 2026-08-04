//! The every-state form sweeps and their neighbouring scenarios.

use super::*;


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
                pairs.iter().any(|(a, t)| a == addr && t == token)
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
                        anchor["rebound"]["from"],
                        old_token(diff),
                        "{label}: structured and patch disagree; got: {anchor:#}"
                    );
                    assert_eq!(
                        anchor["rebound"]["to"],
                        new_token(diff),
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
    assert!(
        out.contains(diff),
        "both formats carry the same block:\n{out}"
    );
    Ok(())
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
        let drift = String::from_utf8_lossy(&repo.run_span(["drift"])?.stdout).into_owned();
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
                    let measurable = anchor.get("recorded") != Some(&Value::from("unrecoverable"))
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
                    if !recorded_lines.is_empty()
                        && let Some(still_there) = read_address(&repo, a_side)
                    {
                        assert!(
                            !still_there.contains(&recorded_lines),
                            "{label}: the block claims these lines were \
                             edited away, but {a_side} still holds them:\n{diff}"
                        );
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
                        drift.contains(&format!("{path} — moved to {proposed}")),
                        "{label}: the proposal must agree with drift; got:\n{drift}"
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
            //
            // A path under a content filter is outside this oracle, not exempt
            // from one. [`read_address`] is a plain `std::fs::read_to_string`,
            // and reading the raw file is exactly the axis the filtered states
            // were rendering their *bodies* from while hashing the converted
            // ones — so asserting against it here would pin the defect rather
            // than the contract. The stronger oracle applies there instead:
            // `content_and_the_headers_new_side_name_the_same_bytes` joins the
            // printed bytes against the token `git span add` records for them,
            // which is what the `index` line claims to name.
            if anchor.get("proposed").is_none()
                && !matches!(form, BlockForm::Deleted)
                && !path_is_filtered(&repo, path)?
                && let (Some(content), Some(actual)) =
                    (anchor["content"].as_str(), read_address(&repo, path))
            {
                assert_eq!(
                    content, actual,
                    "{label}: `content` must be the bytes at `path`"
                );
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
