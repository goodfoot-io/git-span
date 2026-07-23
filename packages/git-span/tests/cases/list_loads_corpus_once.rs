//! Reproduction for main-106: `git span list` must load the full span
//! corpus exactly once per invocation regardless of target count.
//!
//! `run_list` currently loads the corpus twice via `load_all_spans_in`:
//! once in `resolve_targets` (via `SpanPathIndex::load_in`) and once in
//! `collect_listings_for_names` (or `collect_listings` / its variant).
//! Additionally `conflicted_span_names_in` scans every span via
//! `read_effective`. On repos with many spans or large span files this
//! is a multiplicative cost.
//!
//! After the fix, a single `load_all_spans_in` at the top of `run_list`
//! feeds target resolution, conflict detection, and listing collection
//! from the same in-memory corpus — the `span.load-all-corpus` perf span
//! must be emitted exactly once even when targets are passed.

use crate::support;

use anyhow::Result;
use std::process::{Command, Stdio};
use support::TestRepo;

/// Seed a repo with several spans, each anchored to its own file, so the
/// corpus has multiple entries to enumerate and the multi-load cost is
/// observable in the perf-span count.
fn seed_spans(repo: &TestRepo, count: usize) -> Result<Vec<String>> {
    let mut names = Vec::with_capacity(count);
    for i in 0..count {
        let path = format!("f{i}.txt");
        repo.write_file(&path, &format!("file {i} content\nl2\nl3\nl4\nl5\n"))?;
        repo.commit_all(&format!("add {path}"))?;
        let span = format!("span{i}");
        repo.span_stdout(["add", &span, &format!("{path}#L1-L5")])?;
        repo.span_stdout(["why", &span, "seed"])?;
        repo.commit_all(&format!("span: {span}"))?;
        names.push(span);
    }
    Ok(names)
}

fn count_lines_containing(haystack: &str, needle: &str) -> usize {
    haystack.lines().filter(|l| l.contains(needle)).count()
}

/// The corpus-load span (`span.load-all-corpus`) must be emitted exactly
/// once for a `git span list <targets...>` invocation, regardless of how
/// many spans exist or how many targets are passed.
#[test]
fn list_loads_corpus_once_with_targets() -> Result<()> {
    let repo = TestRepo::seeded()?;

    let names = seed_spans(&repo, 5)?;

    // Pass every span name as a positional target so `resolve_targets`
    // runs and calls `SpanPathIndex::load_in` → `load_all_spans_in`,
    // and `collect_listings_for_names` calls `load_all_spans_in` again.
    let mut args: Vec<&str> = vec!["--perf", "list"];
    let name_strs: Vec<String> = names.iter().map(|n| n.to_string()).collect();
    for n in &name_strs {
        args.push(n.as_str());
    }

    let output = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    let stderr = String::from_utf8(output.stderr)?;
    assert!(
        output.status.success(),
        "git span list failed: {stderr}"
    );

    let load_extents = count_lines_containing(&stderr, "span.load-all-corpus");
    assert_eq!(
        load_extents,
        1,
        "corpus must be loaded exactly once per invocation: expected \
         one `span.load-all-corpus` span, got {load_extents}.\n\
         --- perf stderr ---\n\
         {stderr}"
    );
    Ok(())
}
