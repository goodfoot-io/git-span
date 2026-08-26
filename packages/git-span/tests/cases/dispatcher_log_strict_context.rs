//! Dispatcher runtime artifacts must never enter the strict retained corpus.
//!
//! The reconciler's agent-hooks dispatcher writes log files directly under
//! the span root (`.span/dispatcher.log`, gitignored via `.span/.gitignore`).
//! `load_all_spans_strict_in` — the capture path behind
//! `git span context --format json` — enumerates the retained span root's
//! regular files and used to admit every non-dot-prefixed name, so the
//! artifact entered the corpus as a span name and the retained read then
//! hard-failed validating it:
//!
//! ```text
//! error: retain span parent: invalid name: `dispatcher.log` segment
//! `dispatcher.log` contains invalid character `.`
//! ```
//!
//! Every other enumeration path skips such artifacts through the shared
//! `is_span_name_segment` choke-point predicate; the strict loader must use
//! it too. The failing assertion encodes the desired post-fix behavior: a
//! context query succeeds with the artifact present and reports only real
//! spans.

use crate::support::TestRepo;
use anyhow::Result;

#[test]
fn dispatcher_log_artifact_excluded_from_strict_context() -> Result<()> {
    let repo = TestRepo::seeded()?;
    assert!(
        repo.run_span(["add", "myflow", "file1.txt#L1-L3"])?
            .status
            .success(),
        "seeding span failed"
    );

    // Simulate the dispatcher writing its runtime diagnostics alongside the
    // spans, exactly as .span/.gitignore describes.
    repo.write_file(".span/dispatcher.log", "dispatcher run artifacts\n")?;

    let output = repo.run_span(["context", "file1.txt#L1-L3", "--format", "json"])?;
    assert!(
        output.status.success(),
        "context must tolerate dispatcher runtime artifacts; stderr:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let document: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    let span_names = document["spans"]
        .as_array()
        .expect("spans array")
        .iter()
        .filter_map(|span| span["name"].as_str())
        .collect::<Vec<_>>();
    assert!(
        !span_names.iter().any(|name| name.contains("dispatcher")),
        "dispatcher artifact must not surface as a span; spans:\n{span_names:?}"
    );
    assert!(
        span_names.contains(&"myflow"),
        "the legitimate span must still load; spans:\n{span_names:?}"
    );
    Ok(())
}
