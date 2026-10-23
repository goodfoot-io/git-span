//! Consumer contract for complete commit-selected current relationship context.

use crate::support::TestRepo;
use anyhow::{Result, ensure};
use git_span::cli::commit_context::{
    COMMIT_CONTEXT_SCHEMA_VERSION, CommitContextDocument, MAX_COMMIT_CONTEXT_BLOB_BYTES,
    MAX_COMMIT_CONTEXT_COMMITS, MAX_COMMIT_CONTEXT_COMPARISONS, MAX_COMMIT_CONTEXT_HISTORY_COMMITS,
    MAX_COMMIT_CONTEXT_HUNKS, MAX_COMMIT_CONTEXT_JSON_BYTES, query_commit_context,
};
use git_span::cli::context::{ContextExtent, ContextStatus};

fn relation(repo: &TestRepo, name: &str, addresses: &[&str]) -> Result<()> {
    let mut args = vec!["add", name];
    args.extend_from_slice(addresses);
    repo.span_stdout(args)?;
    repo.span_stdout([
        "why",
        name,
        "Both anchors describe the same current contract.",
    ])?;
    Ok(())
}

fn query(repo: &TestRepo, commits: &[&str]) -> Result<CommitContextDocument> {
    let mut args = vec!["commit-context"];
    args.extend_from_slice(commits);
    let output = repo.run_span(args)?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let document: CommitContextDocument = serde_json::from_slice(&output.stdout)?;
    assert_eq!(document.schema_version, COMMIT_CONTEXT_SCHEMA_VERSION);
    assert!(document.spans.iter().all(|span| span.overlaps.is_empty()));
    Ok(document)
}

fn names(document: &CommitContextDocument) -> Vec<&str> {
    document
        .spans
        .iter()
        .map(|span| span.name.as_str())
        .collect()
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn complete_current_counterparts_and_statuses_are_not_historical_labels() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "selected", &["file1.txt#L2-L3", "file2.txt#L2-L3"])?;
    relation(&repo, "unrelated", &["file1.txt#L8-L9"])?;
    repo.commit_all("relationships")?;
    repo.write_file(
        "file1.txt",
        "line1\nCHANGED\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let selected = repo.commit_all("change selected source")?;
    repo.write_file("file2.txt", "line1\nDRIFTED\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\n")?;
    let before = std::fs::read(repo.path().join(".span/selected"))?;
    let document = query(&repo, &[&selected, &selected])?;
    assert_eq!(document.commits, vec![selected]);
    assert_eq!(names(&document), ["selected"]);
    assert_eq!(document.spans[0].anchors.len(), 2);
    assert!(
        document.spans[0]
            .why
            .as_deref()
            .unwrap()
            .contains("current contract")
    );
    assert_eq!(document.spans[0].anchors[1].status, ContextStatus::Changed);
    assert_eq!(std::fs::read(repo.path().join(".span/selected"))?, before);
    assert_eq!(query(&repo, &[&document.commits[0]])?, document);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn rename_and_committed_shift_use_head_coordinates_despite_live_shift() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file(
        "file1.txt",
        "line1\nline2\nSELECTED\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let selected = repo.commit_all("historical change")?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    let body = std::fs::read_to_string(repo.path().join("renamed.txt"))?;
    repo.write_file("renamed.txt", &format!("committed prefix\n{body}"))?;
    repo.commit_all("rename and prefix")?;
    relation(&repo, "mapped", &["renamed.txt#L4-L4", "file2.txt#L2-L3"])?;
    relation(&repo, "adjacent", &["renamed.txt#L5-L5"])?;
    repo.commit_all("current definitions")?;
    repo.write_file(
        "renamed.txt",
        &format!("live prefix\ncommitted prefix\n{body}"),
    )?;
    let document = query(&repo, &[&selected])?;
    assert_eq!(names(&document), ["mapped"]);
    assert_eq!(
        document.spans[0].anchors[0]
            .current
            .as_ref()
            .unwrap()
            .extent,
        ContextExtent::Lines { start: 5, end: 5 }
    );
    assert_eq!(document.spans[0].anchors[0].status, ContextStatus::Moved);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn intermediate_change_and_revert_select_one_new_current_relationship() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file(
        "file1.txt",
        &original.replace("line3", "temporarily changed"),
    )?;
    let changed = repo.commit_all("intermediate edit")?;
    repo.write_file("file1.txt", &original)?;
    let reverted = repo.commit_all("revert edit")?;
    relation(&repo, "created-later", &["file1.txt#L3-L3"])?;
    repo.commit_all("declare current relation")?;
    let document = query(&repo, &[&changed, &reverted, &changed])?;
    assert_eq!(document.commits.len(), 2);
    assert_eq!(names(&document), ["created-later"]);
    assert_eq!(document.spans[0].anchors[0].status, ContextStatus::Fresh);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn deleted_line_selects_recorded_anchor_without_selecting_adjacent_survivor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "removed-line", &["file1.txt#L3-L3"])?;
    relation(&repo, "survivor", &["file1.txt#L4-L4"])?;
    repo.commit_all("relations before deletion")?;
    repo.write_file(
        "file1.txt",
        "line1\nline2\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let deletion = repo.commit_all("remove entire anchored range")?;
    let document = query(&repo, &[&deletion])?;
    assert_eq!(names(&document), ["removed-line"]);
    assert_eq!(document.spans[0].anchors[0].status, ContextStatus::Changed);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn deleted_head_path_recovers_verified_baseline_and_preserves_deleted_status() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "deleted", &["file1.txt#L2-L3", "file2.txt#L2-L3"])?;
    repo.commit_all("relationship before path removal")?;
    repo.run_git(["rm", "file1.txt"])?;
    let deletion = repo.commit_all("delete entire source path")?;
    let document = query(&repo, &[&deletion])?;
    assert_eq!(names(&document), ["deleted"]);
    assert_eq!(document.spans[0].anchors[0].status, ContextStatus::Deleted);
    assert!(document.spans[0].anchors[0].current.is_none());
    assert_eq!(document.spans[0].anchors.len(), 2);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn root_changes_and_every_merge_parent_contribute() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let root = repo.head_sha()?;
    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file("file2.txt", "side changed\nline2\nline3\n")?;
    repo.commit_all("side source")?;
    repo.run_git(["checkout", "main"])?;
    repo.write_file("file1.txt", "main changed\nline2\nline3\n")?;
    repo.commit_all("main source")?;
    repo.run_git(["merge", "--no-ff", "side", "-m", "merge both sources"])?;
    let merge = repo.head_sha()?;
    relation(&repo, "main-source", &["file1.txt#L1-L1"])?;
    relation(&repo, "side-source", &["file2.txt#L1-L1"])?;
    repo.commit_all("current relationships")?;
    assert_eq!(
        names(&query(&repo, &[&merge])?),
        ["main-source", "side-source"]
    );
    assert_eq!(
        names(&query(&repo, &[&root])?),
        ["main-source", "side-source"]
    );
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn arbitrary_side_revision_uses_tree_correspondence() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "branch-correspondence", &["file1.txt#L3-L3"])?;
    repo.commit_all("current declaration")?;
    repo.run_git(["checkout", "-b", "side"])?;
    let body = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("file1.txt", &body.replace("line3", "side replacement"))?;
    let selected = repo.commit_all("unmerged side edit")?;
    repo.run_git(["checkout", "main"])?;
    assert_eq!(
        names(&query(&repo, &[&selected])?),
        ["branch-correspondence"]
    );
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn pure_rename_and_binary_whole_file_changes_have_structural_overlap() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file_bytes("binary.dat", b"\0initial binary")?;
    repo.commit_all("binary source")?;
    relation(&repo, "binary", &["binary.dat"])?;
    relation(&repo, "renamed", &["file1.txt#L2-L3"])?;
    repo.commit_all("current definitions")?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    repo.write_file_bytes("binary.dat", b"\0changed binary")?;
    let selected = repo.commit_all("rename and binary edit")?;
    assert_eq!(names(&query(&repo, &[&selected])?), ["binary", "renamed"]);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn empty_overlap_returns_complete_empty_envelope() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "other-file", &["file2.txt#L2-L3"])?;
    repo.commit_all("current definition")?;
    repo.write_file("file1.txt", "changed unrelated file\n")?;
    let selected = repo.commit_all("unrelated source")?;
    let document = query(&repo, &[&selected])?;
    assert_eq!(document.commits, [selected]);
    assert!(document.spans.is_empty());
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn invalid_or_missing_commit_fails_before_any_envelope_is_written() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let valid = repo.head_sha()?;
    for invalid in ["HEAD", &valid[..10], "not-a-commit", &"f".repeat(40)] {
        let output = repo.run_span(["commit-context", &valid, invalid])?;
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
    let repository = repo.gix_repo()?;
    assert!(query_commit_context(&repository, &[], ".span").is_err());
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn corrupt_definition_rejects_complete_report() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "good", &["file1.txt#L2-L3"])?;
    repo.commit_all("good current definition")?;
    let selected = repo.head_sha()?;
    repo.write_file(".span/broken", "this is not a valid anchor\n\nwhy\n")?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn resource_contract_is_explicit_and_oversized_blob_fails_closed() -> Result<()> {
    assert_eq!(MAX_COMMIT_CONTEXT_COMMITS, 4096);
    assert_eq!(MAX_COMMIT_CONTEXT_COMPARISONS, 8192);
    assert_eq!(MAX_COMMIT_CONTEXT_HISTORY_COMMITS, 4096);
    assert_eq!(MAX_COMMIT_CONTEXT_HUNKS, 65536);
    assert_eq!(MAX_COMMIT_CONTEXT_JSON_BYTES, 16 * 1024 * 1024);
    let repo = TestRepo::seeded()?;
    relation(&repo, "bounded", &["file1.txt"])?;
    repo.commit_all("whole file declaration")?;
    repo.write_file("file1.txt", &"x".repeat(MAX_COMMIT_CONTEXT_BLOB_BYTES + 1))?;
    let selected = repo.commit_all("oversized source")?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("limit"));
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn insertion_boundary_excludes_untouched_neighbor() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file(
        "file1.txt",
        "line1\ninserted\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    let selected = repo.commit_all("insert between two existing lines")?;
    relation(&repo, "inserted", &["file1.txt#L2-L2"])?;
    relation(&repo, "neighbor", &["file1.txt#L3-L3"])?;
    repo.commit_all("current definitions")?;
    assert_eq!(names(&query(&repo, &[&selected])?), ["inserted"]);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn entire_replacement_region_correspondence_is_intentional() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let body = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("file1.txt", &body.replace("line5", "historical edit"))?;
    let selected = repo.commit_all("edit middle of historical region")?;
    repo.write_file("file1.txt", "one replacement line\n")?;
    repo.commit_all("replace whole region")?;
    relation(&repo, "replacement", &["file1.txt#L1-L1"])?;
    repo.commit_all("current declaration")?;
    assert_eq!(names(&query(&repo, &[&selected])?), ["replacement"]);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn delete_recreate_identical_endpoints_keep_tree_correspondence() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let body = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file(
        "file1.txt",
        &body.replace("line3", "selected historical edit"),
    )?;
    let selected = repo.commit_all("selected edit")?;
    relation(&repo, "recreated", &["file1.txt#L3-L3"])?;
    repo.commit_all("current declaration")?;
    let before = query(&repo, &[&selected])?;
    let source = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.run_git(["rm", "file1.txt"])?;
    repo.commit_all("delete source")?;
    repo.write_file("file1.txt", &source)?;
    repo.commit_all("recreate identical source")?;
    let after = query(&repo, &[&selected])?;
    assert_eq!(names(&before), ["recreated"]);
    assert_eq!(names(&after), ["recreated"]);
    Ok(())
}

#[test]
#[ignore = "commit-context contract bootstrap"]
fn repository_hash_format_preserves_full_sha256_commit_ids() -> Result<()> {
    let repo = TestRepo {
        dir: tempfile::tempdir()?,
    };
    repo.run_git(["init", "--object-format=sha256", "--initial-branch=main"])?;
    repo.run_git(["config", "user.name", "Test User"])?;
    repo.run_git(["config", "user.email", "test@example.com"])?;
    repo.run_git(["config", "commit.gpgsign", "false"])?;
    repo.write_file("source.txt", "first\nsecond\n")?;
    repo.commit_all("initial source")?;
    relation(&repo, "sha256", &["source.txt#L2-L2"])?;
    repo.commit_all("current definition")?;
    repo.write_file("source.txt", "first\nchanged\n")?;
    let selected = repo.commit_all("selected source")?;
    assert_eq!(selected.len(), 64);
    let document = query(&repo, &[&selected])?;
    assert_eq!(document.commits, [selected]);
    assert_eq!(names(&document), ["sha256"]);
    Ok(())
}
