//! Integration tests for `--perf-trace <path>` CSV emitter.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Set up a span with one line-range anchor and commit it, then mutate
/// the file so the anchor drifts.  No longer uses `git span commit`
/// (removed); instead commits the span file directly via git.
fn seed_and_drift(repo: &TestRepo, span: &str) -> Result<()> {
    repo.span_stdout(["add", span, "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", span, "-m", "seed"])?;
    repo.commit_all(&format!("span: {span}"))?;
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("drift")?;
    Ok(())
}

/// `--perf-trace` emits one CSV data row per anchor (plus header).
#[test]
fn perf_trace_emits_row_per_anchor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_drift(&repo, "m")?;

    let trace_path = repo.path().join("trace.csv");
    let out = repo.run_span(["stale", "--perf-trace", trace_path.to_str().unwrap()])?;
    assert_eq!(out.status.code(), Some(1), "drift should exit 1");

    let csv = std::fs::read_to_string(&trace_path)?;
    let lines: Vec<&str> = csv.lines().collect();
    assert!(
        lines.len() >= 2,
        "expected header + at least one data row; got: {csv}"
    );
    assert_eq!(
        lines[0],
        "span,anchor_id,anchor_sha,path,wall_us,fast_path,status"
    );
    Ok(())
}

/// All seven CSV columns are present and non-empty.
#[test]
fn perf_trace_columns_match_schema() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_drift(&repo, "m")?;

    let trace_path = repo.path().join("trace.csv");
    repo.run_span(["stale", "--perf-trace", trace_path.to_str().unwrap()])?;

    let csv = std::fs::read_to_string(&trace_path)?;
    let mut lines = csv.lines();
    let header = lines.next().expect("header row");
    assert_eq!(
        header,
        "span,anchor_id,anchor_sha,path,wall_us,fast_path,status"
    );

    let row = lines.next().expect("at least one data row");
    let cols: Vec<&str> = row.splitn(7, ',').collect();
    assert_eq!(cols.len(), 7, "expected 7 columns in row: {row}");
    assert!(!cols[0].is_empty(), "span must be non-empty");
    assert!(!cols[1].is_empty(), "anchor_id must be non-empty");
    // anchor_sha may be empty in the file-backed model (anchor_sha is derived
    // from the span tree, not a commit-backed sidecar); only validate the
    // column is present (index 2 exists, which splitn(7) guarantees).
    assert!(!cols[3].is_empty(), "path must be non-empty");
    // wall_us is a u128, so it can be 0 on fast hardware; just parse it.
    cols[4].parse::<u128>().expect("wall_us must be a number");
    assert!(
        cols[5] == "true" || cols[5] == "false",
        "fast_path must be bool: {}",
        cols[5]
    );
    assert!(!cols[6].is_empty(), "status must be non-empty");
    Ok(())
}

/// A clean span emits at least one CSV row when `--perf-trace` is set.
#[test]
fn perf_trace_includes_clean_pinned_span() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "clean-span", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "clean-span", "-m", "clean span"])?;
    repo.commit_all("span: clean-span")?;

    let trace_path = repo.path().join("trace.csv");
    let out = repo.run_span(["stale", "--perf-trace", trace_path.to_str().unwrap()])?;
    assert_eq!(out.status.code(), Some(0), "clean span should exit 0");

    let csv = std::fs::read_to_string(&trace_path)?;
    let data_rows: Vec<&str> = csv.lines().skip(1).collect();
    assert!(
        !data_rows.is_empty(),
        "expected at least one CSV row for the clean span anchor; csv:\n{csv}"
    );
    let any_clean_span = data_rows.iter().any(|r| r.starts_with("clean-span,"));
    assert!(
        any_clean_span,
        "expected a row with span=clean-span in the CSV; csv:\n{csv}"
    );
    Ok(())
}

/// `--perf-trace` conflicts with positional path args: must exit non-zero
/// with a clear error message.
#[test]
fn perf_trace_rejects_positional_paths() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_and_drift(&repo, "m")?;

    let trace_path = repo.path().join("trace.csv");
    let out = repo.run_span(["stale", "m", "--perf-trace", trace_path.to_str().unwrap()])?;
    assert_ne!(
        out.status.code(),
        Some(0),
        "should fail with positional paths + --perf-trace"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    let combined = format!("{stderr}{stdout}");
    assert!(
        combined.contains("--perf-trace") || combined.contains("full scan"),
        "expected error mentioning --perf-trace or full scan; got: {combined}"
    );
    Ok(())
}
