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
