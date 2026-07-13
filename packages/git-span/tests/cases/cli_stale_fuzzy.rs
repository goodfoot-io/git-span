//! Integration tests for fuzzy-similarity successor search (`find_similar_ranges`).
//!
//! Tests the full pipeline: candidate selection, memo read, window scoring,
//! confidence threshold, status classification, and rendering. Previously the
//! only fuzzy/Jaccard tests were unit tests on the pure `jaccard_similarity`
//! function in git-span-core.
//!
//! Each test creates a repo with an original file and a second file whose
//! content is similar but edited. The anchor targets the original file; after
//! `git rm` (staged deletion, HEAD blob still alive) the fuzzy fallback scans
//! candidate files and scores them via Jaccard similarity.

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Generate `count` unique lines of the form
/// `fn worker_{i:02}(param: u32) -> u32 { param * C }`.
fn generate_unique_lines(count: usize) -> Vec<String> {
    let mut lines = Vec::with_capacity(count);
    for i in 1..=count {
        lines.push(format!("fn worker_{i:02}(param: u32) -> u32 {{ param * {i} }}"));
    }
    lines
}

/// Generate `count` lines where the lines at `change_indices` (0-based) have
/// a different type signature (`u32 -> u64`) so the normalized line differs.
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

/// Join lines with newlines and add a trailing newline.
fn to_content(lines: &[String]) -> String {
    format!("{}\n", lines.join("\n"))
}

/// Read the full text of a span file from the worktree.
fn read_span(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".span").join(name);
    Ok(std::fs::read_to_string(path)?)
}

/// Create a span with one line-range anchor and commit it.
fn seed_span(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.span_stdout(["add", name, anchor])?;
    repo.span_stdout(["why", name, "-m", why])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span commit"])?;
    Ok(())
}

/// Write two files with the given content vectors and commit both.
fn seed_two_files(
    repo: &TestRepo,
    path1: &str,
    content1: &str,
    path2: &str,
    content2: &str,
) -> Result<()> {
    repo.write_file(path1, content1)?;
    repo.write_file(path2, content2)?;
    repo.commit_all("seed two files")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Test 1: Fuzzy successor found above threshold -> MOVED classification
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_above_threshold_moved() -> Result<()> {
    let repo = TestRepo::new()?;

    // file1: 50 unique lines, file2: 50 lines, 1 changed (line 25: u32 -> u64).
    // Jaccard similarity = 49/51 ~ 0.961 > 0.95 threshold -> MOVED.
    let lines = generate_unique_lines(50);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(50, &[24]); // 0-based: line 25
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L50", "above-threshold fuzzy")?;
    repo.write_commit_graph()?;

    // Staged deletion, no commit — HEAD blob stays alive for anchored_text.
    repo.run_git(["rm", "file1.txt"])?;

    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Anchor must be classified MOVED with destination and confidence.
    assert!(
        stdout.contains("moved to file2.txt#L1-L50") && stdout.contains("% match"),
        "fuzzy MOVED anchor must report destination with confidence; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Test 2: Fuzzy successor below threshold -> kept in fuzzy_successors but not
//         auto-classified as MOVED.
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_below_threshold_not_moved() -> Result<()> {
    let repo = TestRepo::new()?;

    // file1: 15 unique lines, file2: 15 lines, 4 changed (lines 3,7,11,14).
    // Jaccard = 11/19 ~ 0.579 — above noise floor (0.50), below threshold (0.95).
    let lines = generate_unique_lines(15);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(15, &[2, 6, 10, 13]);
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L15", "below-threshold fuzzy")?;
    repo.write_commit_graph()?;

    repo.run_git(["rm", "file1.txt"])?;

    // --- Human output assertions ---
    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Must NOT say "moved to file2.txt".
    assert!(
        !stdout.contains("moved to file2"),
        "below-threshold anchor must NOT be classified MOVED; stdout:\n{stdout}"
    );
    // Must surface the candidate for operator review.
    assert!(
        stdout.contains("possible match: file2.txt#L1-L15"),
        "fuzzy candidates below threshold must be reported for review; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("% similar"),
        "candidate should carry similarity percentage; stdout:\n{stdout}"
    );

    // --- JSON assertions ---
    let json_out = repo.run_span(["stale", "--format", "json", "--no-exit-code"])?;
    let v: Value = serde_json::from_slice(&json_out.stdout)?;
    let findings = v["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");

    // At least one finding has non-empty fuzzy_successors.
    let has_fuzzy = findings.iter().any(|f| {
        f["fuzzy_successors"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
    });
    assert!(has_fuzzy, "at least one finding must have fuzzy_successors");

    // The finding status must NOT be MOVED (it's below threshold).
    for f in findings {
        if f["fuzzy_successors"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
        {
            assert_ne!(
                f["status"]["code"], "MOVED",
                "below-threshold fuzzy anchor must not be MOVED"
            );
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 3: No candidates -> anchor stays Deleted
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_no_candidates_deleted() -> Result<()> {
    let repo = TestRepo::new()?;

    // Single file with no similar sibling.
    let lines = generate_unique_lines(10);
    let content = to_content(&lines);
    repo.write_file("file1.txt", &content)?;
    repo.commit_all("seed one file")?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L10", "no-candidates fuzzy")?;
    repo.write_commit_graph()?;

    // Committed deletion so HEAD path is absent -> head_path_absent true.
    repo.run_git(["rm", "file1.txt"])?;
    repo.run_git(["commit", "-m", "delete file1"])?;
    repo.write_commit_graph()?;

    // --- Human output ---
    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("deleted"),
        "anchor must be classified Deleted when no candidate exists; stdout:\n{stdout}"
    );

    // --- JSON: fuzzy_successors must be empty ---
    let json_out = repo.run_span(["stale", "--format", "json", "--no-exit-code"])?;
    let v: Value = serde_json::from_slice(&json_out.stdout)?;
    let findings = v["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");
    for f in findings {
        let succ = f["fuzzy_successors"].as_array().unwrap();
        assert!(
            succ.is_empty(),
            "Deleted anchor with no candidates must have empty fuzzy_successors"
        );
        assert_eq!(
            f["status"]["code"], "DELETED",
            "expected DELETED status"
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 4: Exact-match MOVED regression guard
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_exact_match_moved_no_fuzzy() -> Result<()> {
    let repo = TestRepo::new()?;

    // Only one file initially. git mv will rename it, making the HEAD walk
    // follow the rename and classify as exact-match Moved (no fuzzy scan).
    let lines = generate_unique_lines(10);
    let content = to_content(&lines);
    repo.write_file("file1.txt", &content)?;
    repo.commit_all("seed one file")?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L10", "exact-match move")?;
    repo.write_commit_graph()?;

    // Committed rename: HEAD walk follows the content to the new path.
    repo.run_git(["mv", "file1.txt", "file2.txt"])?;
    repo.run_git(["commit", "-m", "rename file1 -> file2"])?;
    repo.write_commit_graph()?;

    // --- Human output ---
    let out = repo.run_span(["stale", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("moved to file2.txt#L1-L10"),
        "exact-match MOVED must report destination; stdout:\n{stdout}"
    );
    // Exact match has no fuzzy annotation (no percentage).
    assert!(
        !stdout.contains("% match") && !stdout.contains("% similar"),
        "exact-match MOVED must not show fuzzy percentage; stdout:\n{stdout}"
    );

    // --- JSON: fuzzy_successors must be empty for the MOVED finding ---
    let json_out = repo.run_span(["stale", "--format", "json", "--no-exit-code"])?;
    let v: Value = serde_json::from_slice(&json_out.stdout)?;
    let findings = v["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");
    for f in findings {
        if f["status"]["code"] == "MOVED" {
            let succ = f["fuzzy_successors"].as_array().unwrap();
            assert!(
                succ.is_empty(),
                "exact-match MOVED must have empty fuzzy_successors"
            );
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 5a: --fix with default threshold -> does NOT re-anchor
// ---------------------------------------------------------------------------

#[test]
fn fix_respects_default_fuzzy_threshold() -> Result<()> {
    let repo = TestRepo::new()?;

    // file1: 25 lines unique, file2: 25 lines, 2 changed (lines 7, 19).
    // Jaccard = 23/27 ~ 0.852 — below 0.95 default, above noise floor.
    let lines = generate_unique_lines(25);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(25, &[6, 18]);
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L25", "fix threshold guard")?;
    repo.write_commit_graph()?;

    repo.run_git(["rm", "file1.txt"])?;

    // Read span content BEFORE --fix.
    let before = read_span(&repo, "m")?;

    // Default threshold: 0.852 < 0.95 -> not re-anchored.
    let fix_out = repo.run_span(["stale", "--fix"])?;

    let after = read_span(&repo, "m")?;
    assert_eq!(
        before, after,
        "span must be unchanged by --fix with default threshold"
    );
    // Exit code 1: drift remains.
    assert_eq!(fix_out.status.code(), Some(1));

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 5b: --fix with lowered fuzzy threshold -> re-anchors
// ---------------------------------------------------------------------------

#[test]
fn fix_with_lowered_fuzzy_threshold() -> Result<()> {
    let repo = TestRepo::new()?;

    // Same content as 5a: 25 lines, 2 changed => Jaccard ~ 0.852.
    let lines = generate_unique_lines(25);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(25, &[6, 18]);
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L25", "fix lowered threshold")?;
    repo.write_commit_graph()?;

    repo.run_git(["rm", "file1.txt"])?;

    // Lowered threshold: 0.852 >= 0.70 -> re-anchored.
    let fix_out =
        repo.run_span(["stale", "--fix", "--fuzzy-threshold", "0.70"])?;
    let _fix_stdout = String::from_utf8_lossy(&fix_out.stdout);

    let after = read_span(&repo, "m")?;
    assert!(
        after.contains("file2.txt"),
        "span must be re-anchored to file2.txt with --fuzzy-threshold 0.70; span:\n{after}"
    );
    assert!(
        !after.contains("file1.txt"),
        "old anchor path must be removed from span; span:\n{after}"
    );
    // Exit code 0: all drift fixed.
    assert_eq!(
        fix_out.status.code(),
        Some(0),
        "exit code should be 0 after fix; stderr:\n{}",
        String::from_utf8_lossy(&fix_out.stderr)
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 6: JSON output includes confidence/fuzzy_successors
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_json_output() -> Result<()> {
    let repo = TestRepo::new()?;

    // Same setup as Test 1: 50 lines, 1 changed -> MOVED with fuzzy.
    let lines = generate_unique_lines(50);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(50, &[24]);
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L50", "json fuzzy")?;
    repo.write_commit_graph()?;

    repo.run_git(["rm", "file1.txt"])?;

    // --- Fuzzy MOVED: fuzzy_successors non-empty, moved_to.confidence present ---
    let out = repo.run_span(["stale", "--format", "json", "--no-exit-code"])?;
    let v: Value = serde_json::from_slice(&out.stdout)?;
    let findings = v["findings"].as_array().unwrap();
    assert!(!findings.is_empty(), "JSON must have findings");

    let moved_findings: Vec<&Value> = findings
        .iter()
        .filter(|f| f["status"]["code"] == "MOVED")
        .collect();
    assert!(!moved_findings.is_empty(), "must have MOVED findings");

    for f in &moved_findings {
        // fuzzy_successors should be non-empty for fuzzy MOVED.
        let succ = f["fuzzy_successors"].as_array().unwrap();
        assert!(!succ.is_empty(), "fuzzy MOVED must have fuzzy_successors");
        // Each successor has path, extent, confidence.
        assert!(succ[0]["path"].is_string(), "successor must have path");
        assert!(succ[0]["confidence"].is_f64(), "successor must have confidence");
        assert!(succ[0]["confidence"].as_f64().unwrap() > 0.50, "confidence above noise floor");

        // moved_to should have the confidence field.
        let moved_to = f["moved_to"].as_object().unwrap();
        assert!(moved_to.contains_key("confidence"), "moved_to must have confidence for fuzzy match");
        assert!(
            moved_to["confidence"].as_f64().unwrap() >= 0.95,
            "moved_to confidence must be >= threshold"
        );
    }

    // Also verify exact-match MOVED (from Test 4) has empty fuzzy_successors.
    // We set that up in a separate scenario: use the same repo, different anchor.
    // For simplicity, this is covered by Test 4's JSON assertions.

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 7: Porcelain output includes "# fuzzy <N>" comment
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_porcelain_comment() -> Result<()> {
    let repo = TestRepo::new()?;

    // Same setup as Test 1: 50 lines, 1 changed -> MOVED fuzzy.
    let lines = generate_unique_lines(50);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(50, &[24]);
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L50", "porcelain fuzzy")?;
    repo.write_commit_graph()?;

    repo.run_git(["rm", "file1.txt"])?;

    let out = repo.run_span(["stale", "--format", "porcelain", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Porcelain header
    assert!(
        stdout.contains("# porcelain v2"),
        "must have porcelain header; stdout:\n{stdout}"
    );
    // Finding line with MOVED status.
    assert!(
        stdout.contains("MOVED"),
        "porcelain must contain MOVED status; stdout:\n{stdout}"
    );
    // Fuzzy comment line.
    assert!(
        stdout.contains("# fuzzy"),
        "porcelain must have # fuzzy comment for fuzzy MOVED; stdout:\n{stdout}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test 8: Porcelain output for below-threshold fuzzy includes # fuzzy comment
// ---------------------------------------------------------------------------

#[test]
fn fuzzy_porcelain_below_threshold_comment() -> Result<()> {
    let repo = TestRepo::new()?;

    // Same setup as Test 2: 15 lines, 4 changed -> Changed + fuzzy_successors.
    let lines = generate_unique_lines(15);
    let content1 = to_content(&lines);
    let edited = generate_modified_lines(15, &[2, 6, 10, 13]);
    let content2 = to_content(&edited);

    seed_two_files(&repo, "file1.txt", &content1, "file2.txt", &content2)?;
    repo.write_commit_graph()?;

    seed_span(&repo, "m", "file1.txt#L1-L15", "porcelain below threshold")?;
    repo.write_commit_graph()?;

    repo.run_git(["rm", "file1.txt"])?;

    let out = repo.run_span(["stale", "--format", "porcelain", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);

    assert!(
        stdout.contains("# fuzzy"),
        "porcelain must have # fuzzy comment for below-threshold candidates; stdout:\n{stdout}"
    );
    // Status should be CHANGED (not MOVED) for below-threshold.
    assert!(
        stdout.contains("CHANGED"),
        "below-threshold fuzzy anchor must be CHANGED in porcelain; stdout:\n{stdout}"
    );

    Ok(())
}
