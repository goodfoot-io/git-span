//! Phase-2 acceptance checks for the explicit anchor reconciliation output
//! (card main-207, plan `reconciliation-output.md`).
//!
//! Every check in this file is `#[ignore]`d with a reason naming the plan's
//! test-matrix row it pins. Each one compiles and shows as pending against
//! the Phase-1 contract surface, and encodes the executable contract —
//! exact exit codes, exact wording lines, exact JSON field names — that
//! Phase 3 implements and unskips one at a time. Do not unskip any check
//! before the Phase-3 behavior it pins exists.
//!
//! The wording and JSON pins are copied character-for-character from the
//! plan's Output contract section (modulo fixture span names), so prose and
//! JSON cannot diverge from the three-fact terminology table (plan §Risks:
//! "the three-fact terminology table is asserted verbatim in the Phase-2
//! checks").

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

/// The worktree-effective span declaration on disk, for byte-identity
/// assertions (a failed `add` must never touch it).
fn span_file_bytes(repo: &TestRepo, name: &str) -> Vec<u8> {
    std::fs::read(repo.path().join(".span").join(name))
        .unwrap_or_else(|e| panic!("read .span/{name}: {e}"))
}

// ---------------------------------------------------------------------------
// Matrix row: successful refresh
//
// Exact-address `add` (all `UNCHANGED`) on a clean span → exit 0, local
// lines unchanged, span-wide `0 drift` line printed (the no-op add still
// asserts span-wide state).
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: successful refresh"]
fn reconcile_output_successful_refresh_prints_span_wide_clean() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "add-refresh", "file1.txt#L1-L5"])?;

    // The no-op refresh: identical address, content unchanged → all
    // UNCHANGED. Exit 0 and the existing local-fact lines stay, but the
    // span-wide fact is asserted too.
    let out = repo.run_span(["add", "add-refresh", "file1.txt#L1-L5"])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Added 0 anchors; 1 unchanged to span `add-refresh`."),
        "the existing summary line must be untouched; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("- unchanged: `add-refresh` `file1.txt#L1-L5` (content matches stored hash)"),
        "the per-address unchanged line must be untouched; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Span `add-refresh`: 0 drift across 1 span (1 anchor checked)."),
        "a no-op add must still print the span-wide clean line (plan: \
         `` Span `x`: 0 drift across 1 span (N anchors checked). ``); stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: clean replacement
//
// `add` whole-file over an old same-path line range → superseded line +
// clean verdict + exit 0. Also covers the plan's "whole-file covers range"
// supersession cell through the real `run_add` (the Phase-1 unit table stays
// the source of truth; this check adds the integration-level reading).
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: clean replacement"]
fn reconcile_output_whole_file_add_supersedes_old_line_range() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "clean-replace", "file1.txt#L1-L5"])?;

    let out = repo.run_span(["add", "clean-replace", "file1.txt"])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Added 1 anchor to span `clean-replace`."),
        "local success must print; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("- added: `clean-replace` `file1.txt`"),
        "local success must be worded locally; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(
            "Old anchor superseded by `file1.txt`: `file1.txt#L1-L5` — next: `git span remove clean-replace file1.txt#L1-L5`"
        ),
        "the superseded line must name the covering new address, the old \
         anchor, and the runnable retire command (plan §Output contract); \
         stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Span `clean-replace`: 0 drift across 1 span (2 anchors checked)."),
        "both anchors (the superseded-but-remaining old one and the new \
         whole-file one) are fresh → clean verdict; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("Old anchor remains"),
        "a superseded anchor is reported once, on its superseded line; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: fresh-new/stale-old mixed
//
// Fresh range added while the old whole-file anchor remains changed → exit
// 1, remains line with the canonical address and a `git span remove` next
// action, no clean wording anywhere.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: fresh-new/stale-old mixed"]
fn reconcile_output_fresh_range_with_stale_whole_file_remains() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "mixed", "file1.txt"])?;
    // Drift the whole-file anchor in the working tree; lines 1-3 are
    // untouched so the new range anchor is fresh.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let out = repo.run_span(["add", "mixed", "file1.txt#L1-L3"])?;
    assert_eq!(out.status.code(), Some(1), "actionable drift must exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Added 1 anchor to span `mixed`."),
        "local success must print; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("- added: `mixed` `file1.txt#L1-L3`"),
        "local success must be worded locally; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(
            "Old anchor remains: `file1.txt` (changed in the working tree) — next: `git span remove mixed file1.txt`"
        ),
        "the remains line must carry the canonical address, the resolver \
         status label, and the runnable next action (plan §Output contract); \
         stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Span `mixed`: 1 anchor drifted — `file1.txt`. Run `git span drift mixed` for details."),
        "the span-wide drifted line must list the stale whole-file anchor; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("0 drift") && !stdout.contains("clean"),
        "no clean wording anywhere on a drifted span; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: why-only mutation
//
// `why` write on a span with a stale anchor → exit 1 + remains line
// (fixture case 5). `why` touches no addresses, so the supersession fact is
// empty by construction — no superseded lines.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: why-only mutation"]
fn reconcile_output_why_write_with_stale_anchor_remains() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "why-stale", "file1.txt"])?;
    // Same stale-whole-file shape as the mixed row: drift the anchor, then
    // mutate only the why.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let out = repo.run_span(["why", "why-stale", "updated reason"])?;
    assert_eq!(out.status.code(), Some(1), "actionable drift must exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Set why on span `why-stale`. (idempotent)"),
        "the existing why-written line must stay; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(
            "Old anchor remains: `file1.txt` (changed in the working tree) — next: `git span remove why-stale file1.txt`"
        ),
        "a why-only mutation must end with the stale anchor's address and \
         next action, not completion (fixture case 5); stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Span `why-stale`: 1 anchor drifted — `file1.txt`. Run `git span drift why-stale` for details."),
        "the span-wide drifted line must print; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("superseded"),
        "why touches no addresses — the supersession fact is empty by \
         construction; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: clean JSON
//
// `add --format json` and `why --format json` on clean spans emit the
// mutation document (schema_version 1) with a clean verdict and empty
// remaining/superseded arrays; `git span drift --format json` on a clean
// scan always emits the schema-3 clean document — never empty stdout.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: clean JSON add"]
fn reconcile_output_add_json_clean_document() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["add", "json-clean", "file1.txt#L1-L5", "--format", "json"])?;
    assert_eq!(out.status.code(), Some(0));
    let v: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| anyhow::anyhow!("stdout is not the mutation document: {e}\n{}", String::from_utf8_lossy(&out.stdout)))?;
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["command"], "add");
    assert_eq!(v["span"], "json-clean");
    assert_eq!(v["addresses"][0]["address"], "file1.txt#L1-L5");
    assert_eq!(v["addresses"][0]["outcome"], "ADDED");
    assert!(
        v["superseded"].as_array().is_some_and(|a| a.is_empty()),
        "clean add must emit an empty superseded array: {v}"
    );
    assert!(
        v["remaining"].as_array().is_some_and(|a| a.is_empty()),
        "clean add must emit an empty remaining array: {v}"
    );
    assert_eq!(v["span_health"]["state"], "DRIFT_FREE");
    assert_eq!(v["span_health"]["drift_count"], 0);
    assert!(
        v["span_health"]["drifting"].as_array().is_some_and(|a| a.is_empty()),
        "clean add must emit an empty drifting array: {v}"
    );
    assert_eq!(v["span_health"]["resolved_pending_commit_count"], 0);
    Ok(())
}

#[test]
#[ignore = "reconcile-output: clean JSON why"]
fn reconcile_output_why_json_clean_document() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "json-why", "file1.txt#L1-L5"])?;

    let out = repo.run_span(["why", "json-why", "updated reason", "--format", "json"])?;
    assert_eq!(out.status.code(), Some(0));
    let v: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| anyhow::anyhow!("stdout is not the mutation document: {e}\n{}", String::from_utf8_lossy(&out.stdout)))?;
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["command"], "why");
    assert_eq!(v["why_written"], true);
    assert!(
        v["addresses"].as_array().is_some_and(|a| a.is_empty()),
        "why touches no addresses: {v}"
    );
    assert!(
        v["superseded"].as_array().is_some_and(|a| a.is_empty()),
        "the why document still emits the empty superseded array for a \
         stable key set (plan §Output contract): {v}"
    );
    assert!(
        v["remaining"].as_array().is_some_and(|a| a.is_empty()),
        "clean why must emit an empty remaining array: {v}"
    );
    assert_eq!(v["span_health"]["state"], "DRIFT_FREE");
    Ok(())
}

#[test]
#[ignore = "reconcile-output: clean JSON drift scan"]
fn reconcile_output_drift_json_clean_scan_always_emits() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "json-drift", "file1.txt#L1-L5"])?;

    let out = repo.run_span(["drift", "--format", "json"])?;
    assert_eq!(out.status.code(), Some(0));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !stdout.trim().is_empty(),
        "a clean scan must never produce empty stdout (plan: hooks must \
         distinguish 'clean' from 'no output')"
    );
    let v: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(v["schema_version"], 3);
    assert_eq!(v["clean"], true);
    assert!(
        v["findings"].as_array().is_some_and(|a| a.is_empty()),
        "a clean scan must emit an empty findings array: {v}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: failure/no-write
//
// Invalid address, gitignored path, missing file → error before any write,
// span file byte-identical, exit 1 (existing fail-closed paths, asserted
// explicitly so Phase 3 cannot regress them).
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: failure invalid address no write"]
fn reconcile_output_invalid_address_fails_before_write() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "no-write", "file1.txt#L1-L5"])?;
    let before = span_file_bytes(&repo, "no-write");

    // End-before-start range is an unparseable address.
    let out = repo.run_span(["add", "no-write", "file1.txt#L5-L1"])?;
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        span_file_bytes(&repo, "no-write"),
        before,
        "an invalid address must fail before any span-file write"
    );
    Ok(())
}

#[test]
#[ignore = "reconcile-output: failure gitignored path no write"]
fn reconcile_output_gitignored_path_fails_before_write() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "no-write", "file1.txt#L1-L5"])?;
    let before = span_file_bytes(&repo, "no-write");

    // A generated artifact: present on disk, but gitignored — the resolver
    // can never see it, so `add` rejects it at the precheck.
    repo.write_file(".gitignore", "generated.ts\n")?;
    repo.write_file("generated.ts", "let x = 1;\n")?;
    repo.commit_all("ignore generated.ts")?;

    let out = repo.run_span(["add", "no-write", "generated.ts"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("gitignored"),
        "the reject message must name the gitignore cause; stderr:\n{stderr}"
    );
    assert_eq!(
        span_file_bytes(&repo, "no-write"),
        before,
        "a gitignored path must fail before any span-file write"
    );
    Ok(())
}

#[test]
#[ignore = "reconcile-output: failure missing file no write"]
fn reconcile_output_missing_file_fails_before_write() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "no-write", "file1.txt#L1-L5"])?;
    let before = span_file_bytes(&repo, "no-write");

    let out = repo.run_span(["add", "no-write", "nonexistent.txt"])?;
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("does not exist"),
        "the reject message must name the missing path; stderr:\n{stderr}"
    );
    assert_eq!(
        span_file_bytes(&repo, "no-write"),
        before,
        "a missing file must fail before any span-file write"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: `--at` drifted new anchor
//
// The new anchor is itself actionable drift (hashed against HEAD while the
// worktree diverges) → exit 1, the span-wide line lists it, local success
// still worded locally. A touched anchor is not a remains line — the
// span-wide fact carries it.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: --at drifted new anchor"]
fn reconcile_output_at_drifted_new_anchor_lists_in_span_wide() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Worktree diverges from HEAD, so the new anchor hashed against HEAD is
    // itself actionable drift for the post-write check.
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    let out = repo.run_span(["add", "at-drift", "file1.txt", "--at", "HEAD"])?;
    assert_eq!(out.status.code(), Some(1), "the drifted new anchor must exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Added 1 anchor to span `at-drift`."),
        "local success must still be worded locally; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("- added: `at-drift` `file1.txt`"),
        "local success must still be worded locally; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Span `at-drift`: 1 anchor drifted — `file1.txt`. Run `git span drift at-drift` for details."),
        "the span-wide line must list the drifted *new* anchor (plan: lists \
         every actionable-drift anchor, touched or not); stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("Old anchor remains"),
        "the new anchor was touched by this invocation — its fate is the \
         span-wide fact, not a remains line; stdout:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: check error
//
// The post-write resolver check itself errors → local facts printed, the
// `state unverified` line, JSON `UNKNOWN` + reason (no `indeterminate` flag
// — this is the fatal path, exit 1, never the retryable 2). The fixture
// mirrors `head_read_failures.rs`: a truncated tree object under the
// anchored path makes every HEAD read error.
// ---------------------------------------------------------------------------

/// Repo whose anchored file's HEAD tree object is truncated in place, so any
/// resolver read under the path errors. `gc.auto 0` keeps the tree a loose
/// object (a packed tree cannot be truncated individually).
fn corrupted_tree_repo() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.run_git(["config", "gc.auto", "0"])?;

    repo.write_file("sub/whole.txt", "whole body\nsecond line\n")?;
    repo.commit_all("seed anchored file")?;
    repo.span_stdout(["add", "check-error", "sub/whole.txt"])?;
    repo.span_stdout(["why", "check-error", "seed"])?;

    // Remove the worktree copy so resolution must read the anchored content
    // back out of HEAD instead of the (deleted) file.
    std::fs::remove_file(repo.path().join("sub/whole.txt"))?;

    // Truncate `sub/`'s tree object in place. Every path lookup under
    // `sub/` now fails at the object store — the unreadable-not-absent
    // boundary that makes the resolver error rather than classify.
    let tree_oid = repo.git_stdout(["rev-parse", "HEAD:sub"])?;
    let tree_oid = tree_oid.trim();
    let tree_path = repo
        .path()
        .join(".git")
        .join("objects")
        .join(&tree_oid[..2])
        .join(&tree_oid[2..]);
    assert!(
        tree_path.exists(),
        "tree {tree_oid} should be a loose object at {tree_path:?}"
    );
    // Loose objects are written read-only; lift that before truncating.
    support::make_writable(&tree_path)?;
    std::fs::write(&tree_path, b"garbage")?;

    Ok(repo)
}

#[test]
#[ignore = "reconcile-output: check error unverified"]
fn reconcile_output_check_error_unverified_exit_1() -> Result<()> {
    let repo = corrupted_tree_repo()?;

    let out = repo.run_span(["why", "check-error", "updated reason"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "a resolver hard error is a fatal Err → exit 1 (plan §Exit codes), \
         never the retryable 2"
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Set why on span `check-error`. (idempotent)"),
        "local facts must still print; stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("Span `check-error`: state unverified ("),
        "the unverified line must print with the reason in parens (plan: \
         `` Span `x`: state unverified (<reason>) — run `git span drift x`. ``); \
         stdout:\n{stdout}"
    );
    assert!(
        stdout.contains(") — run `git span drift check-error`."),
        "the unverified line must end with the runnable next action; stdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("0 drift") && !stdout.contains("clean"),
        "the unverified line never claims clean (plan §Output contract); stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
#[ignore = "reconcile-output: check error JSON unknown"]
fn reconcile_output_check_error_json_unknown_no_indeterminate() -> Result<()> {
    let repo = corrupted_tree_repo()?;

    let out = repo.run_span(["why", "check-error", "updated reason", "--format", "json"])?;
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8_lossy(&out.stdout);
    let v: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| anyhow::anyhow!("stdout is not the mutation document: {e}\n{text}"))?;
    assert_eq!(v["command"], "why");
    assert_eq!(
        v["span_health"]["state"],
        "UNKNOWN",
        "a check error must render UNKNOWN, not DRIFT or DRIFT_FREE: {v}"
    );
    assert!(
        v["span_health"]["reason"].is_string(),
        "UNKNOWN must carry the check-error detail in `reason` (plan §Output \
         contract); document: {v}"
    );
    assert!(
        !text.contains("indeterminate"),
        "the check-error path sets no indeterminate flag — exit 1, not the \
         retryable 2; document:\n{text}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Matrix row: why read-mode rejection
//
// `why <span> --format json` in read mode → usage-style `CliError` before
// any output, exit 1, no stdout (drift's `--fix`-with-machine-format
// rejection is the precedent). The read mode's prose is untouched.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "reconcile-output: why read-mode rejection"]
fn reconcile_output_why_read_mode_rejects_json_format() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["why", "read-reject", "some reason"])?;

    // No why text and non-terminal stdin → read mode. The `--format` flag
    // applies to the write mode only; read mode must reject it fail-closed
    // rather than silently print prose (a migrating hook would parse prose
    // as a document).
    let out = repo.run_span(["why", "read-reject", "--format", "json"])?;
    assert_eq!(out.status.code(), Some(1));
    assert!(
        out.stdout.is_empty(),
        "the rejection must come before any output; stdout={}",
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("--format"),
        "a usage-style rejection must name the rejected flag; stderr:\n{stderr}"
    );
    Ok(())
}
