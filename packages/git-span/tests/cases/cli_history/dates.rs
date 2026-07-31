//! Author dates and offsets, including hostile author metadata.

use super::*;


#[test]
fn human_date_line_carries_gits_full_author_date() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    let dates: Vec<&str> = out
        .lines()
        .filter_map(|l| l.strip_prefix("Date:   "))
        .collect();
    assert!(!dates.is_empty(), "expected Date: lines in:\n{out}");
    for date in dates {
        chrono::DateTime::parse_from_str(date, "%a %b %e %H:%M:%S %Y %z").unwrap_or_else(|e| {
            panic!("`Date:` must use git's own default rendering, got {date:?}: {e}")
        });
    }
    Ok(())
}


#[test]
fn git_valid_extended_author_offset_is_preserved_in_both_formats() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial")?;
    repo.span_stdout(["add", "date", "f.txt#L1-L3"])?;
    repo.span_stdout(["why", "date", "records Git's extended offset"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git_with_env(
        ["commit", "-m", "extreme author offset"],
        &[("GIT_AUTHOR_DATE", "@0 +9999")],
    )?;

    let expected_human = repo.git_stdout(["show", "-s", "--format=%ad", "HEAD"])?;
    let expected_json = repo.git_stdout(["show", "-s", "--format=%aI", "HEAD"])?;
    assert_eq!(expected_human, "Mon Jan 5 04:39:00 1970 +10039");
    assert_eq!(expected_json, "1970-01-05T04:39:00+100:39");

    let text = history_text(&repo, "date")?;
    assert!(
        text.contains(&format!("Date:   {expected_human}")),
        "human history must preserve Git's extended offset exactly:\n{text}"
    );
    let json = history_json(&repo, "date")?;
    assert_eq!(
        commit_with(&json, "extreme author offset")["date"],
        expected_json,
        "JSON history must match Git's %aI for an extended offset"
    );
    Ok(())
}


#[test]
fn noncanonical_author_minutes_preserve_gits_raw_offset_spelling() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial")?;
    commit_span_declaration_with_raw_author_offset(
        &repo,
        "raw-minute-offset",
        "+0060",
        "noncanonical minute offset",
    )?;

    let expected_human = repo.git_stdout(["show", "-s", "--format=%ad", "HEAD"])?;
    let expected_json = repo.git_stdout(["show", "-s", "--format=%aI", "HEAD"])?;
    assert!(
        expected_human.ends_with("+0060"),
        "Git must retain the raw offset"
    );
    assert!(
        expected_json.ends_with("+00:60"),
        "Git must retain the noncanonical minute field"
    );
    let text = history_text(&repo, "raw-minute-offset")?;
    assert!(
        text.contains(&format!("Date:   {expected_human}")),
        "human history must match Git exactly:\n{text}"
    );
    let json = history_json(&repo, "raw-minute-offset")?;
    assert_eq!(
        commit_with(&json, "noncanonical minute offset")["date"],
        expected_json,
        "JSON history must not silently canonicalize +0060 to +01:00"
    );
    Ok(())
}


#[test]
fn overflowing_author_offsets_fail_closed_without_panicking() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "one\ntwo\nthree\n")?;
    repo.commit_all("initial")?;
    commit_span_declaration_with_raw_author_offset(
        &repo,
        "overflow-offset",
        "+214748364799",
        "overflowing author offset",
    )?;

    let out = repo.run_span(["history", "overflow-offset", "--format=json"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success() && out.stdout.is_empty(),
        "an unsupported raw offset must fail before output: stdout={} stderr={stderr}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(
        stderr.contains("author date offset `+214748364799` is out of range"),
        "the failure must explain the unsupported author date: {stderr}"
    );
    assert!(
        !stderr.contains("panicked") && !stderr.contains("attempt to multiply with overflow"),
        "malformed commit metadata must never reach a Rust panic: {stderr}"
    );
    Ok(())
}


#[test]
fn hostile_author_metadata_on_a_no_op_commit_does_not_fail_history() -> Result<()> {
    // Author metadata is a contract for *rendered* commits only: a walked
    // commit that changes nothing observable never has its author line
    // parsed. Appending below the anchored range qualifies the commit for
    // the walk without producing a timeline entry.
    let (repo, hostile) = hostile_author_repo("lazy-meta", "one\ntwo\nthree\nfour\n")?;

    let json = history_json(&repo, "lazy-meta")?;
    commit_with(&json, "declare span");
    let rendered: Vec<&str> = json["commits"]
        .as_array()
        .expect("commits must be an array")
        .iter()
        .filter_map(|c| c["hash"].as_str())
        .collect();
    assert!(
        !rendered.contains(&hostile.as_str()),
        "a commit that changes nothing observable must not render an entry: {json:#}"
    );
    Ok(())
}


#[test]
fn hostile_author_metadata_on_a_rendered_commit_still_fails_closed() -> Result<()> {
    // The same author line on a commit that edits the anchored range must
    // keep failing with the curated error — laziness narrows *when* the
    // metadata is read, never whether a rendered commit's metadata is valid.
    let (repo, _) = hostile_author_repo("lazy-meta", "ONE\ntwo\nthree\n")?;

    let out = repo.run_span(["history", "lazy-meta", "--format=json"])?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success() && out.stdout.is_empty(),
        "a rendered commit with an unsupported author date must fail before \
         output: stdout={} stderr={stderr}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(
        stderr.contains("author date offset `+214748364799` is out of range"),
        "the failure must explain the unsupported author date: {stderr}"
    );
    Ok(())
}
