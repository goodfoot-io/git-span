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

/// Anchor lines (no `why` block) of a span declaration.
fn anchor_lines(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|l| !l.is_empty() && !l.starts_with("why:") && !l.starts_with('['))
        .collect()
}

/// Read the span declaration as text.
fn span_text(repo: &TestRepo, name: &str) -> Result<String> {
    Ok(std::fs::read_to_string(span_path(repo, name))?)
}

/// One parsed porcelain finding: the row's tab-separated fields, and the
/// qualifier comment lines that follow it before the next row.
struct PorcelainRow {
    fields: Vec<String>,
    comments: Vec<String>,
}

/// Parse porcelain v2 into rows rather than grepping the stream. A substring
/// search cannot tell *which* row a `# collapsed-duplicate` line qualifies,
/// which is the entire question when a fixture has a neighbour: the marker
/// landing on the wrong row reads identically to it landing on the right one.
fn parse_porcelain(stdout: &str) -> Vec<PorcelainRow> {
    let mut rows: Vec<PorcelainRow> = Vec::new();
    for line in stdout.lines() {
        if line.is_empty() || line == "# porcelain v2" || line.starts_with("# cluster ") {
            continue;
        }
        if let Some(rest) = line.strip_prefix("# ") {
            rows.last_mut()
                .expect("a qualifier comment must follow a finding row")
                .comments
                .push(rest.to_string());
            continue;
        }
        rows.push(PorcelainRow {
            fields: line.split('\t').map(str::to_string).collect(),
            comments: Vec::new(),
        });
    }
    rows
}

/// The porcelain row for `path#Lstart-Lend`, by its address columns — the
/// last three fields of a row in either the with- or without-`--source`
/// shape.
fn porcelain_row<'a>(rows: &'a [PorcelainRow], addr: &str) -> &'a PorcelainRow {
    rows.iter()
        .find(|r| {
            let n = r.fields.len();
            n >= 3
                && format!(
                    "{}#L{}-L{}",
                    r.fields[n - 3],
                    r.fields[n - 2],
                    r.fields[n - 1]
                ) == addr
        })
        .unwrap_or_else(|| panic!("no porcelain row for `{addr}`"))
}

/// The parsed JSON finding for `path#Lstart-Lend`, matched on its
/// `anchored` location.
fn json_finding(doc: &serde_json::Value, path: &str, start: u64, end: u64) -> serde_json::Value {
    doc["findings"]
        .as_array()
        .expect("findings array")
        .iter()
        .find(|f| {
            f["anchored"]["path"] == path
                && f["anchored"]["extent"]["start"] == start
                && f["anchored"]["extent"]["end"] == end
        })
        .unwrap_or_else(|| panic!("no JSON finding for `{path}#L{start}-L{end}`"))
        .clone()
}

/// Both machine documents for one repository state, parsed.
fn machine_views(repo: &TestRepo) -> Result<(Vec<PorcelainRow>, serde_json::Value)> {
    let porcelain = stdout_of(&repo.run_span(["drift", "--format", "porcelain"])?);
    let json = stdout_of(&repo.run_span(["drift", "--format", "json", "--no-exit-code"])?);
    Ok((
        parse_porcelain(&porcelain),
        serde_json::from_str(&json).expect("drift --format json emits a JSON document"),
    ))
}

// ---------------------------------------------------------------------------
// The marker's reach is two-dimensional
//
// A collapse marker has to survive along two independent axes, and closing
// one leaves the other live. The first is *status*: the marker was derived
// inside the `Changed` arm, so a collapsed survivor whose file was later
// deleted resolved `Deleted` and rendered as ordinary drift — the one fact
// that distinguishes it, dropped exactly where it matters most. The second
// is *surface*: human, JSON and porcelain are three separate writers, and
// porcelain carried no marker under any status at all, so a script
// consuming it could not tell a collapsed unverified record from an
// ordinary drifted one.
//
// Every fixture below carries a neighbour anchor, in both orientations. An
// isolated single-anchor fixture is what let the earlier round of tests pass
// while every real failure stayed live: with nothing beside the collapsed
// record, a marker attached to the wrong row is indistinguishable from a
// marker attached to the right one.
// ---------------------------------------------------------------------------

/// Seed a span holding a hand-written sentinel record at `dup` and a real,
/// verified record at `neighbour`, in the file order the caller's addresses
/// imply. The sentinel is written directly rather than produced by `--fix`:
/// these cases are about the *read* path, which must recognize a collapse
/// from the file alone.
fn sentinel_beside_neighbour(
    name: &str,
    dup: &str,
    neighbour: &str,
    dup_first: bool,
) -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "seed", neighbour])?;
    let real = anchor_lines(&span_text(&repo, "seed")?)[0].to_string();

    let dup_line = format!("{dup} {SENTINEL}");
    let body = if dup_first {
        format!("{dup_line}\n{real}\n")
    } else {
        format!("{real}\n{dup_line}\n")
    };
    commit_span(
        &repo,
        name,
        &format!("{body}\nwhy: a collapse survivor beside a real neighbour.\n"),
    )?;
    Ok(repo)
}

/// The marker must not be a function of the status the record happened to
/// land in. Here the collapsed survivor's file is deleted after the
/// collapse, so it resolves `Deleted` rather than `Changed` — the case that
/// previously lost the marker on every one of the three surfaces at once.
///
/// Neighbour *after* the collapsed anchor.
#[test]
fn a_deleted_collapse_keeps_its_marker_on_all_three_surfaces_neighbour_after() -> Result<()> {
    let repo = sentinel_beside_neighbour("reach-del-after", "file1.txt#L3-L5", "file1.txt#L8-L9", true)?;
    repo.run_git(["rm", "-q", "file1.txt"])?;
    repo.run_git(["commit", "-m", "delete the anchored file"])?;

    let human = stdout_of(&repo.run_span(["drift"])?);
    assert!(
        human.contains("- file1.txt#L3-L5 — collapsed duplicate (deleted in "),
        "the human line must carry the marker *and* the status it actually \
         resolved to, not one at the cost of the other; stdout:\n{human}"
    );
    assert!(
        human.contains("- file1.txt#L8-L9 — deleted in "),
        "sanity: the neighbour is reported too; stdout:\n{human}"
    );
    assert!(
        !human.contains("file1.txt#L8-L9 — collapsed duplicate"),
        "and the neighbour must not inherit the marker; stdout:\n{human}"
    );

    let (rows, json) = machine_views(&repo)?;
    assert_eq!(
        porcelain_row(&rows, "file1.txt#L3-L5").comments,
        vec!["collapsed-duplicate".to_string()],
        "porcelain must qualify the collapsed row under a non-`Changed` \
         status; a consumer that cannot see this cannot tell an unverified \
         record from ordinary drift"
    );
    assert_eq!(
        porcelain_row(&rows, "file1.txt#L3-L5").fields[0],
        "DELETED",
        "and the row's own status column is untouched by the marker"
    );
    assert!(
        porcelain_row(&rows, "file1.txt#L8-L9").comments.is_empty(),
        "the neighbour row carries no qualifier"
    );
    assert_eq!(
        json_finding(&json, "file1.txt", 3, 5)["collapsed_duplicate"],
        serde_json::json!(true),
        "the JSON field must be derived from the record, not gated on \
         `CHANGED`"
    );
    assert_eq!(
        json_finding(&json, "file1.txt", 8, 9)["collapsed_duplicate"],
        serde_json::Value::Null,
        "and it must stay null for the neighbour"
    );
    Ok(())
}

/// The mirror orientation: the neighbour sits *before* the collapsed anchor.
/// A marker attached by position rather than by record would pass one of
/// these two and fail the other.
#[test]
fn a_deleted_collapse_keeps_its_marker_on_all_three_surfaces_neighbour_before() -> Result<()> {
    let repo = sentinel_beside_neighbour("reach-del-before", "file1.txt#L8-L9", "file1.txt#L1-L2", false)?;
    repo.run_git(["rm", "-q", "file1.txt"])?;
    repo.run_git(["commit", "-m", "delete the anchored file"])?;

    let human = stdout_of(&repo.run_span(["drift"])?);
    assert!(
        human.contains("- file1.txt#L8-L9 — collapsed duplicate (deleted in "),
        "stdout:\n{human}"
    );
    assert!(
        !human.contains("file1.txt#L1-L2 — collapsed duplicate"),
        "stdout:\n{human}"
    );

    let (rows, json) = machine_views(&repo)?;
    assert_eq!(
        porcelain_row(&rows, "file1.txt#L8-L9").comments,
        vec!["collapsed-duplicate".to_string()],
    );
    assert!(porcelain_row(&rows, "file1.txt#L1-L2").comments.is_empty());
    assert_eq!(
        json_finding(&json, "file1.txt", 8, 9)["collapsed_duplicate"],
        serde_json::json!(true),
    );
    assert_eq!(
        json_finding(&json, "file1.txt", 1, 2)["collapsed_duplicate"],
        serde_json::Value::Null,
    );
    Ok(())
}

/// Porcelain under the ordinary `Changed` status, which carried no marker
/// either — the surface axis is independent of the status axis, and closing
/// the status one alone would leave every porcelain consumer exactly as
/// blind as before.
///
/// Asserted on the parsed rows, and on the row *shape*: the marker is a
/// comment line, so the five tab-separated columns an existing parser
/// indexes positionally are unchanged.
#[test]
fn porcelain_marks_a_changed_collapse_without_disturbing_the_row_columns() -> Result<()> {
    let repo = sentinel_beside_neighbour("reach-porc", "file1.txt#L3-L5", "file1.txt#L8-L9", true)?;

    let rows = parse_porcelain(&stdout_of(&repo.run_span(["drift", "--format", "porcelain"])?));
    let collapsed = porcelain_row(&rows, "file1.txt#L3-L5");
    assert_eq!(
        collapsed.fields,
        vec!["CHANGED", "H", "reach-porc", "file1.txt", "3", "5"],
        "the row keeps its exact six-column shape — the marker may not \
         become a seventh field or a new delimiter"
    );
    assert_eq!(collapsed.comments, vec!["collapsed-duplicate".to_string()]);
    assert!(
        rows.iter().all(|r| r.fields.len() == 6),
        "no row may change its column count"
    );

    // The neighbour is fresh, so it is not a finding at all; the marker must
    // not have attached itself to some other row in its place.
    assert_eq!(
        rows.len(),
        1,
        "only the collapsed record drifts in this fixture"
    );
    Ok(())
}

/// The `ContentUnavailable` branch of the advice. A checkout that cannot
/// read the file cannot answer "is the coupled content still here", so
/// offering the operator that choice sends them to guess; the line names the
/// step that makes the question answerable instead. The marker is still
/// present — this is about which completion follows it.
///
/// Also asserts the record set: nothing about reporting an unreadable
/// collapse may rewrite the span.
#[test]
fn a_sparse_excluded_collapse_is_marked_but_offered_the_step_that_makes_it_readable() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/data.txt", "l1\nl2\nl3\nl4\nl5\nl6\n")?;
    repo.commit_all("add data file")?;
    repo.write_commit_graph()?;
    // Neighbour *before* the collapsed anchor, complementing the two
    // orientations the `Deleted` cases above cover.
    repo.span_stdout(["add", "reach-sparse", "src/data.txt#L1-L2"])?;
    repo.span_stdout(["add", "reach-sparse", "src/data.txt#L4-L6"])?;
    repo.span_stdout(["why", "reach-sparse", "a collapse behind a sparse checkout"])?;
    repo.commit_all("span commit")?;
    repo.write_commit_graph()?;
    repo.run_git(["sparse-checkout", "set", "--no-cone", ".span"])?;
    assert!(
        !repo.path().join("src/data.txt").exists(),
        "precondition: the file is excluded from this checkout"
    );

    // Plant the sentinel the way an earlier `--fix` leaves it: written to the
    // worktree span, not yet committed, so the anchor's deepest disagreeing
    // layer is the excluded worktree file and it resolves
    // `ContentUnavailable` rather than `Changed`.
    let seeded = span_text(&repo, "reach-sparse")?;
    let real = anchor_lines(&seeded)
        .into_iter()
        .find(|l| l.starts_with("src/data.txt#L4-L6 "))
        .expect("seeded record")
        .to_string();
    write_span(
        &repo,
        "reach-sparse",
        &seeded.replace(&real, &format!("src/data.txt#L4-L6 {SENTINEL}")),
    )?;

    let before = span_text(&repo, "reach-sparse")?;
    let human = stdout_of(&repo.run_span(["drift"])?);
    assert!(
        human.contains("collapsed duplicate (content unavailable ("),
        "the marker survives, and carries the status that explains the \
         missing content; stdout:\n{human}"
    );
    assert!(
        human.contains("this checkout cannot read `src/data.txt#L4-L6`"),
        "the line names the address it cannot read; stdout:\n{human}"
    );
    assert!(
        !human.contains("git span replace src/data.txt#L4-L6"),
        "an unreadable file is not a mis-addressed anchor — offering \
         `replace` here talks the operator into overwriting a correct \
         address with a guess; stdout:\n{human}"
    );
    assert_eq!(
        span_text(&repo, "reach-sparse")?,
        before,
        "reporting must not rewrite the span"
    );

    let (rows, json) = machine_views(&repo)?;
    assert_eq!(
        porcelain_row(&rows, "src/data.txt#L4-L6").comments,
        vec!["collapsed-duplicate".to_string()],
    );
    assert_eq!(
        json_finding(&json, "src/data.txt", 4, 6)["collapsed_duplicate"],
        serde_json::json!(true),
    );
    Ok(())
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
