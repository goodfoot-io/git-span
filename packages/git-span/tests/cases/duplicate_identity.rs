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
