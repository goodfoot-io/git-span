//! Format surface: which formats exist and their shared shape.

use super::*;

// ---------------------------------------------------------------------------
// Format surface
// ---------------------------------------------------------------------------

#[test]
fn xml_format_is_rejected_by_clap() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = repo.run_span(["history", span, "--format=xml"])?;
    assert!(!out.status.success(), "`--format=xml` must be rejected");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("invalid value 'xml'"),
        "expected a clap value error naming xml; got:\n{stderr}"
    );
    assert!(
        stderr.contains("human") && stderr.contains("json"),
        "expected human/json to be the only accepted values; got:\n{stderr}"
    );
    Ok(())
}


#[test]
fn default_format_is_git_log_style_text() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;

    assert!(
        out.lines()
            .any(|l| l.starts_with("commit ") && l.len() == "commit ".len() + 40),
        "expected `commit <40-hex>` entry headers; got:\n{out}"
    );
    assert!(
        out.contains("\nDate:   "),
        "expected git's `Date:   ` header line; got:\n{out}"
    );
    assert!(
        out.contains("\n    C5: remove file2 anchor"),
        "expected four-space-indented commit summaries; got:\n{out}"
    );
    // No XML remnants anywhere.
    assert!(
        !out.contains("<commit ") && !out.contains("<current>") && !out.contains("event="),
        "XML dialect must be gone; got:\n{out}"
    );
    Ok(())
}


#[test]
fn json_is_schema_version_2_without_event_or_why() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;

    assert_eq!(json["schema_version"], 2, "schema_version must be 2");
    assert_eq!(json["span"], span);

    let raw = serde_json::to_string(&json)?;
    assert!(
        !raw.contains("\"event\""),
        "the `event` field must be gone; got: {raw}"
    );
    assert!(
        !raw.contains("\"why\""),
        "the per-commit `why` field must be gone; got: {raw}"
    );
    assert!(
        !raw.contains("\"status\""),
        "the current-anchor `status` string must be gone; got: {raw}"
    );
    Ok(())
}


#[test]
fn both_formats_are_newest_first_and_agree_on_commit_count() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let out = history_text(&repo, span)?;
    let json = history_json(&repo, span)?;

    // Text: newest commit's summary appears before the oldest.
    let c5 = out.find("C5: remove file2").expect("C5 missing from text");
    let c3 = out
        .find("C3: edit why prose")
        .expect("C3 missing from text");
    let c1 = out.find("C1: create span").expect("C1 missing from text");
    assert!(
        c5 < c3 && c3 < c1,
        "text output must be newest-first:\n{out}"
    );

    // JSON: same ordering.
    assert!(
        commit_index(&json, "C5: remove file2") < commit_index(&json, "C3: edit why prose"),
        "JSON commits must be newest-first: {json:#}"
    );

    let text_commits = out
        .lines()
        .filter(|l| l.starts_with("commit ") && l.len() == "commit ".len() + 40)
        .count();
    assert_eq!(
        text_commits,
        json["commits"].as_array().expect("commits array").len(),
        "both formats must carry the same commit sections"
    );
    Ok(())
}


#[test]
fn json_date_is_a_full_iso8601_timestamp() -> Result<()> {
    let (repo, span) = seed_history_scenario()?;
    let json = history_json(&repo, span)?;
    let date = commit_with(&json, "C5: remove file2")["date"]
        .as_str()
        .expect("date must be a string")
        .to_string();

    chrono::DateTime::parse_from_rfc3339(&date)
        .unwrap_or_else(|e| panic!("`date` must be ISO-8601 with offset, got {date:?}: {e}"));
    Ok(())
}
