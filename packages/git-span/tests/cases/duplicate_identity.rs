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
        stdout.contains("collapsed duplicate identity: `file1.txt#L1-L5` — 2 records → 1"),
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
        stdout.contains("collapsed duplicate identity: `file1.txt#L1-L5` — 2 records → 1")
            && stdout.contains("records agreed"),
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
        second_out.contains("run `git span add file1.txt#L5-L9` to resolve"),
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
            && stdout.contains("git span replace file1.txt#L1-L5 <new-address>"),
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

/// The no-op guard: an unmoved sentinel is not rewritten and not reported,
/// on this pass or any later one.
#[test]
fn fix_leaves_an_unmoved_sentinel_untouched_and_unreported() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "fix-noop",
        &format!("file1.txt#L1-L5 {SENTINEL}\n\nwhy: sentinel, nothing moved.\n"),
    )?;

    let first = repo.run_span(["drift", "--fix"])?;
    let before = span_text(&repo, "fix-noop")?;
    let second = repo.run_span(["drift", "--fix"])?;
    let after = span_text(&repo, "fix-noop")?;

    assert_eq!(
        before, after,
        "an unmoved sentinel is never rewritten:\nbefore:\n{before}\nafter:\n{after}"
    );
    for (label, out) in [("first", &first), ("second", &second)] {
        let stdout = stdout_of(out);
        assert!(
            !stdout.contains("position tracked") && !stdout.contains("position untrackable"),
            "the {label} pass must report nothing for an unmoved sentinel; \
             stdout:\n{stdout}"
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
        stdout.contains("git span replace file2.txt#L1-L5 <new-address>"),
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
// nothing to say. The only way it shows itself unprompted is one identity
// reported in two drift states — which is a puzzle, not a diagnosis. Doctor
// names it, counts it, and names the one command that repairs it.
// ---------------------------------------------------------------------------

/// A duplicate-bearing span produces a loud doctor finding naming the
/// identity, the record count, and `drift --fix` — and doctor's exit code
/// reflects it, exactly as it does for an interior anchor.
#[test]
fn doctor_reports_a_duplicate_identity_and_exits_non_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "doc-dup",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;

    let out = repo.run_span(["doctor"])?;
    let stdout = stdout_of(&out);
    assert_eq!(
        out.status.code(),
        Some(1),
        "doctor must exit non-zero when a duplicate identity is present;\n\
         stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("span `doc-dup` carries 2 records for one anchor identity"),
        "the finding names the span and the count; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("identity:     file1.txt#L1-L5"),
        "the finding names the identity; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(".span/doc-dup"),
        "the finding names the span file; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("fix:          git span drift --fix"),
        "`drift --fix` is the named repair; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("fix:          git span add"),
        "`add` must never be offered as the fix — its existence probe runs \
         before the span file is read, so it refuses on a vanished path; \
         stdout:\n{stdout}"
    );

    // The named repair actually clears the finding.
    repo.run_span(["drift", "--fix"])?;
    let after = repo.run_span(["doctor"])?;
    let after_out = stdout_of(&after);
    assert!(
        !after_out.contains("carries 2 records for one anchor identity"),
        "the duplicate finding must be gone after the named fix; \
         stdout:\n{after_out}"
    );
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
#[test]
fn following_the_printed_command_after_a_collapse_leaves_no_overlapping_anchor() -> Result<()> {
    let (repo, text, stdout, _code) =
        fix_with_contiguous_neighbour("coalesce-seq", "file1.txt#L3-L5", "file1.txt#L6-L7")?;
    assert!(text.contains(SENTINEL), "precondition:\n{text}");
    assert!(
        stdout.contains("git span add file1.txt#L3-L5"),
        "the collapse names the address it is talking about; stdout:\n{stdout}"
    );

    // Type what the tool printed.
    let out = repo.run_span(["add", "coalesce-seq", "file1.txt#L3-L5"])?;
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
            stdout.contains(
                "an unverified collapse is not cleared by re-running: settle each collapsed \
                 address named above with `git span add` or `git span replace`, then run \
                 git span drift again"
            ),
            "{orientation}: `run git span drift again` on its own is a closed \
             loop — the sentinel matches no content, so the same report \
             returns forever; stdout:\n{stdout}"
        );
        assert_eq!(code, Some(1), "{orientation}: stdout:\n{stdout}");
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
        stdout.contains("git span add file1.txt#L3-L5")
            && stdout.contains("git span replace file1.txt#L3-L5 <new-address>"),
        "and offers both completions against the question only the operator \
         can answer; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("only if the coupled content still lives there"),
        "with the condition that separates them stated, not implied; \
         stdout:\n{stdout}"
    );
    Ok(())
}
