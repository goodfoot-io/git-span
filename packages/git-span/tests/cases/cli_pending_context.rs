//! Real Git acceptance fixtures for pending comparison membership.
use crate::support::TestRepo;
use anyhow::{Result, ensure};
use git_span::cli::context::ContextDocument;

fn fixture() -> Result<TestRepo> {
    let repo = TestRepo::seeded()?;
    for args in [
        vec!["add", "selected", "file1.txt#L2-L3", "file2.txt#L2-L3"],
        vec!["add", "elsewhere", "file1.txt#L8-L9"],
        vec![
            "why",
            "selected",
            "Both source ranges follow the same contract.",
        ],
    ] {
        let out = repo.run_span(args)?;
        ensure!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    repo.commit_all("record spans")?;
    Ok(repo)
}

fn change(repo: &TestRepo, path: &str, line: usize, value: &str) -> Result<()> {
    let text = std::fs::read_to_string(repo.path().join(path))?;
    let mut lines: Vec<_> = text.lines().map(str::to_owned).collect();
    lines[line - 1] = value.into();
    repo.write_file(path, &(lines.join("\n") + "\n"))
}

fn query(repo: &TestRepo, kind: &str, args: &[&str]) -> Result<ContextDocument> {
    let mut argv = vec!["pending-context", kind, "--"];
    argv.extend_from_slice(args);
    let out = repo.run_span(argv)?;
    ensure!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let doc: ContextDocument = serde_json::from_slice(&out.stdout)?;
    assert_eq!(doc.schema_version, 2);
    assert!(doc.scopes.is_empty());
    assert!(!doc.mutation.requested && !doc.mutation.rewritten);
    assert!(doc.spans.iter().all(|span| span.overlaps.is_empty()));
    Ok(doc)
}

fn names(doc: &ContextDocument) -> Vec<&str> {
    doc.spans.iter().map(|span| span.name.as_str()).collect()
}

#[test]
#[ignore = "pending-context bootstrap"]
fn unstaged_ranges_keep_complete_counterparts_and_current_why() -> Result<()> {
    let repo = fixture()?;
    change(&repo, "file1.txt", 2, "changed selected content")?;
    let doc = query(&repo, "diff", &["--", "file1.txt"])?;
    assert_eq!(names(&doc), ["selected"]);
    assert_eq!(doc.spans[0].anchors.len(), 2);
    assert_eq!(
        doc.spans[0].why.as_deref(),
        Some("Both source ranges follow the same contract.")
    );
    assert!(
        doc.spans[0]
            .anchors
            .iter()
            .any(|a| a.status == git_span::cli::context::ContextStatus::Changed)
    );
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn opposing_layers_remain_selected_by_status_but_net_head_is_clean() -> Result<()> {
    let repo = fixture()?;
    change(&repo, "file1.txt", 2, "staged replacement")?;
    repo.run_git(["add", "file1.txt"])?;
    change(&repo, "file1.txt", 2, "line2")?;
    for args in [&[][..], &["--short"][..], &["--porcelain=v2"][..]] {
        assert_eq!(names(&query(&repo, "status", args)?), ["selected"]);
    }
    assert_eq!(names(&query(&repo, "diff", &["--cached"])?), ["selected"]);
    assert_eq!(names(&query(&repo, "diff", &[])?), ["selected"]);
    assert!(query(&repo, "diff", &["HEAD"])?.spans.is_empty());
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn staged_aliases_and_presentation_do_not_change_membership() -> Result<()> {
    let repo = fixture()?;
    change(&repo, "file1.txt", 2, "staged replacement")?;
    repo.run_git(["add", "file1.txt"])?;
    change(&repo, "file1.txt", 8, "unstaged elsewhere")?;
    for args in [
        vec!["--cached"],
        vec!["--staged", "--name-only"],
        vec!["--staged", "--name-status"],
        vec!["--staged", "--stat"],
        vec!["--staged", "--quiet"],
        vec!["--staged", "--exit-code"],
        vec!["--staged", "-U100"],
        vec!["--staged", "--unified=0"],
    ] {
        assert_eq!(names(&query(&repo, "diff", &args)?), ["selected"]);
    }
    assert_eq!(names(&query(&repo, "diff", &[])?), ["elsewhere"]);
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn pathspecs_multiple_ranges_and_diff_filter_narrow_selection() -> Result<()> {
    let repo = fixture()?;
    change(&repo, "file1.txt", 2, "selected")?;
    change(&repo, "file1.txt", 8, "elsewhere")?;
    change(&repo, "file2.txt", 2, "counterpart")?;
    assert_eq!(
        names(&query(&repo, "diff", &["--", "file1.txt"])?),
        ["elsewhere", "selected"]
    );
    assert_eq!(
        names(&query(&repo, "diff", &["--", ":(glob)*2.txt"])?),
        ["selected"]
    );
    assert_eq!(
        names(&query(&repo, "status", &["--", "file2.txt"])?),
        ["selected"]
    );
    assert!(query(&repo, "diff", &["--diff-filter=D"])?.spans.is_empty());
    assert_eq!(
        names(&query(
            &repo,
            "diff",
            &["--diff-filter=M", "--", "file2.txt"]
        )?),
        ["selected"]
    );
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn staged_coordinates_survive_unstaged_insertions_before_anchors() -> Result<()> {
    let repo = fixture()?;
    change(&repo, "file1.txt", 8, "staged elsewhere")?;
    repo.run_git(["add", "file1.txt"])?;
    let text = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("file1.txt", &("inserted\n".repeat(20) + &text))?;
    assert_eq!(names(&query(&repo, "diff", &["--staged"])?), ["elsewhere"]);
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn whole_file_deletion_and_pure_rename_select_affected_identity() -> Result<()> {
    let repo = fixture()?;
    ensure!(
        repo.run_span(["add", "whole", "file1.txt"])?
            .status
            .success(),
        "whole anchor"
    );
    repo.commit_all("whole-file span")?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    assert_eq!(
        names(&query(&repo, "diff", &["--cached"])?),
        ["elsewhere", "selected", "whole"]
    );
    repo.run_git(["reset", "--hard", "HEAD"])?;
    std::fs::remove_file(repo.path().join("file1.txt"))?;
    assert_eq!(
        names(&query(&repo, "diff", &[])?),
        ["elsewhere", "selected", "whole"]
    );
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn untracked_status_respects_visibility_and_diff_excludes_it() -> Result<()> {
    let repo = fixture()?;
    repo.write_file("new.txt", "new source\n")?;
    ensure!(
        repo.run_span(["add", "new-source", "new.txt"])?
            .status
            .success(),
        "untracked anchor"
    );
    assert_eq!(
        names(&query(&repo, "status", &["--", "new.txt"])?),
        ["new-source"]
    );
    assert!(
        query(&repo, "status", &["--untracked-files=no", "--", "new.txt"])?
            .spans
            .is_empty()
    );
    assert!(query(&repo, "diff", &["--", "new.txt"])?.spans.is_empty());
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn unsupported_comparisons_unborn_and_invalid_pathspec_fail_explicitly() -> Result<()> {
    let repo = fixture()?;
    for args in [
        vec!["HEAD~1"],
        vec!["--no-index", "a", "b"],
        vec!["-R"],
        vec!["-w"],
        vec!["--merge-base", "HEAD"],
        vec!["--", ":(unknown)file1.txt"],
    ] {
        let mut argv = vec!["pending-context", "diff", "--"];
        argv.extend(args);
        let out = repo.run_span(argv)?;
        assert!(!out.status.success());
        assert!(out.stdout.is_empty());
        assert!(!out.stderr.is_empty());
    }
    let unborn = TestRepo::new()?;
    let out = unborn.run_span(["pending-context", "status"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("HEAD"));
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn clean_and_nonoverlapping_selection_are_empty_and_read_only() -> Result<()> {
    let repo = fixture()?;
    let before = std::fs::read(repo.path().join(".git/index"))?;
    assert!(query(&repo, "status", &[])?.spans.is_empty());
    change(&repo, "file1.txt", 5, "outside all ranges")?;
    assert!(query(&repo, "diff", &[])?.spans.is_empty());
    assert_eq!(before, std::fs::read(repo.path().join(".git/index"))?);
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn conflicts_select_paths_and_show_current_conflict_status() -> Result<()> {
    let repo = fixture()?;
    repo.run_git(["checkout", "-b", "other"])?;
    change(&repo, "file1.txt", 2, "other change")?;
    repo.commit_all("other")?;
    repo.run_git(["checkout", "main"])?;
    change(&repo, "file1.txt", 2, "main change")?;
    repo.commit_all("main")?;
    let merge = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "other"])
        .output()?;
    assert!(!merge.status.success());
    let doc = query(&repo, "status", &[])?;
    assert_eq!(names(&doc), ["elsewhere", "selected"]);
    assert!(
        doc.spans
            .iter()
            .flat_map(|s| &s.anchors)
            .any(|a| a.status == git_span::cli::context::ContextStatus::Conflict)
    );
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn subdirectory_pathspec_and_ignored_status_are_git_relative() -> Result<()> {
    let repo = fixture()?;
    repo.write_file("nested/input.txt", "nested input\n")?;
    ensure!(
        repo.run_span(["add", "nested", "nested/input.txt"])?
            .status
            .success(),
        "nested span"
    );
    repo.commit_all("nested source")?;
    repo.write_file("nested/input.txt", "changed nested input\n")?;
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path().join("nested"))
        .args(["pending-context", "diff", "--", "--", "input.txt"])
        .output()?;
    ensure!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let doc: ContextDocument = serde_json::from_slice(&out.stdout)?;
    assert_eq!(names(&doc), ["nested"]);
    repo.write_file("ignored.txt", "ignored source\n")?;
    ensure!(
        repo.run_span(["add", "ignored", "ignored.txt"])?
            .status
            .success(),
        "source before ignore"
    );
    repo.write_file(".gitignore", "ignored.txt\n")?;
    assert!(
        query(&repo, "status", &["--", "ignored.txt"])?
            .spans
            .is_empty()
    );
    assert_eq!(
        names(&query(
            &repo,
            "status",
            &["--ignored", "--", "ignored.txt"]
        )?),
        ["ignored"]
    );
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn collection_race_refuses_mixed_snapshot() -> Result<()> {
    use std::time::{Duration, Instant};
    let repo = fixture()?;
    change(&repo, "file1.txt", 2, "selected change")?;
    let hooks = tempfile::tempdir()?;
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.path())
        .env("GIT_SPAN_CONTEXT_TEST_HOOK_DIR", hooks.path())
        .args(["pending-context", "diff"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    for stage in ["after-discovery", "after-capture", "after-render"] {
        let ready = hooks.path().join(format!("{stage}.ready"));
        let deadline = Instant::now() + Duration::from_secs(120);
        let token = loop {
            if let Ok(token) = std::fs::read_to_string(&ready) {
                break token;
            }
            ensure!(Instant::now() < deadline, "waiting for {stage}");
            std::thread::sleep(Duration::from_millis(5));
        };
        if stage == "after-render" {
            change(&repo, "file1.txt", 2, "raced content")?;
        }
        std::fs::write(hooks.path().join(format!("{stage}.release")), token)?;
    }
    let out = child.wait_with_output()?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("changed"));
    Ok(())
}

#[test]
#[ignore = "pending-context bootstrap"]
fn oversized_collection_fails_without_partial_document() -> Result<()> {
    let repo = fixture()?;
    repo.write_file("file1.txt", &"oversized changed content\n".repeat(800_000))?;
    let out = repo.run_span(["pending-context", "diff"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("bound") || err.contains("limit") || err.contains("exceed"),
        "{err}"
    );
    Ok(())
}
