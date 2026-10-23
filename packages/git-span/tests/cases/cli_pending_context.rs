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
    repo.run_git(["config", "status.showUntrackedFiles", "no"])?;
    assert!(query(&repo, "status", &["--", "new.txt"])?.spans.is_empty());
    assert_eq!(
        names(&query(&repo, "status", &["-uall", "--", "new.txt"])?),
        ["new-source"]
    );
    Ok(())
}

#[test]
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
fn collection_race_refuses_mixed_snapshot() -> Result<()> {
    use std::time::{Duration, Instant};
    for mutation in [
        "content",
        "index",
        "corpus",
        "untracked",
        "head",
        "configuration",
    ] {
        let repo = fixture()?;
        change(&repo, "file1.txt", 2, "selected change")?;
        let hooks = tempfile::tempdir()?;
        let child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo.path())
            .env("GIT_SPAN_CONTEXT_TEST_HOOK_DIR", hooks.path())
            .args([
                "pending-context",
                if mutation == "untracked" {
                    "status"
                } else {
                    "diff"
                },
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        for stage in ["after-discovery", "after-capture", "after-render"] {
            let ready = hooks.path().join(format!("{stage}.ready"));
            let deadline = Instant::now() + Duration::from_secs(120);
            let token = loop {
                if let Ok(token) = std::fs::read_to_string(&ready)
                    && uuid::Uuid::parse_str(&token).is_ok()
                {
                    break token;
                }
                ensure!(Instant::now() < deadline, "waiting for {stage}");
                std::thread::sleep(Duration::from_millis(5));
            };
            if stage == "after-render" {
                match mutation {
                    "content" => change(&repo, "file1.txt", 2, "raced content")?,
                    "index" => {
                        repo.run_git(["add", "file1.txt"])?;
                    }
                    "corpus" => {
                        let definition = repo.path().join(".span/selected");
                        let text = std::fs::read_to_string(&definition)?;
                        std::fs::write(
                            definition,
                            text.replace(
                                "Both source ranges follow the same contract.",
                                "Changed explanation during collection.",
                            ),
                        )?;
                    }
                    "untracked" => repo.write_file("new-during-collection", "new source\n")?,
                    "head" => {
                        repo.run_git(["update-ref", "HEAD", "HEAD^"])?;
                    }
                    "configuration" => {
                        repo.run_git(["config", "diff.renames", "false"])?;
                    }
                    _ => unreachable!(),
                }
            }
            std::fs::write(hooks.path().join(format!("{stage}.release")), token)?;
        }
        let out = child.wait_with_output()?;
        assert!(!out.status.success());
        assert!(out.stdout.is_empty());
        assert!(String::from_utf8_lossy(&out.stderr).contains("changed"));
    }
    Ok(())
}

#[test]
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

#[test]
fn literal_foo_directory_multiple_and_exclusion_paths_preserve_membership() -> Result<()> {
    let repo = fixture()?;
    for (name, path) in [
        ("foo-span", "src/foo.py"),
        ("other-span", "src/other.py"),
        ("outside-span", "outside.py"),
    ] {
        repo.write_file(path, "original\n")?;
        ensure!(
            repo.run_span(["add", name, path])?.status.success(),
            "add {name}"
        );
    }
    repo.commit_all("pathspec spans")?;
    for path in ["src/foo.py", "src/other.py", "outside.py"] {
        repo.write_file(path, "changed\n")?;
    }
    assert_eq!(
        names(&query(&repo, "diff", &["--", "src/foo.py"])?),
        ["foo-span"]
    );
    assert_eq!(
        names(&query(&repo, "diff", &["--", "src/"])?),
        ["foo-span", "other-span"]
    );
    assert_eq!(
        names(&query(&repo, "diff", &["--", "src/foo.py", "outside.py"])?),
        ["foo-span", "outside-span"]
    );
    assert_eq!(
        names(&query(
            &repo,
            "diff",
            &["--", "src/", ":(exclude)src/other.py"]
        )?),
        ["foo-span"]
    );
    Ok(())
}

#[test]
fn insertion_and_deletion_boundaries_do_not_select_untouched_ranges() -> Result<()> {
    let repo = fixture()?;
    let original = std::fs::read_to_string(repo.path().join("file1.txt"))?;
    repo.write_file("file1.txt", &("before anchor\n".to_owned() + &original))?;
    assert!(query(&repo, "diff", &[])?.spans.is_empty());
    repo.write_file("file1.txt", &original.replace("line5\n", ""))?;
    assert!(query(&repo, "diff", &[])?.spans.is_empty());
    repo.write_file("file1.txt", &original.replace("line2\n", ""))?;
    assert_eq!(names(&query(&repo, "diff", &[])?), ["selected"]);
    Ok(())
}

#[test]
fn binary_type_changes_and_rename_pathspecs_keep_affected_spans() -> Result<()> {
    let repo = fixture()?;
    repo.write_file_bytes("file1.txt", b"binary\0payload\xff")?;
    assert_eq!(
        names(&query(&repo, "diff", &[])?),
        ["elsewhere", "selected"]
    );
    repo.run_git(["reset", "--hard", "HEAD"])?;
    repo.run_git(["mv", "file1.txt", "renamed.txt"])?;
    for path in ["file1.txt", "renamed.txt"] {
        assert_eq!(
            names(&query(&repo, "diff", &["--cached", "--", path])?),
            ["elsewhere", "selected"]
        );
    }
    #[cfg(unix)]
    {
        repo.run_git(["reset", "--hard", "HEAD"])?;
        std::fs::remove_file(repo.path().join("file1.txt"))?;
        std::os::unix::fs::symlink("file2.txt", repo.path().join("file1.txt"))?;
        assert_eq!(
            names(&query(&repo, "diff", &[])?),
            ["elsewhere", "selected"]
        );
    }
    Ok(())
}

#[test]
fn alternate_index_invalid_utf8_and_failed_probes_are_explicit_errors() -> Result<()> {
    let repo = fixture()?;
    let out = repo.run_span_with_env(
        ["pending-context", "status"],
        "GIT_INDEX_FILE",
        &repo.path().join(".git/index").to_string_lossy(),
    )?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("GIT_INDEX_FILE"));
    repo.write_file_bytes("file1.txt", b"invalid text\xff\n")?;
    let out = repo.run_span(["pending-context", "diff"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("UTF-8"));
    repo.run_git(["reset", "--hard", "HEAD"])?;
    repo.run_git(["config", "diff.renames", "not-a-boolean"])?;
    let out = repo.run_span(["pending-context", "diff"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(!out.stderr.is_empty());
    Ok(())
}

#[test]
fn absent_truncated_layer_ranges_do_not_match_recorded_line_numbers() -> Result<()> {
    let repo = fixture()?;
    repo.write_file("file1.txt", "surviving first line\n")?;
    repo.commit_all("delete anchored regions without refreshing declarations")?;
    let context = repo.run_span(["context", "file1.txt"])?;
    ensure!(context.status.success(), "context for missing ranges");
    let context: ContextDocument = serde_json::from_slice(&context.stdout)?;
    assert!(
        context
            .spans
            .iter()
            .any(|s| s.name == "elsewhere" && s.anchors.iter().any(|a| a.current.is_none()))
    );
    repo.write_file("file1.txt", "surviving first line\nunrelated two\nunrelated three\nunrelated four\nunrelated five\nunrelated six\nunrelated seven\nunrelated eight\nunrelated nine\nunrelated ten\n")?;
    assert!(query(&repo, "diff", &["--", "file1.txt"])?.spans.is_empty());
    repo.run_git(["add", "file1.txt"])?;
    assert!(
        query(&repo, "diff", &["--cached", "--", "file1.txt"])?
            .spans
            .is_empty()
    );
    Ok(())
}

#[test]
fn relative_selection_configuration_is_explicitly_unsupported() -> Result<()> {
    let repo = fixture()?;
    repo.run_git(["config", "diff.relative", "true"])?;
    let out = repo.run_span(["pending-context", "diff"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("diff.relative"));
    Ok(())
}

#[test]
fn configuration_changed_after_repository_open_uses_live_selection_or_refuses() -> Result<()> {
    use std::time::{Duration, Instant};
    for (inspection, key, value) in [
        ("status", "status.showUntrackedFiles", "no"),
        ("diff", "diff.relative", "true"),
    ] {
        let repo = fixture()?;
        repo.write_file("new.txt", "untracked source\n")?;
        ensure!(
            repo.run_span(["add", "new-source", "new.txt"])?
                .status
                .success(),
            "untracked anchor"
        );
        let hooks = tempfile::tempdir()?;
        let child = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
            .current_dir(repo.path())
            .env("GIT_SPAN_CONTEXT_TEST_HOOK_DIR", hooks.path())
            .env("GIT_SPAN_PENDING_TEST_PAUSE_BEFORE_CONFIG", "1")
            .args(["pending-context", inspection, "--", "--", "new.txt"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        let stages = if inspection == "status" {
            vec![
                "pending-before-config",
                "after-discovery",
                "after-capture",
                "after-render",
            ]
        } else {
            vec!["pending-before-config"]
        };
        for stage in stages {
            let ready = hooks.path().join(format!("{stage}.ready"));
            let deadline = Instant::now() + Duration::from_secs(120);
            let token = loop {
                if let Ok(token) = std::fs::read_to_string(&ready)
                    && uuid::Uuid::parse_str(&token).is_ok()
                {
                    break token;
                }
                ensure!(Instant::now() < deadline, "waiting for {stage}");
                std::thread::sleep(Duration::from_millis(5));
            };
            if stage == "pending-before-config" {
                repo.run_git(["config", key, value])?;
            }
            std::fs::write(hooks.path().join(format!("{stage}.release")), token)?;
        }
        let out = child.wait_with_output()?;
        if inspection == "status" {
            ensure!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            let doc: ContextDocument = serde_json::from_slice(&out.stdout)?;
            assert!(doc.spans.is_empty());
        } else {
            assert!(!out.status.success());
            assert!(out.stdout.is_empty());
            assert!(String::from_utf8_lossy(&out.stderr).contains("diff.relative"));
        }
    }
    Ok(())
}
