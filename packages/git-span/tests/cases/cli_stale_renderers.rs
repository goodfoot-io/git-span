//! Slice 8 renderer × layer-combination smoke tests.
//!
//! Per `docs/stale-layers-slices.md` slice 8: the renderers consume
//! `Finding` end-to-end. These tests exercise each
//! `--format` against representative layer toggles to catch shape
//! regressions cheaply. `tests/cli_stale_human.rs` and
//! `tests/cli_stale_machine.rs` continue to host older / phase-pending
//! snapshot expectations.

use crate::support;

use anyhow::Result;
use serde_json::Value;
use std::process::Command;
use support::TestRepo;

fn seed(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", name, "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

fn seed_stable(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", name, "-m", "stable seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

fn drift_in_head(repo: &TestRepo) -> Result<String> {
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("mutate")
}

#[test]
fn json_envelope_has_schema_version_and_findings() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift_in_head(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=json"])?;
    let v: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(v["schema_version"], 2);
    assert!(v["findings"].is_array(), "envelope: {v}");
    let first = &v["findings"][0];
    assert_eq!(first["status"]["code"], "CHANGED");
    assert_eq!(first["span"], "m");
    assert!(first["anchor_id"].is_null());
    assert!(first["anchored"]["path"].is_string());
    Ok(())
}

#[test]
fn discovery_json_filters_clean_spans_before_rendering() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "drifty")?;
    seed_stable(&repo, "quiet")?;
    drift_in_head(&repo)?;

    let out = repo.run_span(["stale", "--format=json"])?;
    assert_eq!(out.status.code(), Some(1));
    let v: Value = serde_json::from_slice(&out.stdout)?;
    let findings = v["findings"].as_array().expect("findings array");
    assert!(
        findings.iter().any(|f| f["span"] == "drifty"),
        "drifty finding missing: {v}"
    );
    assert!(
        findings.iter().all(|f| f["span"] != "quiet"),
        "clean span leaked into JSON discovery output: {v}"
    );
    Ok(())
}

#[test]
fn discovery_clean_head_pinned_span_uses_fast_path() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "fresh")?;

    let warm = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .arg("stale")
        .output()?;
    assert_eq!(warm.status.code(), Some(0));

    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_PERF", "1")
        .arg("stale")
        .output()?;

    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8(out.stdout)?;
    let stderr = String::from_utf8(out.stderr)?;
    assert!(
        !stdout.trim().is_empty(),
        "stdout should have summary line when clean, got: stdout={stdout}"
    );
    // The new store serves a clean pinned span from the whole-result
    // warm short-circuit — the fast path that returns the full cached
    // result without re-resolving any anchor (the direct successor of the
    // old `cache_v2.warm-clean`/`baseline-hit` fast path). The `resolve-*`
    // negatives below prove no full resolution ran behind it.
    assert!(
        stderr.contains("git-span perf: cache-path.whole-result-hit 1"),
        "expected a whole-result warm-clean hit: {stderr}"
    );
    assert!(
        !stderr.contains("git-span perf: resolver.resolve-stale-spans"),
        "warm clean discovery should skip full resolver: {stderr}"
    );
    assert!(
        !stderr.contains("git-span perf: resolver.resolve-anchors"),
        "warm clean discovery should skip per-anchor resolution: {stderr}"
    );
    Ok(())
}

#[test]
fn discovery_porcelain_filters_clean_spans_before_rendering() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "drifty")?;
    seed_stable(&repo, "quiet")?;
    drift_in_head(&repo)?;

    let out = repo.run_span(["stale", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("drifty"), "stdout={text}");
    assert!(!text.contains("quiet"), "stdout={text}");
    Ok(())
}

#[test]
fn porcelain_layered_includes_src_column() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift_in_head(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=porcelain"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text
        .lines()
        .find(|l| l.starts_with("CHANGED"))
        .unwrap_or("");
    // 6 columns when src column is on.
    assert_eq!(
        line.matches('\t').count(),
        5,
        "layered porcelain has src column: {line}"
    );
    Ok(())
}

#[test]
fn human_layered_emits_src_marker() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift_in_head(&repo)?;
    let out = repo.run_span(["stale", "m"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    // New: lowercase prose suffix on the anchor bullet line.
    assert!(
        text.contains("changed"),
        "expected lowercase prose description of changed anchor, got: {text}"
    );
    Ok(())
}

#[test]
fn discovery_human_hides_fully_fresh_span() -> Result<()> {
    // Workspace scan (Human format) is a drift report: a fully-fresh span
    // (here an uncommitted, worktree-only span whose anchor matches the
    // file) does not surface. Only the summary line is printed.
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "new-span", "file1.txt#L1-L5"])?;

    let out = repo.run_span(["stale"])?;
    assert_eq!(out.status.code(), Some(0));
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(
        !text.contains("## new-span"),
        "fully-fresh span must NOT appear in workspace scan; stdout={text}"
    );
    assert!(
        text.contains("0 stale"),
        "summary line must appear; stdout={text}"
    );
    Ok(())
}

#[test]
fn discovery_json_includes_clean_span_with_pending_metadata() -> Result<()> {
    // File-backed model: `git span why` rewrites the why section of the
    // worktree span file directly — there is no staged "pending"
    // metadata op. A why-only edit on an otherwise clean span produces
    // no drift: exit 0, and the JSON workspace scan emits no findings
    // (the renderer is silent when there is nothing stale).
    let repo = TestRepo::seeded()?;
    seed(&repo, "clean-with-pending")?;
    repo.span_stdout(["why", "clean-with-pending", "-m", "updated reason"])?;

    let out = repo.run_span(["stale", "--format=json"])?;
    assert_eq!(out.status.code(), Some(0));
    assert!(
        out.stdout.is_empty()
            || serde_json::from_slice::<Value>(&out.stdout)?["findings"]
                .as_array()
                .is_some_and(Vec::is_empty),
        "why-only edit must not create findings; stdout={}",
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

#[test]
fn human_pending_ops_render_range_addresses() -> Result<()> {
    // File-backed model: `add` and `remove` edit the worktree span file
    // directly. After adding file2.txt#L1-L5 and removing
    // file1.txt#L1-L5 the span's only anchor is file2.txt#L1-L5, which
    // renders as a normal bullet (file2.txt unchanged → Fresh) and the
    // removed file1 anchor no longer appears.
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    repo.span_stdout(["add", "m", "file2.txt#L1-L5"])?;
    repo.span_stdout(["remove", "m", "file1.txt#L1-L5"])?;
    // Drift the remaining anchor so the (now drift-report) named lookup
    // surfaces the span: edit line 1 of file2.txt.
    repo.write_file(
        "file2.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let out = repo.span_stdout(["stale", "m", "--no-exit-code"])?;
    assert!(out.contains("file2.txt#L1-L5"), "stdout={out}");
    assert!(
        !out.contains("file1.txt#L1-L5"),
        "removed anchor must not appear; stdout={out}"
    );
    Ok(())
}

#[test]
fn named_stale_clean_new_span_reports_zero_stale() -> Result<()> {
    // File-backed model: `git span add` writes the anchor directly into
    // the worktree span file (no staging area). The new span's anchor on
    // unchanged file1.txt resolves Fresh, so the (drift-report) named
    // lookup renders no block and prints the 0-stale summary instead.
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "new-span", "file1.txt#L1-L5"])?;
    let out = repo.span_stdout(["stale", "new-span", "--no-exit-code"])?;
    assert!(
        !out.contains("## new-span"),
        "clean named span must not render a block; stdout={out}"
    );
    assert!(out.contains("0 stale across"), "stdout={out}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Phase A: always-on Moved arrow + moved_to JSON field.
// ---------------------------------------------------------------------------

/// Helper: seed a line-range anchor on file1.txt#L1-L5 and commit.
fn seed_line_range(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", name, "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

/// Helper: shift lines down (prepend 2 lines) so the range moves.
fn shift_lines(repo: &TestRepo) -> Result<()> {
    repo.write_file(
        "file1.txt",
        "extra1\nextra2\nline1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("shift")?;
    Ok(())
}

#[test]
fn human_moved_row_shows_arrow_with_destination() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range(&repo, "m")?;
    shift_lines(&repo)?;
    let out = repo.run_span(["stale", "m"])?;
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8_lossy(&out.stdout);
    // New: lowercase "moved" followed by the destination path.
    assert!(
        text.contains("moved") && text.contains("file1.txt"),
        "expected lowercase prose description of Moved anchor; stdout={text}"
    );
    Ok(())
}

#[test]
fn human_fresh_sibling_row_has_no_trailing_parenthesis() -> Result<()> {
    // New: unified block shows all anchors. Stale get suffix, fresh appear bare.
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "m", "file1.txt#L1-L5", "file2.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    // Drift only file1.txt so file2.txt#L1-L5 stays Fresh.
    repo.write_file(
        "file1.txt",
        "edit1\nedit2\nedit3\nedit4\nedit5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let out = repo.run_span(["stale", "m"])?;
    let text = String::from_utf8_lossy(&out.stdout);
    // Stale anchor carries a suffix; fresh appears bare.
    assert!(
        text.contains("file1.txt#L1-L5 — changed"),
        "stale anchor should carry status suffix, got: {text}"
    );
    assert!(
        text.contains("file2.txt#L1-L5"),
        "fresh sibling should appear bare in unified block, got: {text}"
    );
    // No old summary line.
    assert!(
        !text.contains("has drifted") && !text.contains("have drifted"),
        "old summary line must be absent, got: {text}"
    );
    Ok(())
}

#[test]
fn json_moved_finding_has_moved_to_field() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_line_range(&repo, "m")?;
    shift_lines(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=json"])?;
    assert_eq!(out.status.code(), Some(1));
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid json");
    let findings = v["findings"].as_array().expect("findings array");
    let moved = findings
        .iter()
        .find(|f| f["status"]["code"] == "MOVED")
        .expect("at least one MOVED finding");
    assert!(
        moved["moved_to"].is_object(),
        "MOVED finding must have moved_to object; finding={moved}"
    );
    assert!(
        moved["moved_to"]["path"].is_string(),
        "moved_to must have path; finding={moved}"
    );
    assert!(
        moved["moved_to"]["extent"].is_object(),
        "moved_to must have extent; finding={moved}"
    );
    Ok(())
}

#[test]
fn json_changed_finding_has_no_moved_to_field() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift_in_head(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=json"])?;
    assert_eq!(out.status.code(), Some(1));
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid json");
    let findings = v["findings"].as_array().expect("findings array");
    let changed = findings
        .iter()
        .find(|f| f["status"]["code"] == "CHANGED")
        .expect("at least one CHANGED finding");
    assert!(
        changed["moved_to"].is_null(),
        "non-MOVED finding must not have moved_to; finding={changed}"
    );
    Ok(())
}

// ── multi-arg positional resolution ──────────────────────────────────────

#[test]
fn missing_file_arg_exits_one_with_diagnostic() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["stale", "nonexistent-file"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("is not tracked"),
        "expected file-not-tracked diagnostic, got: {stderr}"
    );
    Ok(())
}

#[test]
fn multiple_missing_file_args_reports_each() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["stale", "bad1", "bad2"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("bad1") && stderr.contains("bad2") && stderr.contains("are not tracked"),
        "expected combined diagnostic for both files, got: {stderr}"
    );
    Ok(())
}

#[test]
fn existing_file_with_no_span_does_not_error() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // file2.txt exists in the seeded worktree but no span tracks it. Stale
    // should exit 0 silently — "no span involves this file" is not an error.
    let out = repo.run_span(["stale", "file2.txt"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "expected exit 0 for existing-but-unanchored file, stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.contains("file not found"),
        "must not surface file-not-found for an existing file, got: {stderr}"
    );
    Ok(())
}

#[test]
fn file_path_arg_resolves_span_via_path_index() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift_in_head(&repo)?;
    // Resolve by file path (not span name) through the path index.
    let out = repo.run_span(["stale", "file1.txt", "--format=json"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "stale span should exit 1, stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid json");
    assert_eq!(
        v["span"], "m",
        "file path arg should resolve to span 'm' via path index, got: {v}"
    );
    Ok(())
}

#[test]
fn mixed_span_name_and_path_args_are_deduplicated() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift_in_head(&repo)?;
    // Pass both the span name and the file path — both resolve to span "m".
    let out = repo.run_span(["stale", "m", "file1.txt", "--format=json"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "stale span should exit 1, stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid json");
    assert_eq!(
        v["span"], "m",
        "deduplicated args should produce one span output, got: {v}"
    );
    let findings = v["findings"].as_array().expect("findings array");
    let changed = findings
        .iter()
        .filter(|f| f["status"]["code"] == "CHANGED")
        .count();
    assert!(
        changed > 0,
        "should have at least one CHANGED finding from span 'm'"
    );
    Ok(())
}

#[test]
fn all_args_resolve_to_clean_span_exits_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "clean-span")?;
    // Span is clean (no drift). Stale by span name should exit 0.
    let out = repo.run_span(["stale", "clean-span"])?;
    assert_eq!(out.status.code(), Some(0));
    Ok(())
}

// ---------------------------------------------------------------------------
// Card main-168: `--cluster` output (Human/JSON/porcelain), plus the
// warm-cache regression guard.
//
// Per `plans/bounded-rename-chain.md` ("Clustering design"): `--cluster`
// partitions the run's stale spans into connected components by shared
// anchored file.
// ---------------------------------------------------------------------------

/// Seed a span anchored on `file1.txt#L6-L10` (the bottom half). Deliberately
/// not reusing `seed_stable` here: that helper's name encodes "stays clean
/// under `drift_in_head`", which does not hold for this fixture — this
/// helper is paired with `drift_both_halves_of_file1`, which changes both
/// halves of `file1.txt`, so a span seeded here is expected to go stale too.
fn seed_file1_lower(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L6-L10"])?;
    repo.span_stdout(["why", name, "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

/// Seed a span anchored on `file2.txt#L1-L5`, unrelated to `file1.txt`.
fn seed_file2_upper(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file2.txt#L1-L5"])?;
    repo.span_stdout(["why", name, "-m", "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

/// Rewrite every line of `file1.txt` so both the L1-L5 and L6-L10 halves
/// hash-differ from their seeded content.
fn drift_both_halves_of_file1(repo: &TestRepo) -> Result<String> {
    repo.write_file(
        "file1.txt",
        "ONE\nTWO\nTHREE\nFOUR\nFIVE\nSIX\nSEVEN\nEIGHT\nNINE\nTEN\n",
    )?;
    repo.commit_all("mutate both halves of file1")
}

/// Rewrite the top of `file2.txt` so its own anchor drifts independently of
/// `file1.txt`.
fn drift_file2_head(repo: &TestRepo) -> Result<String> {
    repo.write_file(
        "file2.txt",
        "A\nB\nC\nD\nE\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\n",
    )?;
    repo.commit_all("mutate file2 head")
}

/// `m` (`file1.txt#L1-L5`) and `n` (`file1.txt#L6-L10`) share `file1.txt` and
/// go stale together; `o` (`file2.txt#L1-L5`) is unrelated and goes stale on
/// its own. `--cluster` must place `m`/`n` in one cluster (bridged on
/// `file1.txt`) and report `o` as an independent singleton.
fn seed_cluster_fixture(repo: &TestRepo) -> Result<()> {
    seed(repo, "m")?;
    seed_file1_lower(repo, "n")?;
    seed_file2_upper(repo, "o")?;
    drift_both_halves_of_file1(repo)?;
    drift_file2_head(repo)?;
    Ok(())
}

#[test]
fn human_cluster_lists_shared_spans_and_independent_singleton() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_cluster_fixture(&repo)?;

    let out = repo.span_stdout(["stale", "--cluster", "--no-exit-code"])?;
    assert!(out.contains("Clusters:"), "stdout={out}");
    assert!(
        out.contains("m, n (shared: file1.txt)"),
        "expected m/n clustered on the shared file1.txt bridge, deterministically \
         ordered; stdout={out}"
    );
    assert!(
        out.contains("o (independent)"),
        "unrelated span o must render as an independent singleton; stdout={out}"
    );
    Ok(())
}

#[test]
fn json_cluster_field_lists_spans_and_shared_files() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_cluster_fixture(&repo)?;

    let out = repo.span_stdout(["stale", "--cluster", "--format=json", "--no-exit-code"])?;
    let v: Value = serde_json::from_str(&out)?;
    let clusters = v["clusters"].as_array().expect("clusters array");
    assert_eq!(
        clusters.len(),
        2,
        "expected one m/n cluster and one independent o cluster: {v}"
    );

    let bridged = clusters
        .iter()
        .find(|c| {
            let spans: Vec<&str> = c["spans"]
                .as_array()
                .expect("spans array")
                .iter()
                .map(|s| s.as_str().expect("span name"))
                .collect();
            spans.contains(&"m") && spans.contains(&"n")
        })
        .unwrap_or_else(|| panic!("no cluster contains both m and n: {v}"));
    assert_eq!(
        bridged["spans"],
        serde_json::json!(["m", "n"]),
        "cluster members must be deterministically ordered: cluster={bridged}"
    );
    assert_eq!(
        bridged["shared_files"],
        serde_json::json!(["file1.txt"]),
        "cluster={bridged}"
    );

    let singleton = clusters
        .iter()
        .find(|c| c["spans"].as_array().expect("spans array").len() == 1)
        .unwrap_or_else(|| panic!("no singleton cluster found: {v}"));
    assert_eq!(singleton["spans"], serde_json::json!(["o"]));
    assert!(
        singleton["shared_files"]
            .as_array()
            .expect("shared_files array")
            .is_empty(),
        "singleton={singleton}"
    );
    Ok(())
}

#[test]
fn porcelain_cluster_comment_lines_list_spans_and_shared_files() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_cluster_fixture(&repo)?;

    let out = repo.span_stdout(["stale", "--cluster", "--format=porcelain", "--no-exit-code"])?;
    assert!(
        out.contains("# cluster m,n shared:file1.txt"),
        "expected a `# cluster` comment line bridging m/n on file1.txt; stdout={out}"
    );
    assert!(
        out.contains("# cluster o shared:"),
        "expected an independent `# cluster o` comment line with no shared files; \
         stdout={out}"
    );
    Ok(())
}

#[test]
fn cluster_output_is_identical_on_warm_cache_hit() -> Result<()> {
    // Regression guard: `pre_fix_corpus`/`post_region_corpus` both go
    // `None` on every warm cache_v2 hit (the fast path `stale` is optimized
    // for), so a clustering implementation that sourced `full_anchor_paths`
    // from either would silently produce empty or wrong clusters on this
    // second run. `--cluster` must load its own dedicated `cluster_corpus`
    // instead, independent of the whole-result cache lifecycle, so the
    // second (warm) run reports byte-identical cluster output.
    let repo = TestRepo::seeded()?;
    seed_cluster_fixture(&repo)?;

    let first = repo.span_stdout(["stale", "--cluster", "--format=json", "--no-exit-code"])?;
    let second = repo.span_stdout(["stale", "--cluster", "--format=json", "--no-exit-code"])?;
    assert_eq!(
        first, second,
        "cluster output must be byte-identical across a cold run and a warm \
         cache_v2 hit against an unchanged repo"
    );

    let v: Value = serde_json::from_str(&second)?;
    let clusters = v["clusters"].as_array().expect("clusters array");
    assert_eq!(
        clusters.len(),
        2,
        "warm-cache run must still report both clusters, not an empty/degraded set: {v}"
    );
    Ok(())
}

/// Fixture for testing comma-escaping in porcelain output: a shared file
/// path with a comma and two spans that both reference it.
fn seed_comma_fixture(repo: &TestRepo) -> Result<()> {
    repo.write_file("file,with,commas.txt", "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n")?;
    repo.commit_all("initial commit with comma file")?;

    repo.span_stdout(["add", "m", "file,with,commas.txt#L1-L5"])?;
    repo.span_stdout(["why", "m", "-m", "span m"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span m commit"])?;

    repo.span_stdout(["add", "n", "file,with,commas.txt#L6-L10"])?;
    repo.span_stdout(["why", "n", "-m", "span n"])?;
    repo.run_git(["add", ".span"])?;
    repo.run_git(["commit", "-m", "span n commit"])?;

    // Mutate the entire file so both spans (L1-L5 and L6-L10) detect drift
    repo.write_file("file,with,commas.txt", "modified1\nmodified2\nmodified3\nmodified4\nmodified5\nmodified6\nmodified7\nmodified8\nmodified9\nmodified10\n")?;
    repo.commit_all("mutate comma file")?;
    Ok(())
}

#[test]
fn porcelain_cluster_escapes_file_paths_with_commas() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_comma_fixture(&repo)?;

    let out = repo.span_stdout(["stale", "--cluster", "--format=porcelain", "--no-exit-code"])?;
    // Verify that the comma-containing file path is escaped (quoted) in the shared: field.
    // Both m and n should be detected as stale and clustered together via their shared file.
    assert!(
        out.contains("# cluster m,n shared:\"file,with,commas.txt\"") ||
        out.contains("# cluster n,m shared:\"file,with,commas.txt\""),
        "expected escaped file path in cluster line with both spans; stdout={out}"
    );
    Ok(())
}
