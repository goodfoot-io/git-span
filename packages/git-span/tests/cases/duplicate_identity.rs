//! Duplicate `(path, start_line, end_line)` identities, and the commands
//! that resolve them (card main-231).
//!
//! A span file can carry two records for one identity with different
//! content hashes. It parses cleanly and is invisible to validation, so the
//! repair has to come from the mutation commands. `add` retains-and-replaces
//! every record at the identity it was handed — not just the first — and
//! reports the collapse with the pre-collapse count.
//!
//! `add`'s survivor legitimately reports fresh rather than carrying the
//! collapse sentinel: the operator named exact content in this invocation
//! and the tool hashed *that* content, so the hash written is real and
//! verified. The unverified collapse paths (`drift --fix`'s span-wide sweep,
//! the merge kernel's same-side collapse) are the ones that plant the
//! sentinel, because they have no freshly-named content to lean on.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Path of the span declaration inside the repo.
fn span_path(repo: &TestRepo, name: &str) -> std::path::PathBuf {
    repo.path().join(".span").join(name)
}

/// Read the span declaration as text.
fn span_text(repo: &TestRepo, name: &str) -> Result<String> {
    Ok(std::fs::read_to_string(span_path(repo, name))?)
}

/// Hand-write a span declaration with the given body.
fn write_span(repo: &TestRepo, name: &str, body: &str) -> Result<()> {
    let p = span_path(repo, name);
    std::fs::create_dir_all(p.parent().unwrap())?;
    std::fs::write(p, body)?;
    Ok(())
}

/// Anchor lines (no `why` block) of a span declaration.
fn anchor_lines(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|l| !l.is_empty() && !l.starts_with("why:") && !l.starts_with('['))
        .collect()
}

/// The unmatchable hash `drift --fix` plants on a survivor whose discarded
/// records disagreed. Spelled out literally here rather than imported: the
/// tests must pin the on-disk token an unrelated reader sees, not track
/// whatever the constant happens to return.
const SENTINEL: &str = "rk64:ffffffffffffffff";

/// The `--fix` summary clause that ends an unverified collapse rather than
/// looping the operator back through a re-run that cannot clear it.
///
/// Spelled once so the cases that assert it and the cases that assert its
/// *absence* cannot drift apart into asserting two different sentences —
/// which would let the absence assertions pass vacuously.
const TERMINATING_ADVICE: &str = "an unverified collapse is not cleared by re-running: settle \
     each collapsed address named above with `git span add` or `git span replace`, then run git \
     span drift again";

/// Anchor `addr` in a throwaway span and return the record line the tool
/// wrote, hash and all — a *real* neighbour, not a hand-written one, so a
/// fixture's neighbour never drifts for a reason the case did not intend.
fn seed_real_line(repo: &TestRepo, addr: &str) -> Result<String> {
    repo.span_stdout(["add", "seed", addr])?;
    Ok(anchor_lines(&span_text(repo, "seed")?)
        .into_iter()
        .find(|l| l.starts_with(&format!("{addr} ")))
        .expect("the record just added")
        .to_string())
}

/// Hand-write a span declaration and commit it, so `drift` (which reads the
/// committed corpus) can see it.
fn commit_span(repo: &TestRepo, name: &str, body: &str) -> Result<()> {
    write_span(repo, name, body)?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    Ok(())
}

/// Stdout of a `git span` invocation, whatever its exit code — `drift`
/// exits non-zero whenever drift remains, which is the expected state for
/// most of these fixtures.
fn stdout_of(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

// ---------------------------------------------------------------------------
// `add` collapses every record at the identity it was handed
// ---------------------------------------------------------------------------

/// Two records, one `add`: the identity is left holding exactly one record,
/// carrying the hash `add` just computed — neither stale duplicate's.
#[test]
fn add_collapses_duplicate_identity_to_one_verified_record() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(
        &repo,
        "dup-add",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\
         \n\
         why: duplicate records from a legacy edit.\n",
    )?;

    let out = repo.run_span(["add", "dup-add", "file1.txt#L1-L5"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "the collapsed survivor carries a freshly verified hash, so the \
         span is drift-free; stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let text = span_text(&repo, "dup-add")?;
    assert_eq!(
        anchor_lines(&text).len(),
        1,
        "exactly one anchor record must remain:\n{text}"
    );
    assert!(
        !text.contains("aaaaaaaaaaaaaaaa") && !text.contains("bbbbbbbbbbbbbbbb"),
        "neither stale duplicate's hash may survive:\n{text}"
    );
    assert!(
        text.contains("why: duplicate records from a legacy edit."),
        "the why block must be preserved:\n{text}"
    );

    // The survivor's hash is the one an ordinary `add` of the same content
    // produces — real and verified, never a sentinel.
    repo.span_stdout(["add", "fresh-ref", "file1.txt#L1-L5"])?;
    let fresh = span_text(&repo, "fresh-ref")?;
    assert_eq!(
        anchor_lines(&text),
        anchor_lines(&fresh),
        "the collapsed survivor must carry the same freshly computed hash \
         an ordinary add writes:\ncollapsed:\n{text}\nfresh:\n{fresh}"
    );
    Ok(())
}

/// The human report names the collapse and the pre-collapse count.
#[test]
fn add_collapse_prints_the_collapsed_line_and_tally() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(
        &repo,
        "dup-human",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    )?;

    let out = repo.run_span(["add", "dup-human", "file1.txt#L1-L5"])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Added 0 anchors; 1 collapsed to span `dup-human`."),
        "the summary line must tally the collapse; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(
            "- collapsed: `dup-human` `file1.txt#L1-L5` (2 records → 1, hash reverified)"
        ),
        "the per-address line must name the identity and the pre-collapse \
         count; stdout:\n{stdout}"
    );
    Ok(())
}

/// Three records collapse to one, and `records_before` reports the true N —
/// grouping is by identity, not pairwise.
#[test]
fn add_collapses_three_records_and_reports_the_true_count() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(
        &repo,
        "dup-three",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\
         file1.txt#L1-L5 rk64:cccccccccccccccccccccccccccccccc\n",
    )?;

    let out = repo.run_span(["add", "dup-three", "file1.txt#L1-L5"])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("(3 records → 1, hash reverified)"),
        "the pre-collapse count must be the true N; stdout:\n{stdout}"
    );
    assert_eq!(
        anchor_lines(&span_text(&repo, "dup-three")?).len(),
        1,
        "a run of N equal-identity records collapses to exactly one"
    );
    Ok(())
}

/// `add` acts only on the addresses it was given. A duplicate at an identity
/// the operator did not name is left exactly as it was — the span-wide sweep
/// is `drift --fix`'s job, and a silent unscoped collapse here would be the
/// very failure this repair exists to close.
#[test]
fn add_leaves_unnamed_duplicate_identities_untouched() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(
        &repo,
        "dup-scope",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\
         file2.txt#L1-L5 rk64:cccccccccccccccccccccccccccccccc\n\
         file2.txt#L1-L5 rk64:dddddddddddddddddddddddddddddddd\n",
    )?;

    repo.run_span(["add", "dup-scope", "file1.txt#L1-L5"])?;

    let text = span_text(&repo, "dup-scope")?;
    assert_eq!(
        text.lines()
            .filter(|l| l.starts_with("file2.txt#L1-L5 "))
            .count(),
        2,
        "the duplicate at the unnamed identity must be untouched:\n{text}"
    );
    assert!(
        text.contains("rk64:cccccccccccccccccccccccccccccccc")
            && text.contains("rk64:dddddddddddddddddddddddddddddddd"),
        "both unnamed records must survive verbatim:\n{text}"
    );
    assert_eq!(
        text.lines()
            .filter(|l| l.starts_with("file1.txt#L1-L5 "))
            .count(),
        1,
        "the named identity is still collapsed:\n{text}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// The JSON wire shape
//
// Asserted against the literal JSON *text*, never a serde round-trip: a
// round-trip would have passed the struct-variant shape
// (`"outcome": {"COLLAPSED": {"records_before": 2}}`) just as happily, and
// that shape is exactly what must not ship — `outcome` is a bare string on
// every row so a consumer can type the field as a string and compare it
// literally.
// ---------------------------------------------------------------------------

#[test]
fn add_collapse_json_outcome_is_a_bare_string_with_a_sibling_count() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(
        &repo,
        "dup-json",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
    )?;

    let out = repo.run_span(["add", "dup-json", "file1.txt#L1-L5", "--format", "json"])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert!(
        stdout.contains("\"outcome\": \"COLLAPSED\""),
        "`outcome` must serialize as the bare string \"COLLAPSED\"; \
         stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("\"COLLAPSED\": {"),
        "`outcome` must never carry a nested object — that shape makes the \
         field heterogeneously typed across rows; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("\"records_before\": 2"),
        "the pre-collapse count rides on a sibling field of the address \
         row; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("\"schema_version\": 1"),
        "the change is purely additive, so the schema version does not \
         move; stdout:\n{stdout}"
    );
    Ok(())
}

/// The three pre-existing outcome kinds' JSON is byte-for-byte unchanged:
/// the new count field is *absent*, not `null`, on their rows.
#[test]
fn non_collapse_json_rows_omit_records_before_entirely() -> Result<()> {
    let repo = TestRepo::seeded()?;

    let added = repo.run_span(["add", "json-added", "file1.txt#L1-L5", "--format", "json"])?;
    let added = String::from_utf8_lossy(&added.stdout).into_owned();
    assert!(
        added.contains("\"outcome\": \"ADDED\""),
        "stdout:\n{added}"
    );
    assert!(
        !added.contains("records_before"),
        "an ADDED row must not carry the field at all — not even as null; \
         stdout:\n{added}"
    );

    let unchanged = repo.run_span(["add", "json-added", "file1.txt#L1-L5", "--format", "json"])?;
    let unchanged = String::from_utf8_lossy(&unchanged.stdout).into_owned();
    assert!(
        unchanged.contains("\"outcome\": \"UNCHANGED\""),
        "stdout:\n{unchanged}"
    );
    assert!(
        !unchanged.contains("records_before"),
        "an UNCHANGED row must not carry the field at all; \
         stdout:\n{unchanged}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// `drift --fix` sweeps the whole span
//
// The sweep has no operator naming content for any identity — that is the
// whole reason a divergent survivor gets an unmatchable sentinel rather than
// a borrowed hash. Collapsing restores file *shape*; it never presents
// itself as having established what the content should be.
// ---------------------------------------------------------------------------

/// A divergent duplicate collapses to one record carrying the sentinel, the
/// sweep names the identity, and a *separate*, later `drift` run — one that
/// never saw the collapse — still reports the anchor drifted.
#[test]
fn fix_collapses_divergent_duplicate_to_a_sentinel_survivor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "fix-divergent",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains(
            "collapsed duplicate identity in `fix-divergent`: `file1.txt#L1-L5` — 2 records → 1"
        ),
        "the sweep must name every identity it collapsed; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("records disagreed") && stdout.contains("git span add"),
        "a divergent collapse must say the content is unverified and name \
         the command that resolves it; stdout:\n{stdout}"
    );

    let text = span_text(&repo, "fix-divergent")?;
    assert_eq!(
        anchor_lines(&text).len(),
        1,
        "the identity must be left holding one record:\n{text}"
    );
    assert!(
        text.contains(SENTINEL),
        "the survivor of a divergent collapse carries the sentinel:\n{text}"
    );

    // A reader who saw neither the collapse nor its output still sees the
    // anchor drifting — the sentinel is durable in the file, not a one-time
    // message.
    let plain = repo.run_span(["drift"])?;
    assert_ne!(
        plain.status.code(),
        Some(0),
        "the collapsed survivor must never report fresh; stdout:\n{}",
        stdout_of(&plain)
    );
    Ok(())
}

/// An identical-hash duplicate — the same line repeated verbatim — is
/// deduplicated to its agreed hash and is *not* forced drifted. Nothing
/// about its content was ever in doubt, so manufacturing drift for it would
/// be its own failure.
#[test]
fn fix_dedupes_identical_hash_duplicate_without_manufacturing_drift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "fix-identical", "file1.txt#L1-L5"])?;
    let seeded = span_text(&repo, "fix-identical")?;
    let real_line = anchor_lines(&seeded)[0].to_string();
    commit_span(
        &repo,
        "fix-identical",
        &format!("{real_line}\n{real_line}\n\nwhy: same line twice.\n"),
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert_eq!(
        out.status.code(),
        Some(0),
        "an identical-hash duplicate must not be forced drifted; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(
            "collapsed duplicate identity in `fix-identical`: `file1.txt#L1-L5` — 2 records → 1"
        ) && stdout.contains("records agreed"),
        "the dedupe is still reported, and reported as agreed; stdout:\n{stdout}"
    );

    let text = span_text(&repo, "fix-identical")?;
    assert_eq!(anchor_lines(&text), vec![real_line.as_str()], "\n{text}");
    assert!(
        !text.contains(SENTINEL),
        "an agreed group keeps its agreed hash, never the sentinel:\n{text}"
    );
    Ok(())
}

/// The same-pass guard. The re-anchor loop iterates a resolved set computed
/// *before* the collapse, so it still holds two entries for the identity the
/// collapse just reduced to one. Without the guard the loop would overwrite
/// the sentinel with a freshly computed hash and count the one surviving
/// record twice.
///
/// The test does not stop at the first pass: it runs a second, separate
/// `--fix` and asserts that pass carries the record's *position* forward
/// while leaving the hash as the sentinel — the deferral has a completion
/// step, and the completion step makes no content claim.
#[test]
fn fix_defers_reanchor_of_a_collapsed_identity_then_tracks_its_position() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "fix-guard", "file1.txt#L3-L7"])?;
    let real_line = anchor_lines(&span_text(&repo, "fix-guard")?)[0].to_string();
    commit_span(
        &repo,
        "fix-guard",
        &format!("{real_line}\nfile1.txt#L3-L7 rk64:cccccccccccccccc\n\nwhy: guard.\n"),
    )?;

    // Two edits at once: lines inserted above the anchor (so the tracked
    // position shifts — the ordinary formatter-plus-import shape) and
    // trailing whitespace inside it (so the *real* record resolves
    // `Changed` with `content_equivalent`, i.e. `reanchor` would otherwise
    // be true on the very pass that collapses).
    repo.write_file(
        "file1.txt",
        "new1\nnew2\nline1\nline2\nline3 \nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let first = repo.run_span(["drift", "--fix"])?;
    let first_out = stdout_of(&first);
    let text = span_text(&repo, "fix-guard")?;
    assert_eq!(
        anchor_lines(&text).len(),
        1,
        "the duplicate collapses on the first pass:\n{text}"
    );
    assert!(
        text.contains("file1.txt#L3-L7 rk64:ffffffffffffffff"),
        "the sentinel must survive the same pass that could have \
         re-anchored the identity, at its unmoved coordinates:\n{text}"
    );
    assert!(
        first_out.contains("(0 updated, 0 removed)"),
        "a collapsed identity books against `identities_collapsed` alone — \
         never as a verified re-anchor, and never twice; stdout:\n{first_out}"
    );
    assert!(
        !first_out.contains("position tracked"),
        "the identity is deferred on the pass that collapsed it; \
         stdout:\n{first_out}"
    );

    // Second, separate pass: the record is now single and unambiguous, so
    // its position tracks forward.
    let second = repo.run_span(["drift", "--fix"])?;
    let second_out = stdout_of(&second);
    assert!(
        second_out.contains(
            "position tracked: `file1.txt#L3-L7` — a duplicate-collapse \
             sentinel's anchor moved to `file1.txt#L5-L9`"
        ),
        "the deferred pass completes as a position update; \
         stdout:\n{second_out}"
    );
    assert!(
        second_out.contains("run `git span add fix-guard file1.txt#L5-L9` to resolve"),
        "the line names the command that can actually close the content \
         question, at the coordinates the record now holds; \
         stdout:\n{second_out}"
    );

    let text = span_text(&repo, "fix-guard")?;
    assert_eq!(
        anchor_lines(&text),
        vec!["file1.txt#L5-L9 rk64:ffffffffffffffff"],
        "position tracked forward, content_hash left as the sentinel:\n{text}"
    );

    // Still drifted afterward: position is bookkeeping, content is a claim
    // only an operator makes.
    let plain = repo.run_span(["drift"])?;
    assert_ne!(
        plain.status.code(),
        Some(0),
        "a position update must never read as a clean bill of health; \
         stdout:\n{}",
        stdout_of(&plain)
    );
    Ok(())
}

/// A rename is *not* a tracked position for a sentinel-bearing anchor, and
/// the fix must not pretend otherwise.
///
/// Following a rename is a content match: the resolver reports `Moved` only
/// when the content at the destination hashes to the record's stored hash,
/// which the sentinel is built never to do. So the rename destination is a
/// suggestion the resolver surfaces (`needs re-anchor to …`) rather than a
/// tracked position `--fix` may write — and this anchor lands in the
/// terminal population, whose completion command is `replace`.
#[test]
fn fix_does_not_follow_a_rename_for_a_sentinel_it_cannot_confirm() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "fix-rename",
        &format!("file1.txt#L1-L5 {SENTINEL}\n\nwhy: sentinel from an earlier collapse.\n"),
    )?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename"])?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    let text = span_text(&repo, "fix-rename")?;
    assert!(
        stdout.contains("position untrackable: `file1.txt#L1-L5`")
            && stdout.contains("git span replace fix-rename file1.txt#L1-L5 <new-address>"),
        "an unconfirmable rename is the terminal residual, named as such; \
         stdout:\n{stdout}\nspan:\n{text}"
    );
    assert!(
        !stdout.contains("position tracked"),
        "the destination is a suggestion, not evidence — no coordinates may \
         be written from it; stdout:\n{stdout}"
    );
    assert_eq!(
        anchor_lines(&text),
        vec![format!("file1.txt#L1-L5 {SENTINEL}").as_str()],
        "the record is left exactly as it was:\n{text}"
    );
    // And the anchor keeps reporting: a sentinel on a vanished path must
    // not read `Fresh`, which is exactly what an all-zero sentinel would do
    // (zero is the fingerprint of a range that does not exist).
    let plain = repo.run_span(["drift"])?;
    assert_ne!(
        plain.status.code(),
        Some(0),
        "stdout:\n{}",
        stdout_of(&plain)
    );
    Ok(())
}

/// The no-op guard: an unmoved sentinel is not rewritten — and is never
/// silent about being unmoved, on this pass or any later one.
///
/// "Nothing to rewrite" is not "nothing to say". `--fix` tracks a position
/// from worktree hunks applied to a HEAD-relative range, so an already
/// *committed* shift is outside its reach entirely, and a sentinel cannot
/// take the route an ordinary anchor takes instead — relocating by finding
/// its stored hash elsewhere in the file — because it is chosen so no
/// content ever matches it. The two cases are therefore indistinguishable
/// from inside this branch: "the content did not move" and "the content
/// moved and nothing here can see it" both arrive as an unmoved record. It
/// reports on both, because the operator can tell them apart by reading the
/// lines and the tool cannot.
#[test]
fn fix_reports_the_unmoved_sentinel_it_leaves_untouched() -> Result<()> {
    for (name, neighbour_first) in [("fix-noop-after", false), ("fix-noop-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            &format!("file1.txt#L1-L5 {SENTINEL}\n"),
            "file2.txt#L10-L12",
            neighbour_first,
        )?;

        let first = repo.run_span(["drift", "--fix"])?;
        let before = span_text(&repo, name)?;
        let second = repo.run_span(["drift", "--fix"])?;
        let after = span_text(&repo, name)?;

        assert_eq!(
            before, after,
            "an unmoved sentinel is never rewritten:\nbefore:\n{before}\nafter:\n{after}"
        );
        assert!(
            anchor_lines(&after).iter().any(|l| *l == neighbour_line),
            "and the neighbour is untouched, hash included:\n{after}"
        );
        for (label, out) in [("first", &first), ("second", &second)] {
            let stdout = stdout_of(out);
            assert!(
                stdout.contains("position unconfirmed: `file1.txt#L1-L5`"),
                "the {label} pass must say the address is unconfirmed rather \
                 than pass over it in silence; stdout:\n{stdout}"
            );
            assert!(
                !stdout.contains("position tracked") && !stdout.contains("position untrackable"),
                "the {label} pass neither claims to have tracked it nor \
                 declares it terminal; stdout:\n{stdout}"
            );
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// A shift that was already committed
//
// The worst outcome this card produced, and the one that motivated the
// branch above. `--fix` sees hunks between HEAD and the working tree, so a
// shift the operator already committed is invisible to it: the record keeps
// its old line numbers while the coupled content sits several lines lower.
// Every other anchor in the same span relocates in that same run, by
// matching its stored hash against the file's new contents — a sentinel is
// the one record for which that route is closed by construction.
//
// The old code returned in silence here. The operator then read a report
// naming the address, ran the `add` it offered, and re-pointed the coupling
// at whatever lines now sat at those numbers, at exit 0. The fixtures below
// pin both ends of that: the sweep names the hazard on every pass, and `add`
// — run as the string the sweep printed, not as a hand-written argv —
// announces what it resolved instead of certifying in silence.
// ---------------------------------------------------------------------------

/// The neighbour relocates and the sentinel does not, and the report says
/// so out loud.
///
/// The neighbour is in the *same file* and below the insertion point on
/// purpose: it is the control. If it fails to move, the fixture never
/// committed a real shift and the sentinel's stillness would prove nothing.
#[test]
fn a_committed_shift_leaves_the_sentinel_reported_rather_than_silently_stale() -> Result<()> {
    for (name, neighbour_first) in [("fix-shift-after", false), ("fix-shift-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            &format!("file1.txt#L3-L5 {SENTINEL}\n"),
            "file1.txt#L8-L10",
            neighbour_first,
        )?;

        // Two lines in at the top, and *committed* — the shape `--fix`
        // cannot see.
        repo.write_file(
            "file1.txt",
            "new1\nnew2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
        )?;
        repo.run_git(["commit", "-am", "shift every line down by two"])?;

        let out = repo.run_span(["drift", "--fix"])?;
        let stdout = stdout_of(&out);
        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);

        assert!(
            lines.iter().any(|l| l.starts_with("file1.txt#L10-L12 ")),
            "{name}: the control neighbour must relocate, or this fixture \
             never committed a shift at all:\n{text}\nstdout:\n{stdout}"
        );
        assert!(
            !lines.iter().any(|l| *l == neighbour_line),
            "{name}: and it must not have stayed where it was:\n{text}"
        );
        assert!(
            lines.contains(&format!("file1.txt#L3-L5 {SENTINEL}").as_str()),
            "{name}: the sentinel keeps its coordinates — inventing new ones \
             would be a claim nothing supports:\n{text}"
        );
        assert!(
            stdout.contains(
                "position unconfirmed: `file1.txt#L3-L5` — a duplicate-collapse \
                 sentinel matches no content by construction, so nothing can \
                 confirm this address still holds the coupled content; a commit \
                 that shifted lines above it moved the content without moving \
                 this record."
            ),
            "{name}: the one thing that must never happen here is silence; \
             stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("position tracked"),
            "{name}: nothing tracked it, and saying otherwise would be the \
             invented coordinates again; stdout:\n{stdout}"
        );

        // Now type what the tool printed — the exact string, taken from the
        // line that printed it. A hand-written argv here would pass over a
        // command missing its `<NAME>` positional, which is the whole point.
        let advice = stdout
            .lines()
            .find(|l| l.contains("position unconfirmed"))
            .unwrap_or_else(|| panic!("the line asserted just above:\n{stdout}"));
        let add = repo.run_printed_command(advice, "git span add")?;
        let add_out = stdout_of(&add);
        assert_eq!(
            add.status.code(),
            Some(0),
            "{name}: the printed command must run as printed; stdout:\n{add_out}\
             \nstderr:\n{}",
            String::from_utf8_lossy(&add.stderr)
        );
        assert!(
            add_out.contains("(unverified collapse resolved)")
                && add_out.contains(
                    "Resolved an unverified collapse: 1 retired record carried \
                     the collapsed-duplicate marker"
                ),
            "{name}: `add` retired a record nothing had verified — an exit 0 \
             with no mention of it is the silent certification this fixture \
             exists to forbid; stdout:\n{add_out}"
        );

        let text = span_text(&repo, name)?;
        assert!(
            !text.contains(SENTINEL),
            "{name}: and the marker really is gone afterward:\n{text}"
        );
    }
    Ok(())
}

/// The terminal residual: the anchored path is gone, so there is no
/// position to track forward. The report names `replace`, and the two
/// completion attempts are pinned in both directions — `add` at the
/// content's real new location leaves an orphan behind, `replace` does not.
#[test]
fn fix_names_replace_for_an_untrackable_sentinel_and_add_orphans_it() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "fix-terminal",
        &format!("file2.txt#L1-L5 {SENTINEL}\n\nwhy: sentinel on a doomed path.\n"),
    )?;
    repo.run_git(["rm", "file2.txt"])?;
    repo.run_git(["commit", "-m", "delete the anchored path"])?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("position untrackable: `file2.txt#L1-L5`"),
        "a sentinel that cannot be relocated gets its own line, not a \
         silent fall-through; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("git span replace fix-terminal file2.txt#L1-L5 <new-address>"),
        "the terminal residual's completion command is `replace`; \
         stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("position tracked"),
        "no false position update may be manufactured; stdout:\n{stdout}"
    );

    // The wrong completion, reproduced as a red assertion: `add` at the
    // content's real new location installs a fresh record and leaves the
    // sentinel behind forever.
    repo.run_span(["add", "fix-terminal", "file1.txt#L1-L5"])?;
    let orphaned = span_text(&repo, "fix-terminal")?;
    assert!(
        orphaned.contains(&format!("file2.txt#L1-L5 {SENTINEL}")),
        "`add` is identity-scoped: the sentinel record at the old address \
         survives as an orphan:\n{orphaned}"
    );
    assert_eq!(
        anchor_lines(&orphaned).len(),
        2,
        "the orphan sits alongside the freshly added record:\n{orphaned}"
    );

    // The right one: `replace` retires the old identity and installs the new
    // one atomically, with no existence check on the vanished old path.
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "fix-terminal2",
        &format!("file2.txt#L1-L5 {SENTINEL}\n\nwhy: sentinel on a doomed path.\n"),
    )?;
    repo.run_git(["rm", "file2.txt"])?;
    repo.run_git(["commit", "-m", "delete the anchored path"])?;

    let replaced = repo.run_span([
        "replace",
        "fix-terminal2",
        "file2.txt#L1-L5",
        "file1.txt#L1-L5",
    ])?;
    assert_eq!(
        replaced.status.code(),
        Some(0),
        "stderr:\n{}",
        String::from_utf8_lossy(&replaced.stderr)
    );
    let text = span_text(&repo, "fix-terminal2")?;
    assert!(
        !text.contains(SENTINEL) && !text.contains("file2.txt"),
        "the old identity's sentinel record is gone with no orphan \
         anywhere in the file:\n{text}"
    );
    assert_eq!(
        anchor_lines(&text).len(),
        1,
        "one freshly hashed record at the new identity:\n{text}"
    );
    Ok(())
}

/// The third-party read: a collapse, then an *unrelated* `--fix` pass that
/// re-anchors a different anchor entirely. A reader who saw neither
/// invocation still finds the collapse sentinel in the file and still sees
/// the anchor reported drifted.
#[test]
fn a_collapse_survives_an_unrelated_later_fix_pass() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "fix-third-party", "file2.txt#L10-L14"])?;
    let neighbor = anchor_lines(&span_text(&repo, "fix-third-party")?)[0].to_string();
    commit_span(
        &repo,
        "fix-third-party",
        &format!(
            "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
             file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
             {neighbor}\n\
             \nwhy: one duplicate, one ordinary neighbor.\n"
        ),
    )?;

    repo.run_span(["drift", "--fix"])?;

    // An unrelated edit to the neighbor anchor only: whitespace-equivalent,
    // so the next pass re-anchors it and nothing else.
    let mut lines: Vec<String> = std::fs::read_to_string(repo.path().join("file2.txt"))?
        .lines()
        .map(str::to_string)
        .collect();
    lines[9].push(' ');
    repo.write_file("file2.txt", &format!("{}\n", lines.join("\n")))?;
    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);

    let text = span_text(&repo, "fix-third-party")?;
    assert!(
        text.contains(&format!("file1.txt#L1-L5 {SENTINEL}")),
        "the collapse state survives an intervening, unrelated pass; \
         stdout:\n{stdout}\nspan:\n{text}"
    );
    let plain = repo.run_span(["drift"])?;
    assert_ne!(
        plain.status.code(),
        Some(0),
        "and a plain drift still reports it; stdout:\n{}",
        stdout_of(&plain)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// `doctor` surfaces the duplicate before an operator trips over it
//
// A duplicate is well-formed text, so `parse` accepts it and `validate` has
// nothing to say. Unprompted, it shows itself only later — as one identity
// reported in two drift states when the records disagree, or as a silently
// doubled record when they agree. Doctor names it, counts it, and names the
// command that repairs *that* finding.
//
// Both halves of the finding branch, and each branch is driven separately
// below, because the unconditional form of each was wrong for one of the two
// populations it served: `fix:` on whether the anchored path is still there
// (`add` is the one-step repair when it is, and refuses outright when it is
// not), and `why:` on whether the records' hashes agree (an agreed pair does
// not report in two states, so that clause is dropped rather than hedged).
// Every fixture carries a neighbour anchor, in both orientations, so a
// finding that swept up its neighbour or lost it could not pass.
// ---------------------------------------------------------------------------

/// Hand-write a span carrying two records at `dup` (with the two hashes
/// given) plus one ordinary, worktree-fresh record at `neighbour`, commit
/// it, and run `doctor`. `neighbour_first` chooses the file order.
///
/// The neighbour's hash is the real one — seeded through `add` and copied
/// out — so it resolves `Fresh`. That is what lets a repair run afterward be
/// judged on its exit code as well as its record set: a neighbour carrying a
/// made-up hash would drift and drag every following exit code to 1 for a
/// reason that has nothing to do with the duplicate.
///
/// Returns the repo, doctor's stdout, and its exit code.
fn doctor_over_duplicate(
    name: &str,
    dup: &str,
    hashes: (&str, &str),
    neighbour: &str,
    neighbour_first: bool,
) -> Result<(TestRepo, String, Option<i32>)> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "seed", neighbour])?;
    let seed = span_text(&repo, "seed")?;
    let neighbour_line = format!("{}\n", anchor_lines(&seed)[0]);
    let dup_lines = format!("{dup} rk64:{}\n{dup} rk64:{}\n", hashes.0, hashes.1);
    let body = if neighbour_first {
        format!("{neighbour_line}{dup_lines}\nwhy: a duplicate beside a neighbour.\n")
    } else {
        format!("{dup_lines}{neighbour_line}\nwhy: a duplicate beside a neighbour.\n")
    };
    commit_span(&repo, name, &body)?;

    let out = repo.run_span(["doctor"])?;
    let code = out.status.code();
    Ok((repo, stdout_of(&out), code))
}

/// The anchored path still exists, so `git span add` — one command, acting
/// on this identity alone — is the repair, and the finding says so with the
/// span and address already filled in.
///
/// The previous text named only `git span drift --fix`, a two-step
/// whole-repository sweep, on the reasoning that `add` fail-closes on a
/// vanished path. That reasoning is sound and it is conditional; applied
/// unconditionally it withheld the one-step fix from every operator for whom
/// it works. This runs the command the finding actually printed and asserts
/// the record set it leaves: had the finding named a command that refuses,
/// or one that swept the neighbour into the repair, the record set would say
/// so where a string match would not.
#[test]
fn doctor_names_add_for_an_existing_path_and_running_it_collapses_only_that_identity() -> Result<()>
{
    for (name, neighbour_first) in [("doc-add-after", false), ("doc-add-before", true)] {
        let (repo, stdout, code) = doctor_over_duplicate(
            name,
            "file1.txt#L1-L5",
            ("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"),
            "file2.txt#L1-L3",
            neighbour_first,
        )?;
        assert_eq!(
            code,
            Some(1),
            "doctor must exit non-zero when a duplicate identity is present; \
             stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(&format!(
                "span `{name}` carries 2 records for one anchor identity"
            )),
            "the finding names the span and the count; stdout:\n{stdout}"
        );
        assert!(
            stdout.contains("identity:     file1.txt#L1-L5"),
            "the finding names the identity; stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(&format!("fix:          git span add {name} file1.txt#L1-L5")),
            "the one-step repair is named, ready to run; stdout:\n{stdout}"
        );

        // Type what the tool printed.
        let out = repo.run_span(["add", name, "file1.txt#L1-L5"])?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "the named repair must not refuse; stderr:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );

        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);
        assert_eq!(
            lines.len(),
            2,
            "one survivor at the identity, and the neighbour still its own \
             record:\n{text}"
        );
        assert_eq!(
            lines
                .iter()
                .filter(|l| l.starts_with("file1.txt#L1-L5 "))
                .count(),
            1,
            "the duplicate is collapsed, not halved:\n{text}"
        );
        let seed = span_text(&repo, "seed")?;
        let neighbour_line = anchor_lines(&seed)[0].to_string();
        assert!(
            lines.iter().any(|l| *l == neighbour_line),
            "the neighbour is untouched, hash included — the repair is scoped \
             to the identity it was handed:\n{text}"
        );

        let after = repo.run_span(["doctor"])?;
        assert!(
            !stdout_of(&after).contains("carries 2 records for one anchor identity"),
            "and the finding is gone; stdout:\n{}",
            stdout_of(&after)
        );
    }
    Ok(())
}

/// The anchored path is gone, so `add` would refuse before it ever read the
/// span file. Here the two-step `drift --fix` is the repair, and the finding
/// says why the one-step one is unavailable rather than leaving the operator
/// to discover it by being refused.
///
/// The refusal is asserted by running `add`, not described: a finding that
/// steers around a command has to be right about that command.
#[test]
fn doctor_names_drift_fix_for_a_vanished_path_and_add_really_would_refuse() -> Result<()> {
    for (name, neighbour_first) in [("doc-gone-after", false), ("doc-gone-before", true)] {
        let (repo, stdout, code) = doctor_over_duplicate(
            name,
            "vanished.txt#L1-L5",
            ("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"),
            "file2.txt#L1-L3",
            neighbour_first,
        )?;
        assert_eq!(code, Some(1), "stdout:\n{stdout}");
        assert!(
            stdout.contains("fix:          git span drift --fix"),
            "the command that still works is named; stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("fix:          git span add"),
            "`add` is not offered when its existence probe would refuse; \
             stdout:\n{stdout}"
        );
        assert!(
            stdout.contains("`vanished.txt` is neither"),
            "the finding names the reason `add` is unavailable, against the \
             actual path; stdout:\n{stdout}"
        );

        // The steering is only honest if the refusal is real.
        let refused = repo.run_span(["add", name, "vanished.txt#L1-L5"])?;
        assert_ne!(
            refused.status.code(),
            Some(0),
            "`add` must in fact refuse the vanished path; stdout:\n{}",
            stdout_of(&refused)
        );

        // And the named repair leaves one record at the identity.
        repo.run_span(["drift", "--fix"])?;
        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);
        assert_eq!(
            lines
                .iter()
                .filter(|l| l.starts_with("vanished.txt#L1-L5 "))
                .count(),
            1,
            "the duplicate is collapsed to one record:\n{text}"
        );
        assert!(
            lines.iter().any(|l| l.starts_with("file2.txt#L1-L3 ")),
            "the neighbour survives the sweep:\n{text}"
        );
    }
    Ok(())
}

/// Two records, one hash: they agree completely about what the identity
/// tracks, so the finding must not tell the operator the identity "reports
/// in two states at once". This is the common case — `drift --fix`
/// re-anchoring two ranges onto one destination produces it — which is
/// exactly why asserting something false of it matters.
///
/// The clause is dropped, not qualified: a claim followed by its own
/// retraction reads worse than the claim never being made.
#[test]
fn doctor_agreed_hash_duplicate_is_never_described_as_two_states() -> Result<()> {
    for (name, neighbour_first) in [("doc-agree-after", false), ("doc-agree-before", true)] {
        let (_repo, stdout, code) = doctor_over_duplicate(
            name,
            "file1.txt#L1-L5",
            ("aaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaa"),
            "file2.txt#L1-L3",
            neighbour_first,
        )?;
        assert_eq!(code, Some(1), "it is still a finding; stdout:\n{stdout}");
        assert!(
            !stdout.contains("two states at once"),
            "records carrying one hash never report in two states; \
             stdout:\n{stdout}"
        );
        assert!(
            stdout.contains("carry the same content hash"),
            "the finding says what is actually true of them; stdout:\n{stdout}"
        );
    }
    Ok(())
}

/// The other side of the same branch: when the hashes really do diverge, the
/// two-state sentence is the accurate description and stays.
#[test]
fn doctor_divergent_hash_duplicate_keeps_the_two_state_description() -> Result<()> {
    for (name, neighbour_first) in [("doc-diverge-after", false), ("doc-diverge-before", true)] {
        let (_repo, stdout, _code) = doctor_over_duplicate(
            name,
            "file1.txt#L1-L5",
            ("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"),
            "file2.txt#L1-L3",
            neighbour_first,
        )?;
        assert!(
            stdout.contains("two states at once"),
            "divergent records do report in two states; stdout:\n{stdout}"
        );
    }
    Ok(())
}

/// The layer caveat, pinned against the behavior it actually describes.
///
/// Doctor reads the *effective* span, and a span file absent from the
/// worktree while present in HEAD reads as a deletion tombstone — so a
/// duplicate that lives only in HEAD is not reported at all, and
/// `drift --fix`, which writes the worktree file, would not write it either.
/// Rather than leave an operator to infer that scope from a silent report,
/// every finding's text states it: the check and the fix share one layer,
/// and restoring the worktree copy is the step that brings a HEAD-only
/// duplicate back into range of both.
#[test]
fn doctor_finding_states_the_layer_scope_a_head_only_duplicate_falls_outside() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "doc-head-only",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;
    // Take the duplicate out of the worktree, leaving it only in HEAD.
    std::fs::remove_file(span_path(&repo, "doc-head-only"))?;

    let out = repo.run_span(["doctor"])?;
    let stdout = stdout_of(&out);
    assert!(
        !stdout.contains("doc-head-only"),
        "a HEAD-only duplicate is a deletion tombstone to the effective \
         read — reporting it would name a state no command can repair; \
         stdout:\n{stdout}"
    );

    // And a reported duplicate's own text says so, so a clean report is not
    // mistaken for proof that a duplicate seen in another layer is gone.
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "doc-caveat",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;
    let out = repo.run_span(["doctor"])?;
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("present only in HEAD or the index, with no worktree"),
        "the finding carries the layer caveat; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("so it is not reported here and `git span drift --fix` would"),
        "the caveat says the scan does not see it, rather than sending the \
         operator to a fix that would silently no-op; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Restore .span/doc-caveat in the worktree first"),
        "and names the step that brings it back into range; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// The sentinel is not a value other writers may overwrite
//
// `apply_fix` plants the sentinel and then keeps running. Every later writer
// in the pass has to ask `carried_sentinel` about the record in front of it,
// not consult a set someone remembered to build: a guard keyed on "the
// identities collapsed this pass" is reachable around, because a sentinel
// planted by an *earlier* pass is still a sentinel, and its identity will
// again be certified by whatever sibling data the resolution happens to
// carry. The cases below drive the writer that got missed — coalescing —
// from both sides, plus the sequence an operator actually types afterward.
// ---------------------------------------------------------------------------

/// Seed a span whose divergent duplicate sits at `dup`, with a real,
/// worktree-fresh record at `neighbour`, and return the span text after one
/// `drift --fix`, along with the run's stdout and exit code.
///
/// Both addresses hash real content, so the neighbour resolves `Fresh` and
/// the duplicate's *other* record does too — which is exactly what puts the
/// collapsed identity into the mergeable set built from the pre-collapse
/// resolution.
fn fix_with_contiguous_neighbour(
    name: &str,
    dup: &str,
    neighbour: &str,
) -> Result<(TestRepo, String, String, Option<i32>)> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "seed", dup])?;
    repo.span_stdout(["add", "seed", neighbour])?;
    let seed = span_text(&repo, "seed")?;
    let real: Vec<String> = anchor_lines(&seed).iter().map(|l| l.to_string()).collect();
    assert_eq!(real.len(), 2, "seed must hold both real records:\n{seed}");

    // File order deliberately follows the seed's canonical sort, so the
    // duplicate and its neighbour appear in whichever order the addresses
    // put them — the caller chooses the orientation.
    let mut body = String::new();
    for line in &real {
        body.push_str(line);
        body.push('\n');
        if line.starts_with(&format!("{dup} ")) {
            body.push_str(&format!("{dup} rk64:dddddddddddddddd\n"));
        }
    }
    body.push_str("\nwhy: a divergent duplicate beside a contiguous neighbour.\n");
    commit_span(&repo, name, &body)?;

    let out = repo.run_span(["drift", "--fix"])?;
    let code = out.status.code();
    let stdout = stdout_of(&out);
    let text = span_text(&repo, name)?;
    Ok((repo, text, stdout, code))
}

/// The neighbour sits *after* the collapsed identity.
///
/// Coalescing merges contiguous ranges and writes one freshly computed union
/// hash over the survivor. Doing that to a sentinel-bearing record destroys
/// the identity *and* the marker in one write: the run prints "content
/// unverified, reported drifted" and then exits 0 with a file that says the
/// opposite, permanently.
#[test]
fn coalescing_never_merges_a_sentinel_with_a_following_neighbour() -> Result<()> {
    let (_repo, text, stdout, code) =
        fix_with_contiguous_neighbour("coalesce-after", "file1.txt#L3-L5", "file1.txt#L6-L7")?;

    assert!(
        text.contains(&format!("file1.txt#L3-L5 {SENTINEL}")),
        "the sentinel survives coalescing at its own identity; stdout:\n\
         {stdout}\nspan:\n{text}"
    );
    assert!(
        !text.contains("file1.txt#L3-L7"),
        "the sentinel must never become an operand of a merge — a union \
         hash over it is a verified claim nothing verified; stdout:\n\
         {stdout}\nspan:\n{text}"
    );
    assert_eq!(
        anchor_lines(&text).len(),
        2,
        "the neighbour is left as its own record:\n{text}"
    );
    assert_eq!(
        code,
        Some(1),
        "the run that reports an unverified collapse must not also report \
         success; stdout:\n{stdout}"
    );
    Ok(())
}

/// The neighbour sits *before* the collapsed identity.
///
/// The same laundering is reachable from either side, so a fix written
/// against one orientation leaves the other live. This is the mirror of the
/// case above and asserts the same three facts.
#[test]
fn coalescing_never_merges_a_sentinel_with_a_preceding_neighbour() -> Result<()> {
    let (_repo, text, stdout, code) =
        fix_with_contiguous_neighbour("coalesce-before", "file1.txt#L3-L5", "file1.txt#L1-L2")?;

    assert!(
        text.contains(&format!("file1.txt#L3-L5 {SENTINEL}")),
        "the sentinel survives with the neighbour ahead of it; stdout:\n\
         {stdout}\nspan:\n{text}"
    );
    assert!(
        !text.contains("file1.txt#L1-L5"),
        "no union may absorb the sentinel from the left either; stdout:\n\
         {stdout}\nspan:\n{text}"
    );
    assert_eq!(anchor_lines(&text).len(), 2, "\n{text}");
    assert_eq!(code, Some(1), "stdout:\n{stdout}");
    Ok(())
}

/// The sequence, not the invocation.
///
/// Asserting "the sentinel survives `--fix`" is not enough on its own: when
/// coalescing destroyed the identity, the operator who typed the instruction
/// the tool had just printed landed in `add`'s *Added* branch and created a
/// second, overlapping anchor over lines the merged record already covered —
/// at exit 0, invisible to `drift`, `--fix`, and `doctor` forever after. So
/// this runs the printed command and asserts the resulting record set.
///
/// "Runs the printed command" is literal, and the earlier version of this
/// test is why it has to be. It asserted the printed string and then called
/// `run_span(["add", "coalesce-seq", "file1.txt#L3-L5"])` — supplying the
/// span name the printed command had left out. The command it typed was not
/// the command the tool printed, so it went green while every operator who
/// pasted the real one got `error: the following required arguments were not
/// provided: <ANCHORS>` and exit 2. The argv now comes out of the stdout
/// under test and nowhere else.
#[test]
fn following_the_printed_command_after_a_collapse_leaves_no_overlapping_anchor() -> Result<()> {
    let (repo, text, stdout, _code) =
        fix_with_contiguous_neighbour("coalesce-seq", "file1.txt#L3-L5", "file1.txt#L6-L7")?;
    assert!(text.contains(SENTINEL), "precondition:\n{text}");
    assert!(
        stdout.contains("git span add coalesce-seq file1.txt#L3-L5"),
        "the collapse names the span and the address it is talking about; \
         stdout:\n{stdout}"
    );

    // Type what the tool printed — extracted from stdout, never rebuilt.
    let out = repo.run_printed_command(&stdout, "git span add ")?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "stderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let text = span_text(&repo, "coalesce-seq")?;
    let lines = anchor_lines(&text);
    assert_eq!(
        lines.len(),
        2,
        "the identity is resolved in place — never added alongside a record \
         that already covers those lines:\n{text}"
    );
    assert!(
        !text.contains(SENTINEL),
        "the operator's own hash retires the marker:\n{text}"
    );
    assert!(
        lines.iter().any(|l| l.starts_with("file1.txt#L3-L5 "))
            && lines.iter().any(|l| l.starts_with("file1.txt#L6-L7 ")),
        "both original identities remain, distinct and non-overlapping:\n{text}"
    );

    let plain = repo.run_span(["drift"])?;
    assert_eq!(
        plain.status.code(),
        Some(0),
        "and the span is genuinely resolved afterward; stdout:\n{}",
        stdout_of(&plain)
    );
    Ok(())
}

/// The control the finding names, restated as an assertion: a collapse with
/// **no** contiguous neighbour keeps the sentinel and exits 1. This is the
/// shape every pre-existing case used, which is why they all passed while
/// the neighbour case was live — it must keep passing, and it must not be
/// the only shape covered.
#[test]
fn a_collapse_with_no_neighbour_still_keeps_its_sentinel() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "seed", "file1.txt#L3-L5"])?;
    let real = anchor_lines(&span_text(&repo, "seed")?)[0].to_string();
    commit_span(
        &repo,
        "no-neighbour",
        &format!("{real}\nfile1.txt#L3-L5 rk64:dddddddddddddddd\n\nwhy: alone.\n"),
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    assert_eq!(out.status.code(), Some(1), "stdout:\n{}", stdout_of(&out));
    let text = span_text(&repo, "no-neighbour")?;
    assert_eq!(
        anchor_lines(&text),
        vec![format!("file1.txt#L3-L5 {SENTINEL}").as_str()],
        "\n{text}"
    );
    Ok(())
}

/// The other control: an *agreed* duplicate carries no sentinel, so it is
/// still an ordinary mergeable record. The barrier must key on the marker,
/// not on "was collapsed this pass" — otherwise fixing the laundering would
/// quietly stop normalizing a span whose content was never in doubt.
#[test]
fn an_agreed_collapse_still_coalesces_with_its_neighbour() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "seed", "file1.txt#L3-L5"])?;
    repo.span_stdout(["add", "seed", "file1.txt#L6-L7"])?;
    let seed = span_text(&repo, "seed")?;
    let real: Vec<String> = anchor_lines(&seed).iter().map(|l| l.to_string()).collect();
    let dup = real
        .iter()
        .find(|l| l.starts_with("file1.txt#L3-L5 "))
        .expect("seeded record")
        .clone();
    let neighbour = real
        .iter()
        .find(|l| l.starts_with("file1.txt#L6-L7 "))
        .expect("seeded record")
        .clone();
    commit_span(
        &repo,
        "agreed-coalesce",
        &format!("{dup}\n{dup}\n{neighbour}\n\nwhy: the same line twice.\n"),
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert_eq!(
        out.status.code(),
        Some(0),
        "an agreed dedupe manufactures no drift; stdout:\n{stdout}"
    );
    let text = span_text(&repo, "agreed-coalesce")?;
    assert!(
        !text.contains(SENTINEL),
        "an agreed group keeps its agreed hash:\n{text}"
    );
    assert_eq!(
        anchor_lines(&text).len(),
        1,
        "and the deduplicated record still normalizes with its contiguous \
         neighbour into one range:\n{text}"
    );
    assert!(
        text.contains("file1.txt#L3-L7 "),
        "the union covers both original extents:\n{text}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// The summary counters account for the collapse
//
// A collapse books in neither `anchors_updated` nor `anchors_removed` — by
// design, since it is neither a verified re-anchor nor an interior-anchor
// excision — so a `--fix` run that destroyed a record announced the collapse
// and then, two lines later, printed `Updated 0 anchors (0 updated, 0
// removed)`: the run's own accounting denying work it had just done. The
// advice was the second half of the same problem. "Run git span drift again"
// is a closed loop for an unverified collapse, whose survivor carries a hash
// no content can match, so every re-run reports the identical drift forever.
//
// Both fixtures below carry a neighbour, in both orientations, and each
// asserts the resulting record set alongside the line — a counter that reads
// right over a file that is wrong is the failure this card exists to close.
// ---------------------------------------------------------------------------

/// A divergent collapse beside a contiguous neighbour, in both orientations.
/// The counters name the collapse, and the advice names the step that ends
/// the state rather than the one that repeats it.
#[test]
fn the_fix_summary_counts_a_divergent_collapse_and_names_the_step_that_ends_it() -> Result<()> {
    for (name, dup, neighbour, orientation) in [
        (
            "count-after",
            "file1.txt#L3-L5",
            "file1.txt#L6-L7",
            "neighbour after",
        ),
        (
            "count-before",
            "file1.txt#L3-L5",
            "file1.txt#L1-L2",
            "neighbour before",
        ),
    ] {
        // Built locally rather than through `fix_with_contiguous_neighbour`:
        // that helper leaves its hash-donor span in the corpus, and this test
        // asserts corpus-wide counters, which the donor's own coalescing
        // would inflate. The fixture is otherwise identical — a divergent
        // duplicate beside a contiguous, worktree-fresh neighbour.
        let repo = TestRepo::seeded()?;
        repo.span_stdout(["add", "donor", dup])?;
        repo.span_stdout(["add", "donor", neighbour])?;
        let donor = span_text(&repo, "donor")?;
        let real: Vec<String> = anchor_lines(&donor).iter().map(|l| l.to_string()).collect();
        std::fs::remove_file(span_path(&repo, "donor"))?;

        let mut body = String::new();
        for line in &real {
            body.push_str(line);
            body.push('\n');
            if line.starts_with(&format!("{dup} ")) {
                body.push_str(&format!("{dup} rk64:dddddddddddddddd\n"));
            }
        }
        body.push_str("\nwhy: a divergent duplicate beside a contiguous neighbour.\n");
        commit_span(&repo, name, &body)?;

        let out = repo.run_span(["drift", "--fix"])?;
        let code = out.status.code();
        let stdout = stdout_of(&out);
        let text = span_text(&repo, name)?;

        // The record set first: the line is only worth reading if the file
        // behind it is what the line claims.
        let lines = anchor_lines(&text);
        assert_eq!(
            lines.len(),
            2,
            "{orientation}: three records collapse to two — the survivor and \
             the untouched neighbour:\n{text}"
        );
        assert!(
            lines.contains(&format!("{dup} {SENTINEL}").as_str()),
            "{orientation}: the survivor keeps the unverified marker:\n{text}"
        );
        assert!(
            lines.iter().any(|l| l.starts_with(&format!("{neighbour} "))),
            "{orientation}: the neighbour is untouched:\n{text}"
        );

        assert!(
            stdout.contains(
                "Updated 0 anchors (0 updated, 0 removed); collapsed 1 duplicate identity \
                 (1 record dropped, 1 unverified); 1 anchor remains drifted"
            ),
            "{orientation}: the counters must account for the record the \
             collapse destroyed instead of reporting a run that did nothing; \
             stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(TERMINATING_ADVICE),
            "{orientation}: `run git span drift again` on its own is a closed \
             loop — the sentinel matches no content, so the same report \
             returns forever; stdout:\n{stdout}"
        );
        assert_eq!(code, Some(1), "{orientation}: stdout:\n{stdout}");
    }
    Ok(())
}

/// The advice that ends the state must outlive the pass that planted the
/// sentinel.
///
/// Gating it on "did *this* pass collapse something unverified" gets the
/// first run right and every run after it wrong. The sentinel is durable in
/// the file; pass 2 finds the same unverified record, still cannot clear it
/// by re-running, and — under the old gate — was told to run `drift` again.
/// That is the closed loop this card exists to remove, restored on the
/// second invocation.
///
/// Both passes run back to back with the span file untouched in between, so
/// the only difference between them is which pass performed the collapse.
#[test]
fn the_terminating_advice_survives_the_pass_that_performed_the_collapse() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let neighbour = seed_real_line(&repo, "file1.txt#L7-L9")?;
    commit_span(
        &repo,
        "twice",
        &format!(
            "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
             file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
             {neighbour}\n\
             \nwhy: a divergent duplicate beside a neighbour.\n"
        ),
    )?;

    let first = stdout_of(&repo.run_span(["drift", "--fix"])?);
    assert!(
        first.contains("collapsed 1 duplicate identity (1 record dropped, 1 unverified)"),
        "pass 1 performs the collapse; stdout:\n{first}"
    );
    assert!(
        first.contains(TERMINATING_ADVICE),
        "pass 1 names the step that ends the state; stdout:\n{first}"
    );

    let after_first = span_text(&repo, "twice")?;
    let second = stdout_of(&repo.run_span(["drift", "--fix"])?);
    assert_eq!(
        span_text(&repo, "twice")?,
        after_first,
        "precondition: pass 2 changes nothing, so the two runs differ only \
         in which one collapsed:\n{after_first}"
    );
    assert!(
        second.contains("collapsed"),
        "precondition: the sentinel is still reported on pass 2; \
         stdout:\n{second}"
    );
    assert!(
        !second.contains("duplicate identity"),
        "precondition: pass 2 collapses nothing — its counters describe its \
         own work, which is none; stdout:\n{second}"
    );
    assert!(
        second.contains(TERMINATING_ADVICE),
        "the advice is a fact about the drift being reported, not about the \
         pass reporting it — pass 2 faces the same unclearable record and \
         must not be told to re-run; stdout:\n{second}"
    );
    assert!(
        !second.contains("drifted — run git span drift again"),
        "and must not be told so in the plain form either; stdout:\n{second}"
    );
    Ok(())
}

/// The population that never sees the collapsing pass at all.
///
/// A sentinel arrives already planted for anyone who pulled it, merged it,
/// or checked out a branch someone else collapsed on — the population
/// `format_sentinel_preserved` exists to serve. No collapse happens in this
/// test; `--fix` finds a record it cannot clear and has no collapse tally of
/// its own to reason from. Under the old gate this operator got the closed
/// loop on their *first* and every subsequent run.
#[test]
fn a_sentinel_arriving_from_elsewhere_still_gets_the_terminating_advice() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let neighbour = seed_real_line(&repo, "file1.txt#L7-L9")?;
    commit_span(
        &repo,
        "arrived",
        &format!(
            "file1.txt#L1-L5 {SENTINEL}\n{neighbour}\n\
             \nwhy: a sentinel committed by somebody else.\n"
        ),
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        !stdout.contains("duplicate identity"),
        "precondition: nothing collapses in this run; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(TERMINATING_ADVICE),
        "an operator who inherited the sentinel must be told what ends it, \
         not handed the re-run that provably cannot; stdout:\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(1), "stdout:\n{stdout}");

    // And the command the report offers is runnable as printed.
    let followed = repo.run_printed_command(&stdout, "git span add ")?;
    assert_eq!(
        followed.status.code(),
        Some(0),
        "stderr:\n{}",
        String::from_utf8_lossy(&followed.stderr)
    );
    assert!(
        !span_text(&repo, "arrived")?.contains(SENTINEL),
        "and following it actually retires the marker:\n{}",
        span_text(&repo, "arrived")?
    );
    Ok(())
}

/// Two spans collapsing in one sweep.
///
/// The collapse lines are printed by the span loop, *above* the `## <span>`
/// headings of the report that follows, so with two spans collapsing they
/// arrive as adjacent lines with the report nowhere near them. Naming only
/// the address left the operator unable to tell which line belonged to which
/// span — and, worse, handed them two `git span add <address>` commands that
/// were missing the one argument that would have disambiguated them.
#[test]
fn two_spans_collapsing_in_one_sweep_each_name_their_own_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    for (name, addr) in [("alpha", "file1.txt#L1-L5"), ("beta", "file2.txt#L1-L5")] {
        let neighbour = seed_real_line(&repo, &format!("{}#L7-L9", addr.split('#').next().unwrap()))?;
        commit_span(
            &repo,
            name,
            &format!(
                "{addr} rk64:aaaaaaaaaaaaaaaa\n{addr} rk64:bbbbbbbbbbbbbbbb\n\
                 {neighbour}\n\nwhy: divergent duplicate.\n"
            ),
        )?;
    }

    let stdout = stdout_of(&repo.run_span(["drift", "--fix"])?);
    for (name, addr) in [("alpha", "file1.txt#L1-L5"), ("beta", "file2.txt#L1-L5")] {
        assert!(
            stdout.contains(&format!(
                "collapsed duplicate identity in `{name}`: `{addr}`"
            )),
            "each collapse line names the span it belongs to, since nothing \
             else nearby does; stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(&format!("git span add {name} {addr}")),
            "and each carries a command that is complete on its own; \
             stdout:\n{stdout}"
        );
    }

    // Both printed `add` commands run, and each settles only its own span.
    for name in ["alpha", "beta"] {
        let line = stdout
            .lines()
            .find(|l| l.contains(&format!("identity in `{name}`")))
            .unwrap_or_else(|| panic!("collapse line for `{name}`; stdout:\n{stdout}"));
        let out = repo.run_printed_command(line, "git span add ")?;
        assert_eq!(
            out.status.code(),
            Some(0),
            "stderr:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            !span_text(&repo, name)?.contains(SENTINEL),
            "`{name}` is settled by its own line:\n{}",
            span_text(&repo, name)?
        );
    }
    Ok(())
}

/// A collapse-only pass — an *agreed* duplicate, deduplicated, with a
/// non-contiguous neighbour so nothing coalesces and both counters stay
/// zero. This run rewrote the span and destroyed a record, and printed
/// nothing at all: the old summary fired only when `updated + removed > 0`,
/// so the one shape where the collapse is the *entire* result was the one
/// shape it never described.
///
/// The unverified tally is absent here rather than reported as zero: an
/// agreed group's content was never in doubt, and a "0 unverified" would
/// invite the reader to look for a doubt that does not exist.
#[test]
fn the_fix_summary_reports_a_collapse_only_pass_instead_of_staying_silent() -> Result<()> {
    for (name, dup, neighbour, orientation) in [
        (
            "collapse-only-after",
            "file1.txt#L3-L5",
            "file1.txt#L9-L10",
            "neighbour after",
        ),
        (
            "collapse-only-before",
            "file1.txt#L9-L10",
            "file1.txt#L1-L2",
            "neighbour before",
        ),
    ] {
        let repo = TestRepo::seeded()?;
        repo.span_stdout(["add", "seed", dup])?;
        repo.span_stdout(["add", "seed", neighbour])?;
        let seed = span_text(&repo, "seed")?;
        let dup_line = anchor_lines(&seed)
            .into_iter()
            .find(|l| l.starts_with(&format!("{dup} ")))
            .expect("seeded record")
            .to_string();
        let neighbour_line = anchor_lines(&seed)
            .into_iter()
            .find(|l| l.starts_with(&format!("{neighbour} ")))
            .expect("seeded record")
            .to_string();

        // The duplicate is the *same* line twice: an agreed group, so the
        // survivor keeps its verified hash and the pass has no re-anchoring
        // to do. The neighbour is deliberately non-contiguous, so coalescing
        // finds nothing to merge and both counters stay at zero.
        let body = format!("{dup_line}\n{dup_line}\n{neighbour_line}\n\nwhy: an agreed pair.\n");
        commit_span(&repo, name, &body)?;

        let out = repo.run_span(["drift", "--fix"])?;
        let stdout = stdout_of(&out);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{orientation}: an agreed dedupe manufactures no drift; \
             stdout:\n{stdout}"
        );

        let text = span_text(&repo, name)?;
        let mut lines = anchor_lines(&text);
        lines.sort_unstable();
        let mut expected = vec![dup_line.as_str(), neighbour_line.as_str()];
        expected.sort_unstable();
        assert_eq!(
            lines, expected,
            "{orientation}: the duplicate is gone and both records still \
             carry their original verified hashes — nothing was rehashed and \
             nothing was merged:\n{text}"
        );

        assert!(
            stdout.contains(
                "Reconciled 1 span, 0 anchors (0 updated, 0 removed); collapsed 1 duplicate \
                 identity (1 record dropped)."
            ),
            "{orientation}: a pass whose only result is a collapse must still \
             describe itself; stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("unverified"),
            "{orientation}: an agreed group's content was never in doubt; \
             stdout:\n{stdout}"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// A terminal verdict names this anchor's reason, not the default
// ---------------------------------------------------------------------------

/// Content that is intact in HEAD and merely not materialized in this
/// checkout is not a re-addressing problem.
///
/// The old two-way test — `Deleted` means "path deleted", everything else
/// means "no trackable history" — swept every `ContentUnavailable` variant
/// into a terminal `replace` instruction, and `replace` at the same address
/// then refused and forwarded to `add`, which reported the file as having
/// zero lines. Three commands, back to the start, file untouched. The real
/// next step is to fetch the content.
#[test]
fn a_sparse_excluded_sentinel_is_not_reported_as_untrackable() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/data.txt", "line1\nline2\nline3\nline4\n")?;
    repo.commit_all("add data file")?;
    repo.write_commit_graph()?;
    repo.span_stdout(["add", "m", "src/data.txt#L1-L3"])?;
    repo.span_stdout(["why", "m", "sentinel from an earlier collapse"])?;
    repo.commit_all("span commit")?;
    repo.write_commit_graph()?;
    repo.run_git(["sparse-checkout", "set", "--no-cone", ".span"])?;
    assert!(
        !repo.path().join("src/data.txt").exists(),
        "precondition: the file is excluded from this checkout"
    );
    // Plant the sentinel the way an earlier `--fix` leaves it: written to
    // the worktree span, not yet committed. HEAD still carries the real
    // hash, so the anchor's deepest disagreeing layer is the excluded
    // worktree file and it resolves `ContentUnavailable` — the population
    // the two-way "Deleted or nothing" test swept into a terminal verdict.
    let seeded = span_text(&repo, "m")?;
    let real = anchor_lines(&seeded)[0].to_string();
    write_span(
        &repo,
        "m",
        &seeded.replace(&real, &format!("src/data.txt#L1-L3 {SENTINEL}")),
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        !stdout.contains("position untrackable"),
        "an excluded path has not lost its history and is not mis-addressed; \
         stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("git span replace"),
        "re-addressing would overwrite a correct address with a guess; \
         stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("position not checked: `src/data.txt#L1-L3`")
            && stdout.contains("sparse excluded"),
        "the line names this anchor's own reason; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("materialize the file in this checkout"),
        "and the step that actually clears it; stdout:\n{stdout}"
    );

    // The other end of the old loop: `add` reported a four-line file as
    // having zero lines, which is a false statement about the repository.
    let add = repo.run_span(["add", "m", "src/data.txt#L1-L3"])?;
    let add_err = String::from_utf8_lossy(&add.stderr);
    assert_ne!(add.status.code(), Some(0), "stderr:\n{add_err}");
    assert!(
        !add_err.contains("exceeds file line count (0)"),
        "a file with content must never be described as empty; stderr:\n{add_err}"
    );
    assert!(
        add_err.contains("not materialized in this checkout"),
        "the error names the real condition; stderr:\n{add_err}"
    );
    Ok(())
}

/// A file that exists and is readable, truncated above the anchored end, is
/// not a deleted path — §3f's own two reasons do not cover it, and saying
/// "path deleted" about a file sitting right there is its own wrong
/// statement.
#[test]
fn a_truncated_file_is_not_reported_as_a_deleted_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "trunc",
        &format!("file1.txt#L8-L10 {SENTINEL}\n\nwhy: sentinel from an earlier collapse.\n"),
    )?;
    repo.write_file("file1.txt", "line1\nline2\nline3\n")?;
    repo.commit_all("truncate")?;
    repo.write_commit_graph()?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("position untrackable: `file1.txt#L8-L10`"),
        "this one genuinely is terminal; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("(path deleted)"),
        "the file is present and readable; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("no longer reaches the anchored range"),
        "the reason names what actually happened; stdout:\n{stdout}"
    );
    Ok(())
}

/// The `MergeConflict` control. A sentinel whose source file is mid-conflict
/// prints no terminal verdict at all, survives intact, and exits 1 against
/// an accurate conflict label. That is correct fail-closed behavior, and a
/// fix scoped to "every status that is not `Deleted`" would have broken it.
#[test]
fn a_sentinel_mid_conflict_gets_no_terminal_verdict() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "conflicted",
        &format!("file1.txt#L1-L5 {SENTINEL}\n\nwhy: sentinel from an earlier collapse.\n"),
    )?;
    repo.write_commit_graph()?;

    let base = repo.head_sha()?;
    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file("file1.txt", "side1\nline2\nline3\nline4\nline5\n")?;
    repo.commit_all("side edit")?;
    repo.run_git(["checkout", &base])?;
    repo.run_git(["checkout", "-B", "main-line"])?;
    repo.write_file("file1.txt", "main1\nline2\nline3\nline4\nline5\n")?;
    repo.commit_all("main edit")?;
    repo.write_commit_graph()?;
    // Leave the repo mid-conflict on file1.txt.
    let _ = std::process::Command::new("git")
        .args(["merge", "side"])
        .current_dir(repo.path())
        .output()?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        !stdout.contains("position untrackable") && !stdout.contains("position not checked"),
        "a file that is not resolvable yet earns no verdict about where its \
         content lives; stdout:\n{stdout}"
    );
    let text = span_text(&repo, "conflicted")?;
    assert!(
        text.contains(SENTINEL),
        "and the marker survives untouched:\n{text}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// A contended span lock fails with a diagnostic, never a silent wait
// ---------------------------------------------------------------------------

/// `--fix` prints as it sweeps, so an unbounded block on span three of ten
/// stalled the run mid-report with no output naming the cause — a CI harness
/// could only kill it, leaving `.span/` half-reconciled. The wait is now
/// announced and bounded.
#[test]
fn a_held_span_lock_fails_loudly_instead_of_blocking_forever() -> Result<()> {
    use fs4::fs_std::FileExt;

    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "locked",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;

    // Hold the advisory lock the way a concurrent `git span` process would.
    let lock_path = repo.path().join(".span").join(".locked.lock");
    let held = std::fs::File::create(&lock_path)?;
    assert!(held.try_lock_exclusive()?, "the test must own the lock");

    let started = std::time::Instant::now();
    let out = repo.run_span_with_env(["drift", "--fix"], "GIT_SPAN_LOCK_WAIT_SECS", "1")?;
    let elapsed = started.elapsed();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();

    assert!(
        elapsed < std::time::Duration::from_secs(20),
        "the run must terminate on its own, not wait to be killed \
         (took {elapsed:?})"
    );
    assert!(
        stderr.contains("waiting for another `git span` process to release span `locked`"),
        "the wait names the span it is blocked on, before blocking; \
         stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("timed out") && stderr.contains("`locked`"),
        "and giving up says so, rather than exiting silently; \
         stderr:\n{stderr}"
    );

    // The span is untouched: a run that could not take the lock must not
    // half-write it.
    let text = span_text(&repo, "locked")?;
    assert_eq!(
        anchor_lines(&text).len(),
        2,
        "the contended span is left exactly as it was:\n{text}"
    );

    FileExt::unlock(&held)?;
    Ok(())
}

/// The uncontended path stays uncontended: no warning, no wait, no
/// behavioral change for every ordinary invocation.
#[test]
fn an_uncontended_span_lock_is_silent() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "quiet",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;
    let out = repo.run_span(["drift", "--fix"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.contains("waiting for another"),
        "stderr:\n{stderr}"
    );
    assert!(
        span_text(&repo, "quiet")?.contains(SENTINEL),
        "and the sweep did its work"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// No surface hands over an address the tool has not confirmed
// ---------------------------------------------------------------------------

/// Position tracking works only while the shift is uncommitted; committing
/// is the normal end state of an edit, and after it the resolver has nothing
/// to track a sentinel by — the sentinel is built to match nothing, so no
/// hash-keyed path can find where its content went.
///
/// That is not fixable by tracking harder, so the requirement is the other
/// branch: never present the recorded address as a confirmed location. An
/// operator who runs a bare `add` there hashes whatever now occupies those
/// lines and records it as verified, silently replacing the coupling with a
/// different one.
#[test]
fn a_collapse_never_presents_its_recorded_address_as_confirmed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "seed", "file1.txt#L3-L5"])?;
    let real = anchor_lines(&span_text(&repo, "seed")?)[0].to_string();
    commit_span(
        &repo,
        "unconfirmed",
        &format!("{real}\nfile1.txt#L3-L5 rk64:dddddddddddddddd\n\nwhy: divergent.\n"),
    )?;

    let out = repo.run_span(["drift", "--fix"])?;
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains("This address is where the records were, not a location this \
                         collapse confirmed"),
        "the line says plainly that the address is unconfirmed; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("git span add unconfirmed file1.txt#L3-L5")
            && stdout.contains("git span replace unconfirmed file1.txt#L3-L5 <new-address>"),
        "and offers both completions against the question only the operator \
         can answer, each carrying the span name both commands take as their \
         first positional; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("only if the coupled content still lives there"),
        "with the condition that separates them stated, not implied; \
         stdout:\n{stdout}"
    );

    // Runnable as printed, not merely well-worded: the `add` the line
    // recommends is lifted out of this stdout and executed verbatim. The
    // argv is never rewritten here — a test that reconstructs it cannot
    // distinguish a complete command from one missing `<NAME>`, which is
    // exactly the failure the well-worded version of this line shipped with.
    let followed = repo.run_printed_command(&stdout, "git span add ")?;
    assert_eq!(
        followed.status.code(),
        Some(0),
        "the printed `add` must run as printed; stderr:\n{}",
        String::from_utf8_lossy(&followed.stderr)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// `replace` says what it did to the records it retired
//
// `replace` is the exit the collapse annotation itself now recommends, and
// it is the only command that can resolve an unverified collapse whose path
// has vanished. Both of those are correct and must keep working. What was
// wrong is that it worked mutely: it retired N records at the old identity
// and reported neither N nor the fact that one of them was a survivor
// nothing had verified, then printed `Span is drift-free.` over the result.
// An operator who ran it on the tool's own advice was told the span was
// healthy and never told what had been destroyed to make it so.
//
// The resolution itself stays: naming a new address *is* the verification
// the sentinel was waiting for. Carrying the marker onto the new record
// would make it unfalsifiable and reopen the instruction loop the previous
// phase closed; demanding an acknowledgement flag would refuse the command
// the tool had just printed. So `replace` resolves, and now narrates.
// ---------------------------------------------------------------------------

/// Seed a span holding a real record at `neighbour` plus `dup_lines` written
/// verbatim, in the orientation `neighbour_first` chooses, and commit it.
fn commit_span_beside_neighbour(
    repo: &TestRepo,
    name: &str,
    dup_lines: &str,
    neighbour: &str,
    neighbour_first: bool,
) -> Result<String> {
    repo.span_stdout(["add", "seed", neighbour])?;
    let neighbour_line = format!("{}\n", anchor_lines(&span_text(repo, "seed")?)[0]);
    let body = if neighbour_first {
        format!("{neighbour_line}{dup_lines}\nwhy: a record beside a neighbour.\n")
    } else {
        format!("{dup_lines}{neighbour_line}\nwhy: a record beside a neighbour.\n")
    };
    commit_span(repo, name, &body)?;
    Ok(neighbour_line.trim_end().to_string())
}

/// A `replace` over a collapsed, unverified survivor resolves the state —
/// and says so.
///
/// The record set is the assertion that matters: the sentinel must be gone
/// from the file entirely (not carried onto the new record, which would
/// leave the operator with no exit at all), the new identity must hold one
/// record with a real hash over real content, and the neighbour must be
/// untouched byte for byte. The message is checked too, because silence
/// over a destroyed unverified record is the defect itself.
#[test]
fn replace_narrates_the_unverified_collapse_it_resolves() -> Result<()> {
    for (name, neighbour_first) in [("rep-sent-after", false), ("rep-sent-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            &format!("file1.txt#L2-L3 {SENTINEL}\n"),
            "file2.txt#L10-L12",
            neighbour_first,
        )?;

        let out = repo.run_span(["replace", name, "file1.txt#L2-L3", "file1.txt#L4-L5"])?;
        let stdout = stdout_of(&out);
        assert_eq!(
            out.status.code(),
            Some(0),
            "naming a new address is a legitimate resolution; stderr:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(
            stdout.contains("Resolved an unverified collapse: 1 retired record carried the \
                             collapsed-duplicate marker"),
            "the destruction of an unverified record is never silent; \
             stdout:\n{stdout}"
        );
        assert!(
            stdout.contains("Naming `file1.txt#L4-L5` is that confirmation"),
            "and the message says why resolving it is legitimate, naming the \
             address that did the confirming; stdout:\n{stdout}"
        );

        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);
        assert!(
            !text.contains(SENTINEL),
            "the marker is not carried onto the new record — an unfalsifiable \
             sentinel would leave the operator no exit at all:\n{text}"
        );
        assert!(
            !text.contains("file1.txt#L2-L3"),
            "the old identity is gone with no orphan:\n{text}"
        );
        assert_eq!(
            lines.len(),
            2,
            "one new record, plus the neighbour:\n{text}"
        );
        assert!(
            lines.iter().any(|l| *l == neighbour_line),
            "the neighbour is untouched, hash included:\n{text}"
        );
        let installed = lines
            .iter()
            .find(|l| l.starts_with("file1.txt#L4-L5 "))
            .unwrap_or_else(|| panic!("the new identity must be present:\n{text}"));
        assert!(
            !installed.contains("ffffffffffffffff"),
            "the installed record carries a real hash over real content, not \
             the marker:\n{text}"
        );

        let plain = repo.run_span(["drift"])?;
        assert_eq!(
            plain.status.code(),
            Some(0),
            "and the span really is drift-free afterward, so the verdict the \
             command prints is earned; stdout:\n{}",
            stdout_of(&plain)
        );
    }
    Ok(())
}

/// `replace` destroys every record at the old identity, however many there
/// are — that is deliberate, and it is why `replace` can resolve a duplicate
/// that `add` refuses to touch. The count was a dead write: assigned and
/// never printed, so an operator who retired two records saw no evidence the
/// second had ever existed.
///
/// Asserted on the record set as well as the count: both records leave, one
/// arrives, the neighbour stays.
#[test]
fn replace_reports_every_record_it_retired_at_one_identity() -> Result<()> {
    for (name, neighbour_first) in [("rep-two-after", false), ("rep-two-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            "file1.txt#L2-L3 rk64:aaaaaaaaaaaaaaaa\n\
             file1.txt#L2-L3 rk64:bbbbbbbbbbbbbbbb\n",
            "file2.txt#L10-L12",
            neighbour_first,
        )?;

        let out = repo.run_span(["replace", name, "file1.txt#L2-L3", "file1.txt#L4-L5"])?;
        let stdout = stdout_of(&out);
        assert!(
            stdout.contains(&format!(
                "Replaced anchor on span `{name}`: retired 2 records at \
                 `file1.txt#L2-L3`, installed `file1.txt#L4-L5`."
            )),
            "the true number of destroyed records is surfaced; stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("unverified collapse"),
            "neither record carried the marker, so nothing is claimed about \
             one; stdout:\n{stdout}"
        );

        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);
        assert_eq!(lines.len(), 2, "both old records left, one arrived:\n{text}");
        assert!(
            !text.contains("file1.txt#L2-L3"),
            "no record survives at the retired identity:\n{text}"
        );
        assert!(
            lines.iter().any(|l| *l == neighbour_line),
            "the neighbour is untouched:\n{text}"
        );
    }
    Ok(())
}

/// The ordinary single-record swap keeps its singular phrasing and stays
/// quiet about collapses, so the collapse sentence means something when it
/// does appear.
#[test]
fn replace_of_one_ordinary_record_claims_no_collapse() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span_beside_neighbour(
        &repo,
        "rep-plain",
        "file1.txt#L2-L3 rk64:aaaaaaaaaaaaaaaa\n",
        "file2.txt#L10-L12",
        false,
    )?;

    let out = repo.run_span(["replace", "rep-plain", "file1.txt#L2-L3", "file1.txt#L4-L5"])?;
    let stdout = stdout_of(&out);
    assert!(
        stdout.contains(
            "Replaced anchor on span `rep-plain`: retired 1 record at \
             `file1.txt#L2-L3`, installed `file1.txt#L4-L5`."
        ),
        "singular, and still explicit about the count; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("unverified collapse"),
        "an ordinary record is not a collapse; stdout:\n{stdout}"
    );
    Ok(())
}

/// The machine-readable form carries the same two facts, so a hook is not
/// left to parse prose for them.
#[test]
fn replace_json_carries_the_retired_and_collapsed_counts() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span_beside_neighbour(
        &repo,
        "rep-json",
        &format!(
            "file1.txt#L2-L3 {SENTINEL}\n\
             file1.txt#L2-L3 rk64:aaaaaaaaaaaaaaaa\n"
        ),
        "file2.txt#L10-L12",
        true,
    )?;

    let out = repo.run_span([
        "replace",
        "rep-json",
        "file1.txt#L2-L3",
        "file1.txt#L4-L5",
        "--format",
        "json",
    ])?;
    let stdout = stdout_of(&out);
    let doc: serde_json::Value = serde_json::from_str(&stdout)?;
    assert_eq!(
        doc["retired_records"], 2,
        "both records at the old identity are counted; stdout:\n{stdout}"
    );
    assert_eq!(
        doc["retired_collapsed_duplicates"], 1,
        "and the unverified one among them is named as such; stdout:\n{stdout}"
    );
    assert_eq!(doc["retired"], "file1.txt#L2-L3");
    assert_eq!(doc["installed"], "file1.txt#L4-L5");

    let text = span_text(&repo, "rep-json")?;
    assert!(
        !text.contains(SENTINEL),
        "and the state really is resolved on disk:\n{text}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// A surface may only name a command that runs
//
// The rule the four cases below share, applied at the two surfaces that name
// commands. `add` has prechecks that run *before* the span file is opened —
// the path must exist, and the anchored range must fit inside it — and each
// one turns a recommendation into a command that exits non-zero on the
// operator. Both surfaces answer to `add_refusal`, so `drift` steering a
// `Deleted` collapse to `replace` and `doctor` withholding `add` from a
// truncated file are one rule, not two coincidences.
//
// Each case runs the command it claims is unavailable and asserts the
// refusal is real. A finding that steers around a command has to be right
// about that command, and only execution establishes that.
// ---------------------------------------------------------------------------

/// The `--fix` summary clause for a report whose every unverified collapse
/// sits on a deleted address. `add` cannot run against any of them, so the
/// clause must not offer it.
const TERMINATING_ADVICE_DELETED: &str =
    "an unverified collapse is not cleared by re-running: settle each collapsed address named \
     above with `git span replace`, then run git span drift again";

/// The `--fix` summary clause for a report whose every unverified collapse
/// sits where `add` refuses for the *range* reason rather than the existence
/// one. Byte-identical to [`TERMINATING_ADVICE_DELETED`] by design: the
/// summary narrows to `replace` on the predicate, not on which refusal fired.
const TERMINATING_ADVICE_REFUSED: &str = TERMINATING_ADVICE_DELETED;

/// A sentinel over a **truncated** file is never handed the command that
/// refuses either — the case a status-shaped gate could not see.
///
/// This is the regression for the second time this card made the same
/// mistake. The first gate on this branch keyed the "don't offer `add`" arm
/// to `AnchorStatus::Deleted`, on the stated theory that the resolver reports
/// `Deleted` both for a vanished path and for a file too short to reach the
/// anchored end. Only the first half is true. A file truncated below the
/// anchored range resolves `Changed`, sailed through the `Deleted` gate, and
/// got printed `git span add <name> <addr>` by all three surfaces — a command
/// that exits 1 with a bare `invalid anchor: end=N exceeds file line count`,
/// no `CliError` block and no next steps. `doctor`, gated on the real
/// predicate, withheld `add` for that same record in that same repository.
///
/// So the assertion is deliberately made against every surface at once,
/// including `doctor`: the point of routing them all through
/// `AddAvailability` is that they cannot disagree, and a test that checked
/// one of them would not have caught the disagreement that existed.
///
/// The neighbour is in both orientations, and the truncation is **committed**
/// — an uncommitted one leaves the file readable at HEAD and is the fixture
/// shape that hid the position-tracking defect earlier in this card.
#[test]
fn a_truncated_sentinel_is_never_offered_the_command_that_refuses() -> Result<()> {
    for (name, neighbour_first) in [("trunc-sent-after", false), ("trunc-sent-before", true)] {
        let repo = TestRepo::seeded()?;
        // A genuine divergent duplicate rather than a pre-planted sentinel,
        // so the whole chain runs for real: `doctor` sees the duplicate,
        // `--fix` collapses it and plants the marker, and `drift` reports the
        // survivor. All three then have something to say about one address,
        // which is the disagreement this test exists to forbid.
        commit_span_beside_neighbour(
            &repo,
            name,
            "file2.txt#L12-L15 rk64:1111111111111111\n\
             file2.txt#L12-L15 rk64:2222222222222222\n",
            "file1.txt#L1-L3",
            neighbour_first,
        )?;
        // `file2.txt` still exists — this is the whole point. It is simply
        // too short now for the anchored range, which is a state no drift
        // status distinguishes from an ordinary content edit.
        repo.write_file("file2.txt", "line1\nline2\n")?;
        repo.run_git(["add", "file2.txt"])?;
        repo.run_git(["commit", "-m", "truncate the anchored file"])?;

        // `doctor` first, while the duplicate is still on disk for it to
        // find; `--fix` collapses it, and `drift` then reads the survivor.
        let doctor = repo.run_span(["doctor"])?;
        let fix = repo.run_span(["drift", "--fix"])?;
        let surfaces = [
            ("doctor", doctor),
            ("drift --fix", fix),
            ("drift", repo.run_span(["drift"])?),
        ];
        for (surface, out) in surfaces {
            let stdout = stdout_of(&out);
            assert!(
                stdout.contains("2 lines long"),
                "{surface}: every surface says *why* `add` is unavailable, \
                 naming the length that makes the range unreachable; \
                 stdout:\n{stdout}"
            );
            // The rule is not "never say the word `add`" — `doctor` names the
            // refused command deliberately, inside a clause explaining that it
            // cannot repair this one, which is more useful than silence about
            // the obvious candidate. The rule is that no surface *instructs*
            // it. So the drift surfaces, which have no such explanatory frame
            // and whose every backticked command is an instruction, must not
            // carry the string at all.
            if surface == "doctor" {
                assert!(
                    stdout.contains(&format!(
                        "(`git span add {name} file2.txt#L12-L15` cannot repair this one"
                    )),
                    "doctor names the refused command only to rule it out; \
                     stdout:\n{stdout}"
                );
                assert!(
                    stdout.contains("fix:          git span drift --fix"),
                    "and the `fix:` line it does instruct is the one that \
                     runs; stdout:\n{stdout}"
                );
            } else {
                assert!(
                    !stdout.contains(&format!("git span add {name} file2.txt#L12-L15")),
                    "{surface}: `add` exits 1 at this address, and every \
                     backticked command on this surface is an instruction, so \
                     it must not appear at all; stdout:\n{stdout}"
                );
            }
        }

        // The summary narrows to `replace` on the predicate, not on status.
        let fix_stdout = stdout_of(&repo.run_span(["drift", "--fix"])?);
        assert!(
            fix_stdout.contains(TERMINATING_ADVICE_REFUSED),
            "the run summary must narrow to `replace` for a range refusal \
             exactly as it does for a missing path; stdout:\n{fix_stdout}"
        );

        // And the command the surfaces *do* name is one that runs: `replace`
        // has no existence or range check on the old address, so it retires
        // the unverified identity and installs a reachable one.
        let out = repo.run_span(["replace", name, "file2.txt#L12-L15", "file2.txt#L1-L2"])?;
        assert!(
            out.status.success(),
            "the recommended `replace` must actually run; stderr:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let anchors = anchor_lines(&span_text(&repo, name)?).join("\n");
        assert!(
            !anchors.contains(SENTINEL),
            "and it retires the sentinel rather than carrying it; span:\n{anchors}"
        );
        assert!(
            anchors.contains("file1.txt#L1-L3"),
            "the neighbour survives untouched; span:\n{anchors}"
        );
    }
    Ok(())
}

/// A sentinel whose path is gone is never handed the command that refuses —
/// not in the per-anchor line, not in the summary.
///
/// `add` and `replace` are not interchangeable here. `replace` retires every
/// record at the old identity and installs one at a new address; `add`
/// hashes content at the address it is given, which for a deleted path means
/// it exits before it reads anything. Offering it three lines under a line
/// saying the address is deleted told the operator two incompatible things
/// in one report.
#[test]
fn a_deleted_sentinel_is_never_offered_the_command_that_refuses() -> Result<()> {
    for (name, neighbour_first) in [("del-sent-after", false), ("del-sent-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            &format!("file2.txt#L1-L5 {SENTINEL}\n"),
            "file1.txt#L1-L3",
            neighbour_first,
        )?;
        repo.run_git(["rm", "file2.txt"])?;
        repo.run_git(["commit", "-m", "delete the anchored file"])?;

        // Both surfaces carry the per-anchor line; only `--fix` prints the
        // run summary, so the summary clause is asserted where it exists.
        let fix = repo.run_span(["drift", "--fix"])?;
        for (surface, out) in [("drift", repo.run_span(["drift"])?), ("drift --fix", fix)] {
            let stdout = stdout_of(&out);
            assert!(
                stdout.contains(&format!(
                    "`file2.txt` is neither tracked nor in the worktree, so \
                     `add`'s existence probe refuses before it reads the span \
                     file — run `git span replace {name} file2.txt#L1-L5 \
                     <new-address>` naming where the coupled content lives now"
                )),
                "{surface}: the line names the command that runs, and says why \
                 the other one does not; stdout:\n{stdout}"
            );
            assert!(
                !stdout.contains(&format!("git span add {name} file2.txt#L1-L5")),
                "{surface}: the command that exits non-zero must not appear \
                 anywhere in the report; stdout:\n{stdout}"
            );
            if surface == "drift --fix" {
                assert!(
                    stdout.contains(TERMINATING_ADVICE_DELETED),
                    "{surface}: the summary narrows to `replace` too — every \
                     unverified collapse in this report is on a deleted address; \
                     stdout:\n{stdout}"
                );
            }
            assert!(
                !stdout.contains(TERMINATING_ADVICE),
                "{surface}: and it must not fall back to the both-commands \
                 wording, which would put `add` back in front of the operator; \
                 stdout:\n{stdout}"
            );
        }

        // The steering is only honest if the refusal is real.
        let refused = repo.run_span(["add", name, "file2.txt#L1-L5"])?;
        assert_ne!(
            refused.status.code(),
            Some(0),
            "`add` must in fact refuse the deleted path; stdout:\n{}",
            stdout_of(&refused)
        );

        let text = span_text(&repo, name)?;
        assert!(
            anchor_lines(&text).iter().any(|l| *l == neighbour_line),
            "and the neighbour came through both passes untouched:\n{text}"
        );
    }
    Ok(())
}

/// `doctor` withholds `add` from a file that no longer reaches the anchored
/// range, for the same reason it withholds it from a vanished path.
///
/// Existence was the gate, and existence is necessary but not sufficient:
/// the file is right there, `add`'s range check rejects it anyway, and the
/// operator was sent to a command that exits 1 with the file sitting in
/// front of them. The finding now names the line count, so the reason is
/// checkable against the file rather than merely asserted.
#[test]
fn doctor_withholds_add_when_the_range_runs_past_the_end_of_the_file() -> Result<()> {
    for (name, neighbour_first) in [("doc-eof-after", false), ("doc-eof-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            "file2.txt#L1-L12 rk64:aaaaaaaaaaaaaaaa\n\
             file2.txt#L1-L12 rk64:bbbbbbbbbbbbbbbb\n",
            "file1.txt#L1-L3",
            neighbour_first,
        )?;
        // The file stays — it just stops being long enough.
        repo.write_file("file2.txt", "line1\nline2\n")?;
        repo.run_git(["commit", "-am", "truncate the anchored file"])?;

        let out = repo.run_span(["doctor"])?;
        let stdout = stdout_of(&out);
        assert_eq!(out.status.code(), Some(1), "stdout:\n{stdout}");
        assert!(
            stdout.contains("fix:          git span drift --fix"),
            "the command that still works is named; stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("fix:          git span add"),
            "and the one whose range check refuses is not; stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(&format!(
                "(`git span add {name} file2.txt#L1-L12` cannot repair this one: \
                 `file2.txt` is"
            )) && stdout.contains("2 lines long, so the anchored range runs past its end"),
            "the reason is given against the file's actual length, so the \
             operator can check it; stdout:\n{stdout}"
        );

        let refused = repo.run_span(["add", name, "file2.txt#L1-L12"])?;
        assert_ne!(
            refused.status.code(),
            Some(0),
            "`add` must in fact refuse a range past the end of the file; \
             stdout:\n{}",
            stdout_of(&refused)
        );

        // And the named repair really does collapse the duplicate.
        repo.run_span(["drift", "--fix"])?;
        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);
        assert_eq!(
            lines
                .iter()
                .filter(|l| l.starts_with("file2.txt#L1-L12 "))
                .count(),
            1,
            "the duplicate is collapsed to one record:\n{text}"
        );
        assert!(
            lines.iter().any(|l| *l == neighbour_line),
            "the neighbour survives the sweep:\n{text}"
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Two sentinels agreeing is not agreement
//
// `CollapsedIdentity::agreed_hash` reads as "the group agreed, nothing to
// doubt", and that reading has a reachable hole: when every record at the
// identity already carries the sentinel, the group agrees on a value that is
// itself the statement "nobody knows what belongs here". Two earlier
// collapses landing on one address get there, and so does a merge bringing a
// second copy of a sentinel-bearing record.
// ---------------------------------------------------------------------------

/// A group of sentinels collapses as unverified, is counted as unverified,
/// and keeps the marker.
#[test]
fn two_sentinels_at_one_identity_are_not_reported_as_agreement() -> Result<()> {
    for (name, neighbour_first) in [("dup-sent-after", false), ("dup-sent-before", true)] {
        let repo = TestRepo::seeded()?;
        let neighbour_line = commit_span_beside_neighbour(
            &repo,
            name,
            &format!("file1.txt#L1-L5 {SENTINEL}\nfile1.txt#L1-L5 {SENTINEL}\n"),
            "file2.txt#L1-L3",
            neighbour_first,
        )?;

        let out = repo.run_span(["drift", "--fix"])?;
        let stdout = stdout_of(&out);
        assert!(
            stdout.contains(&format!(
                "collapsed duplicate identity in `{name}`: `file1.txt#L1-L5` — 2 \
                 records → 1 (every record already carried the unverified \
                 marker; content is still unverified, reported drifted)"
            )),
            "the same doubt twice is still doubt, and the line says which \
             kind; stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("records agreed"),
            "agreeing on `nobody knows` is not agreeing; stdout:\n{stdout}"
        );
        assert!(
            stdout.contains("collapsed 1 duplicate identity (1 record dropped, 1 unverified)"),
            "and the counters carry the unverified tally rather than omitting \
             it three lines above a report saying the content is unverified; \
             stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(TERMINATING_ADVICE),
            "the state still needs an operator to end it; stdout:\n{stdout}"
        );
        assert_eq!(
            out.status.code(),
            Some(1),
            "and the survivor is reported drifted; stdout:\n{stdout}"
        );

        let text = span_text(&repo, name)?;
        let lines = anchor_lines(&text);
        assert_eq!(
            lines.len(),
            2,
            "one survivor at the identity, plus the neighbour:\n{text}"
        );
        assert!(
            lines.contains(&format!("file1.txt#L1-L5 {SENTINEL}").as_str()),
            "the survivor keeps the marker — an agreed-hash path here would \
             have laundered it into a verified-looking record:\n{text}"
        );
        assert!(
            lines.iter().any(|l| *l == neighbour_line),
            "the neighbour is untouched:\n{text}"
        );
    }
    Ok(())
}

/// A record whose position *was* tracked is not then told its address is
/// merely where the records used to be.
///
/// The two statements come from different code paths — the sweep's tracking
/// line and the drift report's annotation — and they described the same
/// record in one run. The split is by subject: position is the sweep's to
/// report, content is the annotation's, and the annotation makes no position
/// claim at all now, so there is nothing left for the two to disagree about.
#[test]
fn a_tracked_position_is_not_contradicted_by_the_drift_annotation() -> Result<()> {
    for (name, neighbour_first) in [("track-after", false), ("track-before", true)] {
        let repo = TestRepo::seeded()?;
        commit_span_beside_neighbour(
            &repo,
            name,
            &format!("file1.txt#L3-L7 {SENTINEL}\n"),
            "file2.txt#L1-L3",
            neighbour_first,
        )?;
        // Uncommitted, so the sweep's worktree hunks can see it.
        repo.write_file(
            "file1.txt",
            "new1\nnew2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
        )?;

        let out = repo.run_span(["drift", "--fix"])?;
        let stdout = stdout_of(&out);
        assert!(
            stdout.contains(
                "position tracked: `file1.txt#L3-L7` — a duplicate-collapse \
                 sentinel's anchor moved to `file1.txt#L5-L9`"
            ),
            "{name}: the position really did track forward; stdout:\n{stdout}"
        );
        assert!(
            stdout.contains(&format!(
                "nothing established what belongs at `file1.txt#L5-L9`, so `git \
                 span add {name} file1.txt#L5-L9` will hash whatever occupies it \
                 now"
            )),
            "{name}: the annotation speaks about content, at the coordinates \
             the record now holds; stdout:\n{stdout}"
        );
        assert!(
            !stdout.contains("where the records were"),
            "{name}: and it makes no claim about position, so it cannot \
             contradict the line above it; stdout:\n{stdout}"
        );
    }
    Ok(())
}

/// `add`'s machine-readable form carries the collapse it retired, so a hook
/// is not left parsing prose — and omits the field entirely when there was
/// no collapse, so its presence means something.
#[test]
fn add_json_carries_the_collapsed_duplicates_it_retired() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span_beside_neighbour(
        &repo,
        "add-json",
        &format!("file1.txt#L2-L3 {SENTINEL}\n"),
        "file2.txt#L10-L12",
        true,
    )?;

    let out = repo.run_span(["add", "add-json", "file1.txt#L2-L3", "--format", "json"])?;
    let stdout = stdout_of(&out);
    let doc: serde_json::Value = serde_json::from_str(&stdout)?;
    assert_eq!(
        doc["addresses"][0]["retired_collapsed_duplicates"], 1,
        "the unverified record `add` destroyed is counted; stdout:\n{stdout}"
    );

    // A second `add` at the same identity retires an ordinary, verified
    // record — nothing was in doubt, so the field is absent rather than 0.
    let again = repo.run_span(["add", "add-json", "file1.txt#L2-L3", "--format", "json"])?;
    let doc: serde_json::Value = serde_json::from_str(&stdout_of(&again))?;
    assert!(
        doc["addresses"][0]["retired_collapsed_duplicates"].is_null(),
        "an ordinary re-add claims no collapse; stdout:\n{}",
        stdout_of(&again)
    );
    Ok(())
}
