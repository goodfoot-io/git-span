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
    let renamed = document.spans[0]
        .anchors
        .iter()
        .find(|anchor| {
            anchor
                .current
                .as_ref()
                .is_some_and(|location| location.path == "renamed.txt")
        })
        .unwrap();
    assert_eq!(
        renamed.current.as_ref().unwrap().extent,
        ContextExtent::Lines { start: 5, end: 5 }
    );
    assert_eq!(renamed.status, ContextStatus::Moved);
    Ok(())
}

#[test]
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

#[test]
fn ambiguous_identical_rename_candidates_fail_without_partial_envelope() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("original.txt", "shared content\n")?;
    repo.commit_all("original source")?;
    relation(&repo, "original", &["original.txt"])?;
    repo.commit_all("original declaration")?;
    repo.run_git(["rm", "original.txt"])?;
    repo.write_file("first.txt", "shared content\n")?;
    repo.write_file("second.txt", "shared content\n")?;
    let selected = repo.commit_all("ambiguous duplicate destinations")?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("ambiguous"));
    Ok(())
}

/// Build large actual Git graphs with one fast-import process, not thousands
/// of subprocesses; graph shape and object reads remain native and real.
fn import_chain(repo: &TestRepo, count: usize, merge_all: bool) -> Result<()> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let previous = repo.head_sha()?;
    let mut input = String::from("feature done\n");
    for index in 1..=count {
        let message = format!("imported-{index}");
        input.push_str(&format!("commit refs/heads/main\nmark :{index}\ncommitter Test <test@example.com> 1000000000 +0000\ndata {}\n{message}\n",message.len()));
        let parent = if index == 1 {
            previous.clone()
        } else {
            format!(":{}", index - 1)
        };
        input.push_str(&format!("from {parent}\n"));
        if index == 1 {
            input.push_str("M 100644 inline file1.txt\ndata 8\nchanged\n\n");
        }
        input.push('\n');
    }
    if merge_all {
        input.push_str("commit refs/heads/main\ncommitter Test <test@example.com> 1000000000 +0000\ndata 5\nmerge\nfrom :1\n");
        for index in 2..=count {
            input.push_str(&format!("merge :{index}\n"));
        }
        input.push('\n');
    }
    input.push_str("done\n");
    let mut child = Command::new("git")
        .current_dir(repo.path())
        .args(["fast-import", "--quiet"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .expect("fast-import stdin is piped")
        .write_all(input.as_bytes())?;
    let output = child.wait_with_output()?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    repo.run_git(["reset", "--hard", "main"])?;
    Ok(())
}

#[test]
fn actual_unique_commit_and_parent_comparison_limits_fail_closed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    import_chain(&repo, MAX_COMMIT_CONTEXT_COMPARISONS + 1, true)?;
    let selected = repo.head_sha()?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("comparison limit"));
    let all = repo.git_stdout(["rev-list", "HEAD"])?;
    let ids = all
        .lines()
        .take(MAX_COMMIT_CONTEXT_COMMITS + 1)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let error = query_commit_context(&repo.gix_repo()?, &ids, ".span").unwrap_err();
    assert!(error.to_string().contains("commit limit"), "{error:#}");
    Ok(())
}

#[test]
fn actual_historical_baseline_search_limit_fails_closed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "old-token", &["file1.txt#L3-L3"])?;
    repo.commit_all("record original token")?;
    import_chain(&repo, MAX_COMMIT_CONTEXT_HISTORY_COMMITS + 1, false)?;
    let selected = repo.head_sha()?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("historical baseline search exceeds"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn complete_json_size_limit_fails_without_truncated_spans() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "large-why", &["file1.txt#L3-L3"])?;
    repo.commit_all("small declaration")?;
    repo.write_file("file1.txt", "line1\nline2\nselected\nline4\n")?;
    let selected = repo.commit_all("selected source")?;
    let path = repo.path().join(".span/large-why");
    let mut definition = git_span::span_file::SpanFile::parse(&std::fs::read_to_string(&path)?)?;
    definition.why = "x".repeat(MAX_COMMIT_CONTEXT_JSON_BYTES);
    std::fs::write(path, definition.serialize())?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("JSON limit"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

#[test]
fn final_revalidation_rejects_mutation_after_historical_selection() -> Result<()> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    for commit_mutation in [false, true] {
        let repo = TestRepo::seeded()?;
        relation(&repo, "selected", &["file1.txt#L3-L3"])?;
        repo.commit_all("current declaration")?;
        let selected = repo.head_sha()?;
        let hooks = tempfile::tempdir()?;
        let mut child = Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo.path())
            .args(["commit-context", &selected])
            .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
            .env("GIT_SPAN_CONTEXT_TEST_HOOK_DIR", hooks.path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        for checkpoint in [
            "after-discovery",
            "after-capture",
            "after-render",
            "commit-context-before-validation",
        ] {
            let ready = hooks.path().join(format!("{checkpoint}.ready"));
            let deadline = Instant::now() + Duration::from_secs(120);
            while !ready.exists() {
                if let Some(status) = child.try_wait()? {
                    panic!("query exited before {checkpoint}: {status}");
                }
                ensure!(
                    Instant::now() < deadline,
                    "query did not reach {checkpoint}"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            let token = std::fs::read_to_string(ready)?;
            if checkpoint == "commit-context-before-validation" {
                repo.write_file("file1.txt", "mutated after historical selection\n")?;
                if commit_mutation {
                    repo.commit_all("external commit during query")?;
                }
            }
            std::fs::write(hooks.path().join(format!("{checkpoint}.release")), token)?;
        }
        let output = child.wait_with_output()?;
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("changed while"),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

#[test]
fn required_missing_blob_fails_without_partial_output() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "selected", &["file1.txt#L3-L3"])?;
    repo.commit_all("current definition")?;
    repo.write_file("file1.txt", "line1\nline2\nselected replacement\n")?;
    let selected = repo.commit_all("required blob")?;
    let oid = repo.git_stdout(["rev-parse", "HEAD:file1.txt"])?;
    std::fs::remove_file(
        repo.path()
            .join(".git/objects")
            .join(&oid[..2])
            .join(&oid[2..]),
    )?;
    let output = repo.run_span(["commit-context", &selected])?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(!output.stderr.is_empty());
    Ok(())
}

#[test]
fn independently_selected_counterpart_can_establish_membership_without_other_baseline() -> Result<()>
{
    let repo = TestRepo::seeded()?;
    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("file2.txt", "first\nselected counterpart\nthird\n")?;
    let selected = repo.commit_all("historical counterpart change")?;
    repo.write_file(
        "file1.txt",
        "first\nnever committed transient content\nthird\n",
    )?;
    relation(
        &repo,
        "counterpart-proof",
        &["file1.txt#L2-L2", "file2.txt#L2-L2"],
    )?;
    repo.write_file("file1.txt", &original)?;
    let document = query(&repo, &[&selected])?;
    assert_eq!(names(&document), ["counterpart-proof"]);
    assert_eq!(document.spans[0].anchors.len(), 2);
    Ok(())
}

#[test]
fn absent_path_recovers_unique_shifted_historical_range() -> Result<()> {
    let repo = TestRepo::seeded()?;
    relation(&repo, "shifted-deleted", &["file1.txt#L3-L3"])?;
    repo.commit_all("record original location")?;
    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("file1.txt", &format!("historical prefix\n{original}"))?;
    repo.commit_all("shift without refreshing declaration")?;
    repo.run_git(["rm", "file1.txt"])?;
    let selected = repo.commit_all("delete shifted path")?;
    let document = query(&repo, &[&selected])?;
    assert_eq!(names(&document), ["shifted-deleted"]);
    assert_eq!(document.spans[0].anchors[0].status, ContextStatus::Deleted);
    Ok(())
}

#[test]
fn unique_empty_file_rename_preserves_whole_file_correspondence() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("old-empty", "")?;
    let selected = repo.commit_all("empty file addition")?;
    repo.run_git(["mv", "old-empty", "new-empty"])?;
    repo.commit_all("unique empty file rename")?;
    relation(&repo, "empty-file", &["new-empty"])?;
    repo.commit_all("current whole file relationship")?;
    assert_eq!(names(&query(&repo, &[&selected])?), ["empty-file"]);
    Ok(())
}
