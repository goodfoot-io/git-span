//! Regression tests for card main-269: relocation scans must not re-anchor
//! a drifted span to an arbitrary same-content file when matches are not
//! unique.
//!
//! The relocation scans in [`resolver::engine::anchor`] (the exact
//! `find_relocated_range_in_paths` and the fuzzy `find_similar_ranges`) and
//! the whole-file twin `find_relocated_whole_file` in
//! [`resolver::engine::whole_file`] classify a missing anchor's destination
//! by scanning tracked paths for the stored content. Each installed the
//! first match (`first()`) with no uniqueness check, so when several files
//! hold the same content — byte-identical mirror pairs and inlined
//! sentence copies are ordinary in this repo — `git span drift` reported a
//! confident `moved to <arbitrary file>` and `--fix` silently re-anchored
//! the span to a wrong copy with zero drift reported afterwards (the
//! main-269 live incident: the reconcile contract sentence re-anchored
//! from dedicated.md to worker.md).
//!
//! Fail-closed contract, consistent with main-264's worktree-fallback
//! ambiguity handling:
//! - a unique match still classifies `Moved` exactly as before;
//! - a non-unique match set classifies terminal (`Changed`/`Deleted`),
//!   surfaces every candidate in `fuzzy_successors`, and `--fix` refuses.

use crate::support;
use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

/// Read the full text of a span file from the worktree.
fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".span").join(name);
    Ok(std::fs::read_to_string(path)?)
}

/// Create a span with one anchor and commit it.
fn seed_span(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.span_stdout(["add", name, anchor])?;
    repo.span_stdout(["why", name, why])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    Ok(())
}

/// The shared refusal contract: after `--fix` the span is byte-unchanged
/// and the anchor still drifts.
fn assert_fix_refuses(repo: &TestRepo, name: &str) -> Result<()> {
    let before = read_span(repo, name)?;
    let out = repo.run_span(["drift", "--fix"])?;
    let after = read_span(repo, name)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        before, after,
        "--fix on a non-unique relocation must never rewrite the span; got:\n{after}"
    );
    assert!(
        !stdout.contains("1 updated"),
        "--fix must report zero re-anchors; stdout=\n{stdout}"
    );
    // The anchor stays drifted: a fresh scan still reports it.
    let out_again = repo.run_span(["drift", "--no-exit-code"])?;
    let again = String::from_utf8_lossy(&out_again.stdout);
    assert!(
        !again.contains("0 drift across"),
        "the span must still report drift after a refused --fix; drift=\n{again}"
    );
    Ok(())
}

/// Shared drift assertions: no `moved to`, every candidate surfaced, and
/// no MOVED status in JSON.
fn assert_ambiguous_finding(human_stdout: &str, json: &Value, expected_candidates: &[&str]) {
    assert!(
        !human_stdout.contains("moved to"),
        "a non-unique match set must never auto-classify as Moved; drift=\n{human_stdout}"
    );
    for candidate in expected_candidates {
        assert!(
            human_stdout.contains(candidate),
            "the finding must surface candidate {candidate}; drift=\n{human_stdout}"
        );
    }
    let findings = json["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");
    for f in findings {
        assert_ne!(
            f["status"]["code"], "MOVED",
            "non-unique relocation must not be MOVED; finding={f}"
        );
        let succ = f["fuzzy_successors"].as_array().unwrap();
        let mut seen: Vec<&str> = succ
            .iter()
            .filter_map(|s| s["path"].as_str())
            .collect();
        seen.sort_unstable();
        let mut want: Vec<&str> = expected_candidates.to_vec();
        want.sort_unstable();
        assert_eq!(seen, want, "every candidate must be surfaced; finding={f}");
        for s in succ {
            assert_eq!(
                s["confidence"], 1.0,
                "exact-content candidates surface at full confidence; finding={f}"
            );
        }
    }
}

/// The live-incident shape, line-anchor arm: the anchored file is removed
/// at HEAD and two byte-identical files appear in the same commit. The
/// exact relocation scan sees both as rename targets and today installs
/// whichever the index enumerates first.
#[test]
fn exact_scan_nonunique_line_anchor_stays_drifted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.md", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    seed_span(&repo, "demo", "a.md#L1-L1", "non-unique exact")?;

    repo.run_git(["rm", "a.md"])?;
    repo.write_file("b1.md", "alpha\nbeta\ngamma\n")?;
    repo.write_file("b2.md", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("delete a, add two identical copies")?;

    let out = repo.run_span(["drift", "--no-exit-code"])?;
    let human = String::from_utf8_lossy(&out.stdout);
    let json_out = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    assert_ambiguous_finding(&human, &json, &["b1.md", "b2.md"]);
    assert_fix_refuses(&repo, "demo")
}

/// The same shape for a whole-file anchor: `find_relocated_whole_file`
/// also installs the first byte-identical match.
#[test]
fn exact_scan_nonunique_whole_file_stays_drifted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.md", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;
    seed_span(&repo, "demo", "a.md", "non-unique exact whole-file")?;

    repo.run_git(["rm", "a.md"])?;
    repo.write_file("b1.md", "alpha\nbeta\ngamma\n")?;
    repo.write_file("b2.md", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("delete a, add two identical copies")?;

    let out = repo.run_span(["drift", "--no-exit-code"])?;
    let human = String::from_utf8_lossy(&out.stdout);
    let json_out = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    assert_ambiguous_finding(&human, &json, &["b1.md", "b2.md"]);
    assert_fix_refuses(&repo, "demo")
}

/// The fuzzy-similarity arm: two tracked files both clear the auto-fix
/// threshold for the anchored content; the scan's `first()` pick is a
/// guess. Shape mirrors the staged-deletion fuzzy tests in
/// `cli_drift_fuzzy.rs`.
#[test]
fn fuzzy_scan_nonunique_stays_drifted() -> Result<()> {
    let repo = TestRepo::new()?;
    // 100-line files; f2 and f3 each differ from f1 in exactly one line
    // (Jaccard 99/101 ~ 0.9802 >= the 0.95 auto-fix threshold).
    let content1 = to_content(&generate_unique_lines(100));
    let content2 = to_content(&generate_modified_lines(100, &[49]));
    let content3 = to_content(&generate_modified_lines(100, &[50]));
    repo.write_file("f1.txt", &content1)?;
    repo.write_file("f2.txt", &content2)?;
    repo.write_file("f3.txt", &content3)?;
    repo.commit_all("seed three files")?;
    repo.write_commit_graph()?;
    seed_span(&repo, "m", "f1.txt#L1-L100", "non-unique fuzzy")?;
    repo.write_commit_graph()?;

    // Staged deletion: the index no longer records f1, so the exact scan
    // and worktree fallback both stand down and the fuzzy scan decides.
    repo.run_git(["rm", "f1.txt"])?;

    let out = repo.run_span(["drift", "--no-exit-code"])?;
    let human = String::from_utf8_lossy(&out.stdout);
    let json_out = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    // Not an exact-content match, so the candidates carry their computed
    // confidence rather than 1.0.
    assert!(
        !human.contains("moved to"),
        "a non-unique match set must never auto-classify as Moved; drift=\n{human}"
    );
    for candidate in ["f2.txt", "f3.txt"] {
        assert!(
            human.contains(candidate),
            "the finding must surface candidate {candidate}; drift=\n{human}"
        );
    }
    let findings = json["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");
    for f in findings {
        assert_ne!(
            f["status"]["code"], "MOVED",
            "non-unique fuzzy relocation must not be MOVED; finding={f}"
        );
        let succ = f["fuzzy_successors"].as_array().unwrap();
        let mut seen: Vec<&str> = succ
            .iter()
            .filter_map(|s| s["path"].as_str())
            .collect();
        seen.sort_unstable();
        assert_eq!(seen, ["f2.txt", "f3.txt"], "both candidates surfaced; finding={f}");
        for s in succ {
            assert!(
                s["confidence"].as_f64().unwrap() >= 0.95,
                "surfaced candidates must be at/above the auto-fix threshold; finding={f}"
            );
        }
    }
    assert_fix_refuses(&repo, "m")
}

/// The card's repro shape, line-anchor arm: two tracked same-content files,
/// the anchored one deleted from the worktree only. The fuzzy scan guesses
/// the surviving copy is the destination; the index still records the
/// anchored path, so no move intent exists and nothing may be chosen for
/// the operator.
#[test]
fn worktree_only_rm_with_duplicate_stays_drifted() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.md", "x\n")?;
    repo.write_file("b.md", "x\n")?;
    repo.commit_all("seed")?;
    seed_span(&repo, "demo", "a.md#L1-L1", "repro")?;

    // Delete the anchored file from the worktree only; the index and HEAD
    // still record it.
    std::fs::remove_file(repo.path().join("a.md"))?;

    let out = repo.run_span(["drift", "--no-exit-code"])?;
    let human = String::from_utf8_lossy(&out.stdout);
    let json_out = repo.run_span(["drift", "--format", "json", "--no-exit-code"])?;
    let json: Value = serde_json::from_slice(&json_out.stdout)?;

    assert!(
        !human.contains("moved to"),
        "a worktree-only deletion must never auto-classify as Moved; drift=\n{human}"
    );
    assert!(
        human.contains("deleted in the working tree"),
        "the removal must read as a worktree deletion; drift=\n{human}"
    );
    let findings = json["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");
    for f in findings {
        assert_ne!(
            f["status"]["code"], "MOVED",
            "worktree-only removal with a duplicate must not be MOVED; finding={f}"
        );
    }
    assert_fix_refuses(&repo, "demo")
}

fn generate_unique_lines(count: usize) -> Vec<String> {
    let mut lines = Vec::with_capacity(count);
    for i in 1..=count {
        lines.push(format!(
            "fn worker_{i:02}(param: u32) -> u32 {{ param * {i} }}"
        ));
    }
    lines
}

fn generate_modified_lines(count: usize, change_indices: &[usize]) -> Vec<String> {
    let changed: std::collections::HashSet<usize> = change_indices.iter().copied().collect();
    let mut lines = Vec::with_capacity(count);
    for i in 0..count {
        let line_no = i + 1;
        if changed.contains(&i) {
            lines.push(format!(
                "fn worker_{line_no:02}(param: u64) -> u64 {{ param * {line_no} }}"
            ));
        } else {
            lines.push(format!(
                "fn worker_{line_no:02}(param: u32) -> u32 {{ param * {line_no} }}"
            ));
        }
    }
    lines
}

fn to_content(lines: &[String]) -> String {
    format!("{}\n", lines.join("\n"))
}
