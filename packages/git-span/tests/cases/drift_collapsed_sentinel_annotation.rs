//! `drift`'s read path recognizes the duplicate-collapse sentinel and says
//! why the anchor is drifting (card main-231, plan §3e).
//!
//! The drifted *status* of a collapsed survivor is already durable — any
//! `drift` run reports it `Changed`. What was missing is legibility: a
//! reader who never ran the collapsing command saw the exact same generic
//! "changed" label an ordinary content edit produces, with no way to tell
//! the two apart. These tests assert the literal annotation text and JSON
//! field the render path now produces, not just that the anchor reports
//! drifted — that weaker claim is already covered by `duplicate_identity.rs`
//! and does not by itself close the legibility gap.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// The unmatchable hash `drift --fix` and the merge kernel plant on an
/// unverified collapse survivor. Spelled out literally, not imported: the
/// tests must pin the on-disk token an unrelated reader sees, not track
/// whatever the constant happens to return.
const SENTINEL: &str = "rk64:ffffffffffffffff";

/// Path of the span declaration inside the repo.
fn span_path(repo: &TestRepo, name: &str) -> std::path::PathBuf {
    repo.path().join(".span").join(name)
}

/// Hand-write a span declaration with the given body.
fn write_span(repo: &TestRepo, name: &str, body: &str) -> Result<()> {
    let p = span_path(repo, name);
    std::fs::create_dir_all(p.parent().unwrap())?;
    std::fs::write(p, body)?;
    Ok(())
}

/// Hand-write a span declaration and commit it, so `drift` (which reads the
/// committed corpus) can see it.
fn commit_span(repo: &TestRepo, name: &str, body: &str) -> Result<()> {
    write_span(repo, name, body)?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    Ok(())
}

fn stdout_of(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Case 1 (two invocations): `drift --fix` plants the sentinel on a
/// divergent duplicate's survivor; a *separate*, later, plain `drift` run —
/// one that never saw the collapse — still renders the collapsed-duplicate
/// phrasing (not the generic "changed" label) and the JSON row carries
/// `"collapsed_duplicate": true`.
#[test]
fn two_pass_collapse_annotation_survives_a_separate_plain_drift_run() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "annot-two-pass",
        "file1.txt#L1-L5 rk64:aaaaaaaaaaaaaaaa\n\
         file1.txt#L1-L5 rk64:bbbbbbbbbbbbbbbb\n\
         \n\
         why: two records for one identity.\n",
    )?;

    // Plant the sentinel via `--fix`.
    let fix_out = repo.run_span(["drift", "--fix"])?;
    assert!(
        stdout_of(&fix_out).contains("collapsed duplicate identity: `file1.txt#L1-L5` — 2 records → 1"),
        "sanity: the sweep must collapse and name the identity; stdout:\n{}",
        stdout_of(&fix_out)
    );
    let text = std::fs::read_to_string(span_path(&repo, "annot-two-pass"))?;
    assert!(
        text.contains(SENTINEL),
        "sanity: the survivor must carry the sentinel on disk:\n{text}"
    );

    // A separate, later, plain `drift` invocation — no `--fix`, no memory of
    // the command that planted the sentinel.
    let human = repo.run_span(["drift"])?;
    let human_stdout = stdout_of(&human);
    assert!(
        human_stdout.contains(
            "collapsed duplicate — content is still unverified, and this \
             address is where the records were, not a location anything has \
             confirmed — run `git span add file1.txt#L1-L5` only if the \
             coupled content still lives there, otherwise `git span replace \
             file1.txt#L1-L5 <new-address>` naming where it lives now"
        ),
        "a reader who never ran the collapsing command must be told why the \
         anchor is drifting, and which command retires the sentinel under \
         which condition, not shown the generic label; stdout:\n{human_stdout}"
    );
    let lower = human_stdout.to_lowercase();
    assert!(
        !lower.contains("re-verified"),
        "the annotation must never claim the content was re-verified — that \
         would misstate what happened; stdout:\n{human_stdout}"
    );
    // "confirmed" may appear, but only under a negation: the annotation now
    // says the address is *not* a location anything has confirmed. Every
    // occurrence must be that one — an affirmative "confirmed" would be the
    // same misstatement in a different word.
    assert_eq!(
        lower.matches("confirmed").count(),
        lower.matches("not a location anything has confirmed").count(),
        "every occurrence of `confirmed` must be the negated one; the \
         annotation must not assert that anything was confirmed; \
         stdout:\n{human_stdout}"
    );

    let json = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json_stdout = stdout_of(&json);
    assert!(
        json_stdout.contains("\"collapsed_duplicate\": true"),
        "the JSON row must carry the additive field; stdout:\n{json_stdout}"
    );
    Ok(())
}

/// Case 2 (durability, no collapsing command in this test at all): a
/// hand-written span fixture that already carries the sentinel — never
/// produced by `add` or `drift --fix` in this test — still renders the
/// annotation. The why-drifting context lives in the file itself, not only
/// alongside the command that planted it.
#[test]
fn hand_written_sentinel_fixture_reports_the_annotation_without_any_collapse_run() -> Result<()> {
    let repo = TestRepo::seeded()?;
    commit_span(
        &repo,
        "annot-fixture",
        &format!(
            "file1.txt#L1-L5 {SENTINEL}\n\
             \n\
             why: sentinel written directly into the fixture.\n"
        ),
    )?;

    let human = repo.run_span(["drift"])?;
    let human_stdout = stdout_of(&human);
    assert!(
        human_stdout.contains(
            "collapsed duplicate — content is still unverified, and this \
             address is where the records were, not a location anything has \
             confirmed — run `git span add file1.txt#L1-L5` only if the \
             coupled content still lives there, otherwise `git span replace \
             file1.txt#L1-L5 <new-address>` naming where it lives now"
        ),
        "the annotation, including the retiring command, must be durable in \
         the file itself, independent of any command that ran in this test; \
         stdout:\n{human_stdout}"
    );

    let json = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json_stdout = stdout_of(&json);
    assert!(
        json_stdout.contains("\"collapsed_duplicate\": true"),
        "the JSON row must carry the additive field even though no add/\
         --fix ran in this test; stdout:\n{json_stdout}"
    );
    Ok(())
}

/// Negative case: an ordinary content edit (unrelated to any collapse) must
/// still render the generic label, and the JSON field must be absent
/// (`null`), so the new check never misfires on real drift. `add`'s
/// survivor in particular carries a real, freshly computed hash and must
/// never trip this check.
#[test]
fn ordinary_edit_keeps_the_generic_label_and_omits_the_field() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "annot-ordinary", "file1.txt#L1-L5"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "seed annot-ordinary anchor"])?;

    // An ordinary whitespace-only edit inside the anchored range — real
    // drift, no collapse involved anywhere.
    repo.write_file(
        "file1.txt",
        "line1 \nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let human = repo.run_span(["drift"])?;
    let human_stdout = stdout_of(&human);
    assert!(
        !human_stdout.contains("collapsed duplicate"),
        "an ordinary edit must never render the collapse annotation; \
         stdout:\n{human_stdout}"
    );
    assert!(
        human_stdout.contains("file1.txt#L1-L5"),
        "sanity: the anchor must actually be reported; stdout:\n{human_stdout}"
    );

    let json = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json_stdout = stdout_of(&json);
    assert!(
        json_stdout.contains("\"collapsed_duplicate\": null"),
        "the additive field must be present-but-null for ordinary drift, \
         matching the `auto_followed` convention; stdout:\n{json_stdout}"
    );
    Ok(())
}
