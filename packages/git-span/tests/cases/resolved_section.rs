//! Durable audit records for operator-resolved duplicate-identity collapses.
//!
//! These acceptance checks were introduced ignored against the Phase 1
//! stubs. Phase 3 removes each ignore as its format, writer, merge, and show
//! batch becomes real.

use crate::support::TestRepo;

use anyhow::Result;
use git_span::span_file::SpanFile;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const SENTINEL: &str = "rk64:ffffffffffffffff";
const ACK: &str = "The resolution is recorded in the span file's `[resolved]` section.";

fn span_path(repo: &TestRepo, name: &str) -> PathBuf {
    repo.path().join(".span").join(name)
}

fn write_span(repo: &TestRepo, name: &str, body: &str) -> Result<()> {
    let path = span_path(repo, name);
    std::fs::create_dir_all(path.parent().expect("span parent"))?;
    std::fs::write(path, body)?;
    Ok(())
}

fn read_span(repo: &TestRepo, name: &str) -> Result<SpanFile> {
    Ok(SpanFile::parse(&std::fs::read_to_string(span_path(repo, name))?)?)
}

fn sentinel_span(address: &str, why: &str) -> String {
    format!("{address} {SENTINEL}\n\n{why}\n")
}

fn run_driver(base: &Path, ours: &Path, theirs: &Path) -> Result<Output> {
    Ok(Command::new(env!("CARGO_BIN_EXE_git-span"))
        .args([
            "merge-driver",
            &base.to_string_lossy(),
            &ours.to_string_lossy(),
            &theirs.to_string_lossy(),
            "7",
        ])
        .output()?)
}

#[test]
fn add_writes_a_current_record_and_acknowledges_it() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &sentinel_span("file1.txt#L1-L5", "why"))?;

    let out = repo.run_span(["add", "audit", "file1.txt#L1-L5"])?;
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains(ACK));

    let span = read_span(&repo, "audit")?;
    assert_eq!(span.resolved.len(), 1);
    let record = &span.resolved[0];
    assert!(git_span_core::is_rfc3339_utc_shape(&record.timestamp));
    assert_eq!(record.command, git_span_core::ResolveCommand::Add);
    assert_eq!(record.identity(), ("file1.txt", 1, 5));
    assert_eq!(record.algorithm, span.anchors[0].algorithm);
    assert_eq!(record.content_hash, span.anchors[0].content_hash);

    Ok(())
}

#[test]
fn replace_records_the_new_identity_and_hash() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &sentinel_span("file1.txt#L1-L5", "why"))?;

    let out = repo.run_span([
        "replace",
        "audit",
        "file1.txt#L1-L5",
        "file1.txt#L6-L10",
    ])?;
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains(ACK));

    let span = read_span(&repo, "audit")?;
    assert_eq!(span.resolved.len(), 1);
    let record = &span.resolved[0];
    assert_eq!(record.command, git_span_core::ResolveCommand::Replace);
    assert_eq!(record.identity(), ("file1.txt", 6, 10));
    assert_eq!(record.content_hash, span.anchors[0].content_hash);
    Ok(())
}

#[test]
fn resolving_the_same_identity_again_overwrites_its_record() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &sentinel_span("file1.txt#L1-L5", "why"))?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;

    let mut span = read_span(&repo, "audit")?;
    span.anchors[0].algorithm = "rk64".into();
    span.anchors[0].content_hash = "ffffffffffffffff".into();
    std::fs::write(span_path(&repo, "audit"), span.serialize())?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;

    let span = read_span(&repo, "audit")?;
    assert_eq!(span.resolved.len(), 1);
    assert_eq!(span.resolved[0].identity(), ("file1.txt", 1, 5));
    Ok(())
}

#[test]
fn later_hash_changes_preserve_the_record_but_make_it_stale() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &sentinel_span("file1.txt#L1-L5", "why"))?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;
    let recorded_hash = read_span(&repo, "audit")?.resolved[0].content_hash.clone();

    repo.write_file(
        "file1.txt",
        "changed1\nchanged2\nchanged3\nchanged4\nchanged5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;

    let span = read_span(&repo, "audit")?;
    assert_eq!(span.resolved.len(), 1);
    assert_eq!(span.resolved[0].content_hash, recorded_hash);
    assert_ne!(span.anchors[0].content_hash, recorded_hash);
    let show = repo.run_span(["show", "audit"])?;
    assert!(String::from_utf8_lossy(&show.stdout).contains("state = \"stale\""));
    Ok(())
}

#[test]
fn show_marks_a_record_stale_when_its_identity_is_gone() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &sentinel_span("file1.txt#L1-L5", "why"))?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;
    let mut span = read_span(&repo, "audit")?;
    span.anchors.clear();
    std::fs::write(span_path(&repo, "audit"), span.serialize())?;

    let show = repo.run_span(["show", "audit"])?;
    assert!(show.status.success());
    assert!(String::from_utf8_lossy(&show.stdout).contains("state = \"stale\""));
    Ok(())
}

#[test]
fn json_ack_shapes_gain_no_resolution_fields() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "add-json", &sentinel_span("file1.txt#L1-L5", "why"))?;
    let add = repo.run_span([
        "add",
        "add-json",
        "file1.txt#L1-L5",
        "--format",
        "json",
    ])?;
    let _add_json: serde_json::Value = serde_json::from_slice(&add.stdout)?;
    let add_text = String::from_utf8_lossy(&add.stdout);
    assert!(add_text.contains("retired_collapsed_duplicates"));
    assert!(!add_text.contains("\"resolved\"") && !add_text.contains("[resolved]"));

    write_span(&repo, "replace-json", &sentinel_span("file1.txt#L1-L5", "why"))?;
    let replace = repo.run_span([
        "replace",
        "replace-json",
        "file1.txt#L1-L5",
        "file1.txt#L6-L10",
        "--format",
        "json",
    ])?;
    let _replace_json: serde_json::Value = serde_json::from_slice(&replace.stdout)?;
    let replace_text = String::from_utf8_lossy(&replace.stdout);
    assert!(replace_text.contains("retired_collapsed_duplicates"));
    assert!(!replace_text.contains("\"resolved\"") && !replace_text.contains("[resolved]"));
    Ok(())
}

#[test]
fn ordinary_writers_and_history_preserve_and_read_the_section() -> Result<()> {
    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &sentinel_span("file1.txt#L1-L5", "why"))?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;
    let record = read_span(&repo, "audit")?.resolved;

    repo.span_stdout(["why", "audit", "updated why"])?;
    assert_eq!(read_span(&repo, "audit")?.resolved, record);
    repo.commit_all("commit resolution record")?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;
    let drift = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    assert!(drift.status.success(), "{}", String::from_utf8_lossy(&drift.stderr));
    assert_eq!(read_span(&repo, "audit")?.resolved, record);
    let history = repo.run_span(["history", "audit"])?;
    assert!(history.status.success(), "{}", String::from_utf8_lossy(&history.stderr));
    Ok(())
}

#[test]
fn merge_driver_unions_a_one_sided_section() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let base = dir.path().join("base");
    let ours = dir.path().join("ours");
    let theirs = dir.path().join("theirs");
    std::fs::write(&base, "a.rs rk64:aaaa\n\nwhy\n")?;
    std::fs::write(
        &ours,
        "a.rs rk64:aaaa\n\nwhy\n[resolved]\n2026-08-13T12:34:56Z add a.rs rk64:aaaa\n",
    )?;
    std::fs::write(&theirs, "a.rs rk64:aaaa\n\nwhy\n")?;

    let out = run_driver(&base, &ours, &theirs)?;
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let merged = SpanFile::parse(&std::fs::read_to_string(ours)?)?;
    assert_eq!(merged.resolved.len(), 1);
    Ok(())
}

#[test]
fn divergent_sections_fail_rehash_and_resolve_with_ours() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let dir = tempfile::tempdir()?;
    let base = dir.path().join("base");
    let ours = dir.path().join("ours");
    let theirs = dir.path().join("theirs");
    std::fs::write(
        &base,
        "file1.txt#L1-L5 rk64:aaaa\n\nwhy\n[resolved]\n2026-08-13T12:00:00Z add file1.txt#L1-L5 rk64:base\n",
    )?;
    std::fs::write(
        &ours,
        "file1.txt#L1-L5 rk64:aaaa\n\nwhy\n[resolved]\n2026-08-13T12:01:00Z add file1.txt#L1-L5 rk64:ours\n",
    )?;
    std::fs::write(
        &theirs,
        "file1.txt#L1-L5 rk64:aaaa\n\nwhy\n[resolved]\n2026-08-13T12:02:00Z replace file1.txt#L1-L5 rk64:theirs\n",
    )?;
    let driver = run_driver(&base, &ours, &theirs)?;
    assert_eq!(driver.status.code(), Some(1));
    let residue = std::fs::read_to_string(&ours)?;
    assert!(residue.contains("<<<<<<<") && residue.contains("[resolved]"), "{residue}");
    write_span(&repo, "audit", &residue)?;

    let before = std::fs::read(span_path(&repo, "audit"))?;
    let rehash = repo.run_span(["resolve", "audit", "--rehash"])?;
    assert_ne!(rehash.status.code(), Some(0));
    assert_eq!(std::fs::read(span_path(&repo, "audit"))?, before);

    let ours_out = repo.run_span(["resolve", "audit", "--ours"])?;
    assert!(ours_out.status.success(), "{}", String::from_utf8_lossy(&ours_out.stderr));
    let settled = read_span(&repo, "audit")?;
    assert_eq!(settled.resolved.len(), 1);
    assert_eq!(settled.resolved[0].content_hash, "ours");
    Ok(())
}

#[test]
fn anchorless_tail_residue_round_trips_from_driver_to_resolve() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let dir = tempfile::tempdir()?;
    let base = dir.path().join("base");
    let ours = dir.path().join("ours");
    let theirs = dir.path().join("theirs");

    for (name, base_why, ours_why, theirs_why, expected_prefix, expected_why) in [
        (
            "conflicted-tail",
            "base why",
            "our why",
            "their why",
            "\n\n<<<<<<<",
            "our why",
        ),
        (
            "plain-prefix",
            "base why",
            "settled why",
            "base why",
            "\n\nsettled why\n\n<<<<<<<",
            "settled why",
        ),
    ] {
        let span = |why: &str, timestamp: &str, hash: &str| {
            format!("\n\n{why}\n\n[resolved]\n{timestamp} add retired.rs rk64:{hash}\n")
        };
        std::fs::write(&base, span(base_why, "2026-08-13T12:00:00Z", "base"))?;
        std::fs::write(&ours, span(ours_why, "2026-08-13T12:01:00Z", "ours"))?;
        std::fs::write(&theirs, span(theirs_why, "2026-08-13T12:02:00Z", "theirs"))?;

        let driver = run_driver(&base, &ours, &theirs)?;
        assert_eq!(
            driver.status.code(),
            Some(1),
            "{name}: stderr={} ",
            String::from_utf8_lossy(&driver.stderr)
        );
        let residue = std::fs::read_to_string(&ours)?;
        assert!(
            residue.starts_with(expected_prefix),
            "{name}: anchorless residue lost its two-newline boundary:\n{residue}"
        );
        write_span(&repo, name, &residue)?;

        let resolved = repo.run_span(["resolve", name, "--ours"])?;
        assert!(
            resolved.status.success(),
            "{name}: stderr={}",
            String::from_utf8_lossy(&resolved.stderr)
        );
        let settled = read_span(&repo, name)?;
        assert!(settled.anchors.is_empty());
        assert_eq!(settled.why, expected_why);
        assert_eq!(settled.resolved.len(), 1);
        assert_eq!(settled.resolved[0].content_hash, "ours");
    }
    Ok(())
}

#[test]
fn one_sided_why_edit_stays_settled_while_records_cross_driver_drift_and_resolve() -> Result<()> {
    let dir = tempfile::tempdir()?;
    let base = dir.path().join("base");
    let ours = dir.path().join("ours");
    let theirs = dir.path().join("theirs");
    std::fs::write(
        &base,
        "file1.txt#L1-L5 rk64:aaaa\n\nbase why\n\n[resolved]\n2026-08-13T12:00:00Z add file1.txt#L1-L5 rk64:base\n",
    )?;
    std::fs::write(
        &ours,
        "file1.txt#L1-L5 rk64:aaaa\n\nsettled why edit\n\n[resolved]\n2026-08-13T12:01:00Z add file1.txt#L1-L5 rk64:ours\n",
    )?;
    std::fs::write(
        &theirs,
        "file1.txt#L1-L5 rk64:aaaa\n\nbase why\n\n[resolved]\n2026-08-13T12:02:00Z replace file1.txt#L1-L5 rk64:theirs\n",
    )?;

    let driver = run_driver(&base, &ours, &theirs)?;
    assert_eq!(driver.status.code(), Some(1));
    let driver_residue = std::fs::read_to_string(&ours)?;
    let marker = driver_residue.find("<<<<<<<").expect("section residue marker");
    assert!(
        driver_residue[..marker].contains("settled why edit"),
        "settled why must stay outside the conflict block:\n{driver_residue}"
    );
    assert_eq!(driver_residue.matches("settled why edit").count(), 1);

    let repo = TestRepo::seeded()?;
    write_span(&repo, "audit", &driver_residue)?;
    let drift = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    assert!(drift.status.success(), "{}", String::from_utf8_lossy(&drift.stderr));
    let drift_text = format!(
        "{}{}",
        String::from_utf8_lossy(&drift.stdout),
        String::from_utf8_lossy(&drift.stderr)
    );
    assert!(drift_text.contains("[resolved]"), "{drift_text}");
    assert!(!drift_text.contains("--why text diverged"), "{drift_text}");

    let resolve = repo.run_span(["resolve", "audit", "--ours"])?;
    assert!(
        resolve.status.success(),
        "{}",
        String::from_utf8_lossy(&resolve.stderr)
    );
    let settled = read_span(&repo, "audit")?;
    assert_eq!(settled.why, "settled why edit");
    assert_eq!(settled.resolved.len(), 1);
    assert_eq!(settled.resolved[0].content_hash, "ours");
    Ok(())
}

#[test]
fn why_write_preserves_an_indented_resolved_marker_as_prose() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.span_stdout(["add", "audit", "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", "audit", "why\n    [resolved]\nstill why"])?;

    let span = read_span(&repo, "audit")?;
    assert!(span.resolved.is_empty());
    assert_eq!(span.why, "why\n    [resolved]\nstill why");
    Ok(())
}

#[test]
fn drift_fix_preserves_divergent_sections_as_residue_then_resolves() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let residue = "file1.txt#L1-L5 rk64:aaaa\n\nwhy\n<<<<<<< ours\n[resolved]\n2026-08-13T12:01:00Z add file1.txt#L1-L5 rk64:ours\n=======\n[resolved]\n2026-08-13T12:02:00Z replace file1.txt#L1-L5 rk64:theirs\n>>>>>>> theirs\n";
    write_span(&repo, "audit", residue)?;

    let fix = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    assert!(fix.status.success(), "{}", String::from_utf8_lossy(&fix.stderr));
    let rewritten = std::fs::read_to_string(span_path(&repo, "audit"))?;
    assert!(
        rewritten.contains("<<<<<<<")
            && rewritten.matches("[resolved]").count() == 2
            && rewritten.contains("rk64:ours")
            && rewritten.contains("rk64:theirs"),
        "{rewritten}"
    );

    let ours = repo.run_span(["resolve", "audit", "--ours"])?;
    assert!(ours.status.success(), "{}", String::from_utf8_lossy(&ours.stderr));
    let settled = read_span(&repo, "audit")?;
    assert_eq!(settled.resolved.len(), 1);
    assert_eq!(settled.resolved[0].content_hash, "ours");
    Ok(())
}
