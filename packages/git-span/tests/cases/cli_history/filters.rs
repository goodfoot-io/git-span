//! The `.gitattributes` filter axis.

use super::*;


/// A filter that produces no content must never assert a deletion, and must
/// never call the file absent.
///
/// Both states here leave `git status --porcelain` empty and the worktree file
/// byte-identical to the blob HEAD records. The render nevertheless claimed
/// two lines had been deleted — a hunk contradicting `git diff`, which is one
/// of the two hard constraints this command is held to — and glossed a file
/// with five readable lines as "no such file at this commit".
///
/// ORACLE — `git status` and `cmp` against `HEAD:f.txt`, asserted per fixture
/// below, plus `git span drift`, which reads the same repository through the
/// same resolver and has always named this state correctly.
#[test]
fn a_filter_that_produces_no_content_never_asserts_a_deletion() -> Result<()> {
    for (label, repo, span, git_can_answer) in [
        (
            "filter named, never configured",
            unconfigured_filter_repo("uf")?,
            "uf",
            true,
        ),
        (
            "clean/smudge driver missing",
            missing_clean_driver_filter_repo("mc")?,
            "mc",
            true,
        ),
        (
            "process driver missing",
            missing_driver_filter_repo("md")?,
            "md",
            false,
        ),
    ] {
        // Fixture assumptions, measured rather than asserted in prose: the
        // anchored lines are on disk, and git either agrees nothing changed or
        // declines to answer — never "these lines are gone".
        assert_eq!(
            std::fs::read_to_string(repo.path().join("f.txt"))?,
            "l1\nl2\nl3\nl4\nl5\n",
            "{label}: the fixture is supposed to leave f.txt untouched"
        );
        let status = std::process::Command::new("git")
            .current_dir(repo.path())
            .args(["status", "--porcelain"])
            .output()?;
        if git_can_answer {
            assert!(
                status.status.success() && status.stdout.is_empty(),
                "{label}: the fixture is supposed to leave the worktree clean; \
                 got {status:?}"
            );
        } else {
            // The stronger comparison: git *cannot read this state at all* and
            // fails closed. A render that answers where git refuses is
            // answering from something other than the repository.
            //
            // Naming the driver in the message is what makes this a fixture
            // assumption rather than a claim about exit codes: it says git
            // reached the filter and the filter is what stopped it. An exit
            // code alone would also be satisfied by a repository that failed
            // for some unrelated reason.
            let refusal = String::from_utf8_lossy(&status.stderr);
            assert!(
                !status.status.success() && refusal.contains("git-crypt-filter"),
                "{label}: fixture assumption — git itself refuses this state, \
                 naming the driver it could not run; got {status:?}"
            );
            assert!(
                status.stdout.is_empty(),
                "{label}: git refused rather than reporting a change; \
                 got {status:?}"
            );
        }

        let json = history_json(&repo, span)?;
        let anchors = json["current"]["anchors"]
            .as_array()
            .unwrap_or_else(|| panic!("{label}: no current anchors in {json:#}"));
        assert_eq!(anchors.len(), 1, "{label}: one anchor; got: {json:#}");
        let anchor = &anchors[0];
        let diff = anchor["diff"].as_str().expect("diff string");

        // The structured field is the contract, and `absent` is affirmatively
        // false here — the reason the resolver computed has to survive the
        // trip rather than collapsing into the nearest available word.
        assert_eq!(
            anchor["unavailable"], "filter-failed",
            "{label}: the resolver's reason must reach the field; got: {anchor:#}"
        );
        // Nothing was deleted. Not a hunk, not a `/dev/null` side, not a
        // signed line — the block states the two tokens and why there are no
        // bytes, and stops.
        assert!(
            !diff.contains("@@"),
            "{label}: a hunk here asserts an edit git denies; got:\n{diff}"
        );
        assert!(
            !diff.contains("/dev/null"),
            "{label}: the file is present; got:\n{diff}"
        );
        assert!(
            !diff
                .lines()
                .any(|l| l.starts_with('-') && !l.starts_with("---")),
            "{label}: no line left this file; got:\n{diff}"
        );
        assert!(
            anchor.get("content").is_none(),
            "{label}: there are no bytes to publish; got: {anchor:#}"
        );
        // A bodyless block with nothing explaining the emptiness is the shape
        // the marker lines exist to prevent.
        assert!(
            diff.contains("\ncontent unavailable filter-failed\n"),
            "{label}: an empty body needs its explanation; got:\n{diff}"
        );
        let out = history_text(&repo, span)?;
        assert!(
            out.contains(diff),
            "{label}: both formats carry the same block:\n{out}"
        );

        // The other surface over the same resolver has always been right about
        // this state; the two must not describe one repository two ways.
        // `drift` reports it as `content unavailable (filter failed)` where it
        // can resolve at all and errors out where it cannot — either way it
        // attributes the state to the filter, and never to a missing file.
        let out = repo.run_span(["drift"])?;
        let drift = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            drift.contains("filter"),
            "{label}: fixture assumption — `drift` names the filter; got:\n{drift}"
        );
        assert!(
            !drift.contains("deleted") && !drift.contains("no such file"),
            "{label}: the other surface never called this a deletion; got:\n{drift}"
        );
    }
    Ok(())
}


/// A working filter is not a failed one, and no `unavailable` value describes
/// it. What it breaks is the join between `content` and the header: the hash
/// was computed over the filtered bytes and the body read from the raw ones,
/// so a consumer joining the two got a mismatch by construction.
///
/// ORACLE — [`token_recorded_for`], which declares the printed bytes in a
/// throwaway repository and reads back the token `git span add` writes for
/// them. That is the same reconstruction that proved the mechanism.
#[test]
fn content_and_the_headers_new_side_name_the_same_bytes() -> Result<()> {
    let repo = working_filter_repo("wf")?;
    assert_eq!(
        repo.git_stdout(["show", "HEAD:f.txt"])?.trim_end(),
        std::fs::read_to_string(repo.path().join("f.txt"))?.trim_end(),
        "fixture assumption — f.txt itself is never touched"
    );

    let json = history_json(&repo, "wf")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors");
    assert_eq!(anchors.len(), 1, "one anchor; got: {json:#}");
    let anchor = &anchors[0];
    let diff = anchor["diff"].as_str().expect("diff string");

    // Nothing failed, so nothing may claim it did.
    assert!(
        anchor.get("unavailable").is_none(),
        "the filter produced content; got: {anchor:#}"
    );
    let content = match anchor["content"].as_str() {
        Some(text) => text.to_string(),
        None => new_side_body(diff),
    };
    assert!(
        !content.is_empty(),
        "the new side has bytes somewhere; got: {anchor:#}"
    );
    assert_eq!(
        token_recorded_for(&content)?,
        new_token(diff),
        "the header names the hash of the bytes on the side wearing `path`; \
         got content {content:?} against:\n{diff}"
    );
    Ok(())
}


/// `git span add` refuses to declare a range that runs past its file; the
/// render path must reach the same verdict about the same condition rather
/// than supplying the missing lines from a second read.
///
/// The filtered content is three lines, so `#L4-L5` has no bytes on the axis
/// the hash is computed over. That was detected — it is what produced the null
/// token — and then dropped: `unavailable` was absent and `content` came back
/// `"l4\nl5\n"` from the other read. One object, two files.
///
/// ORACLE — `git span add` on the same three-line content, which is the
/// project's own statement of what this condition means.
#[test]
fn a_range_past_the_filtered_end_reaches_a_structured_field() -> Result<()> {
    let repo = working_filter_past_eof_repo("wp")?;
    let json = history_json(&repo, "wp")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors");
    assert_eq!(anchors.len(), 1, "one anchor; got: {json:#}");
    let anchor = &anchors[0];
    let diff = anchor["diff"].as_str().expect("diff string");

    assert_eq!(
        anchor["unavailable"], "range-past-eof",
        "the declared range runs past the content git records; got: {anchor:#}"
    );
    // The null token is the *ambiguous* half of this state; `content` beside it
    // was the fabrication, supplying bytes for an extent that has none.
    assert_eq!(
        new_token(diff),
        "0000000000000000",
        "no bytes, no fingerprint; got:\n{diff}"
    );
    assert!(
        anchor.get("content").is_none(),
        "an extent with no bytes has no content to print; got: {anchor:#}"
    );
    assert!(
        diff.contains("\ncontent unavailable range-past-eof\n"),
        "the `/dev/null` convention cannot say the file is present and the \
         range is not; got:\n{diff}"
    );
    Ok(())
}


/// The negative control the two defects above are measured against: an
/// ordinary uncommitted edit, no `.gitattributes` anywhere. It must still
/// render a full hunk, a real new-side token, and `content` — the fixes are
/// not allowed to buy honesty by rendering less everywhere.
///
/// ORACLE — [`token_recorded_for`] again, over the bytes actually on disk.
#[test]
fn an_unfiltered_worktree_edit_still_renders_its_whole_hunk() -> Result<()> {
    let repo = drifted_repo("nc")?;
    assert!(
        !repo.path().join(".gitattributes").exists(),
        "fixture assumption — the control carries no filter"
    );
    let json = history_json(&repo, "nc")?;
    let anchors = json["current"]["anchors"]
        .as_array()
        .expect("current anchors");
    assert_eq!(anchors.len(), 1, "one anchor; got: {json:#}");
    let anchor = &anchors[0];
    let diff = anchor["diff"].as_str().expect("diff string");
    let path = anchor["path"].as_str().expect("path string");

    assert!(
        anchor.get("unavailable").is_none(),
        "nothing is unavailable in the control; got: {anchor:#}"
    );
    assert!(diff.contains("@@"), "the edit is a real hunk; got:\n{diff}");
    let on_disk = read_address(&repo, path).expect("the anchored lines are on disk");
    assert_eq!(
        new_token(diff),
        token_recorded_for(&on_disk)?,
        "the new side names the bytes the user can see; got:\n{diff}"
    );
    assert!(
        diff.lines()
            .any(|l| l.starts_with('+') && !l.starts_with("+++")),
        "the new bytes are in the body; got:\n{diff}"
    );
    Ok(())
}
