//! Real-process acceptance specification for nested durable JSON notes commands.
use crate::support::TestRepo;
use anyhow::Result;
use serde_json::{Value, json};
use std::process::{Command, Stdio};

fn envelope(repo: &TestRepo, args: &[&str]) -> Result<Value> {
    let mut argv = vec!["notes"];
    argv.extend_from_slice(args);
    argv.extend_from_slice(&["--format", "json"]);
    let out = repo.span_stdout(argv)?;
    let value: Value = serde_json::from_str(&out)?;
    assert_eq!(value["schema_version"], 1);
    assert!(value["notes"].is_array());
    Ok(value)
}
fn add(repo: &TestRepo, revision: &str, document: &str) -> Result<Value> {
    Ok(envelope(repo, &["add", revision, document])?["notes"][0].clone())
}
fn git(repo: &TestRepo, args: &[&str]) -> Result<String> {
    let out = repo.run_git(args)?;
    anyhow::ensure!(
        out.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(String::from_utf8(out.stdout)?.trim().to_string())
}
fn command(path: &std::path::Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-span"));
    cmd.current_dir(path)
        .args(args)
        .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
        .env_remove("GIT_SPAN_DIR")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE");
    cmd
}
fn failed_without_stdout(repo: &TestRepo, args: &[&str]) -> Result<()> {
    let out = repo.run_span(args)?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(!out.stderr.is_empty());
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: envelopes"]
fn notes_all_four_envelopes_and_empty_lists_validate_against_published_schema() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let schema: Value = serde_json::from_str(&std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../website/public/schemas/cli/v1/notes.json"
    ))?)?;
    let validator = jsonschema::validator_for(&schema)?;
    let empty = envelope(&repo, &["list"])?;
    assert_eq!(empty["notes"], json!([]));
    validator.validate(&empty).unwrap();
    for (op, args) in [
        ("add", vec!["add", "HEAD", "null"]),
        ("show", vec!["show", "1"]),
        ("list", vec!["list"]),
        ("remove", vec!["remove", "1"]),
    ] {
        let output = envelope(&repo, &args)?;
        assert_eq!(output["operation"], op);
        assert_eq!(output["notes"][0]["id"], 1);
        assert_eq!(output["notes"][0]["document"], Value::Null);
        validator.validate(&output).unwrap();
    }
    assert_eq!(envelope(&repo, &["list"])?["notes"], json!([]));
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: stdin and source conflicts"]
fn notes_positional_and_stdin_inputs_are_bounded_and_conflicts_do_not_mutate() -> Result<()> {
    use std::io::Write;
    let repo = TestRepo::seeded()?;
    let mut cmd = command(repo.path(), &["notes", "add", "HEAD", "--format", "json"]);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
    let mut child = cmd.spawn()?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"session\":\"a\"}")?;
    let out = child.wait_with_output()?;
    assert!(out.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&out.stdout)?["notes"][0]["id"],
        1
    );
    let mut cmd = command(
        repo.path(),
        &["notes", "add", "HEAD", "null", "--format", "json"],
    );
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
    let mut child = cmd.spawn()?;
    child.stdin.take().unwrap().write_all(b"true")?;
    let out = child.wait_with_output()?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert_eq!(
        envelope(&repo, &["list"])?["notes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: input refusal before storage"]
fn notes_invalid_input_and_refs_leave_no_database() -> Result<()> {
    let repo = TestRepo::seeded()?;
    for args in [
        vec!["notes", "add", "HEAD", "{"],
        vec!["notes", "add", "missing", "null"],
        vec!["notes", "add", "HEAD^{tree}", "null"],
        vec!["notes", "add", "HEAD:file1.txt", "null"],
        vec!["notes", "add", "--", "--help", "null"],
    ] {
        failed_without_stdout(&repo, &args)?;
    }
    assert!(!repo.path().join(".git/span/notes.db").exists());
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: IDs and idempotency"]
fn notes_retry_and_readd_ids_persist_across_processes() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let first = add(&repo, "HEAD", r#"{"b":2,"a":1}"#)?;
    assert_eq!(add(&repo, "HEAD", r#"{"a":1,"b":2}"#)?, first);
    assert_eq!(add(&repo, "HEAD", "null")?["id"], 2);
    envelope(&repo, &["remove", "2"])?;
    envelope(&repo, &["remove", "1"])?;
    assert_eq!(add(&repo, "HEAD", "null")?["id"], 3);
    for id in ["0", "-1", "1.0", "9007199254740992", "1"] {
        failed_without_stdout(&repo, &["notes", "show", id, "--format", "json"])?;
        failed_without_stdout(&repo, &["notes", "remove", id, "--format", "json"])?;
    }
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: frozen associations and tag peeling"]
fn notes_commit_sha_is_frozen_when_a_branch_moves_and_annotated_tags_peel() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let original = git(&repo, &["rev-parse", "HEAD"])?;
    git(&repo, &["branch", "moving"])?;
    git(&repo, &["tag", "-a", "annotated", "-m", "tag"])?;
    assert_eq!(add(&repo, "annotated", "null")?["commit_sha"], original);
    git(&repo, &["commit", "--allow-empty", "-m", "next"])?;
    git(&repo, &["branch", "-f", "moving", "HEAD"])?;
    assert_eq!(
        envelope(&repo, &["show", "1"])?["notes"][0]["commit_sha"],
        original
    );
    assert_eq!(
        envelope(&repo, &["list", "moving", "--exact"])?["notes"],
        json!([])
    );
    assert_eq!(
        envelope(&repo, &["list", "moving"])?["notes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: ambiguous names"]
fn notes_ambiguous_git_refs_fail_even_when_native_git_exits_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    git(&repo, &["branch", "collision"])?;
    git(&repo, &["tag", "collision"])?;
    for args in [
        vec!["notes", "add", "collision", "null"],
        vec!["notes", "list", "collision"],
        vec!["notes", "list", "collision..HEAD"],
    ] {
        failed_without_stdout(&repo, &args)?;
    }
    assert!(!repo.path().join(".git/span/notes.db").exists());
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: Git reachability and ranges"]
fn notes_selection_matches_native_git_on_branches_merge_and_omitted_ranges() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let base = git(&repo, &["rev-parse", "HEAD"])?;
    add(&repo, "HEAD", "\"base\"")?;
    git(&repo, &["checkout", "-b", "left"])?;
    git(&repo, &["commit", "--allow-empty", "-m", "left"])?;
    add(&repo, "HEAD", "\"left\"")?;
    git(&repo, &["checkout", "-b", "right", &base])?;
    git(&repo, &["commit", "--allow-empty", "-m", "right"])?;
    add(&repo, "HEAD", "\"right\"")?;
    git(&repo, &["merge", "--no-ff", "left", "-m", "merge"])?;
    add(&repo, "HEAD", "\"merge\"")?;
    let all = envelope(&repo, &["list"])?;
    for revision in [
        "left",
        "right",
        "left..right",
        "left...right",
        "..left",
        "left..",
        "...left",
        "left...",
        "HEAD..HEAD",
    ] {
        let native = git(&repo, &["rev-list", revision])?;
        let expected: Vec<_> = all["notes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| native.lines().any(|s| n["commit_sha"] == s))
            .cloned()
            .collect();
        assert_eq!(
            envelope(&repo, &["list", revision])?["notes"],
            json!(expected),
            "{revision}"
        );
    }
    for args in [
        vec!["notes", "list", "--exact"],
        vec!["notes", "list", "left..right", "--exact"],
        vec!["notes", "list", "HEAD..missing"],
        vec!["notes", "list", "--", "--all"],
    ] {
        failed_without_stdout(&repo, &args)?;
    }
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: repository isolation"]
fn notes_independent_repositories_have_independent_sequences() -> Result<()> {
    let a = TestRepo::seeded()?;
    let b = TestRepo::seeded()?;
    assert_eq!(add(&a, "HEAD", "null")?["id"], 1);
    assert_eq!(add(&a, "HEAD", "true")?["id"], 2);
    assert_eq!(add(&b, "HEAD", "null")?["id"], 1);
    assert_eq!(
        envelope(&b, &["list"])?["notes"].as_array().unwrap().len(),
        1
    );
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: linked worktree concurrent processes"]
fn notes_linked_worktrees_share_atomic_first_open_allocation_and_duplicates() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let tmp = tempfile::tempdir()?;
    let linked = tmp.path().join("linked");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "--detach",
            linked.to_str().unwrap(),
            "HEAD",
        ],
    )?;
    let children: Vec<_> = (0..8)
        .map(|i| {
            command(
                if i % 2 == 0 { repo.path() } else { &linked },
                &["notes", "add", "HEAD", "null", "--format", "json"],
            )
            .stdout(Stdio::piped())
            .spawn()
        })
        .collect::<std::io::Result<_>>()?;
    for child in children {
        let out = child.wait_with_output()?;
        assert!(out.status.success());
        assert_eq!(
            serde_json::from_slice::<Value>(&out.stdout)?["notes"][0]["id"],
            1
        );
    }
    let children: Vec<_> = (0..8)
        .map(|i| {
            command(
                if i % 2 == 0 { repo.path() } else { &linked },
                &["notes", "add", "HEAD", &i.to_string(), "--format", "json"],
            )
            .stdout(Stdio::piped())
            .spawn()
        })
        .collect::<std::io::Result<_>>()?;
    let mut ids = Vec::new();
    for child in children {
        let out = child.wait_with_output()?;
        assert!(out.status.success());
        ids.push(
            serde_json::from_slice::<Value>(&out.stdout)?["notes"][0]["id"]
                .as_u64()
                .unwrap(),
        );
    }
    ids.sort();
    assert_eq!(ids, (2..=9).collect::<Vec<_>>());
    assert!(!linked.join(".git/span/notes.db").exists());
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: consumable IDs"]
fn notes_batch_consumption_preserves_new_same_commit_attachments() -> Result<()> {
    let repo = TestRepo::seeded()?;
    add(&repo, "HEAD", "null")?;
    add(&repo, "HEAD", "true")?;
    let batch = envelope(&repo, &["list"])?;
    let survivor = add(&repo, "HEAD", "false")?;
    for note in batch["notes"].as_array().unwrap() {
        envelope(&repo, &["remove", &note["id"].to_string()])?;
    }
    assert_eq!(envelope(&repo, &["list"])?["notes"], json!([survivor]));
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: cache lifecycle and recovery isolation"]
fn notes_survive_cache_recreation_and_invalid_span_settings() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let first = add(&repo, "HEAD", "null")?;
    let cache = repo.path().join(".git/span/store.db");
    std::fs::write(&cache, b"corrupt cache")?;
    git(&repo, &["config", "git-span.dir", "../invalid"])?;
    assert_eq!(envelope(&repo, &["show", "1"])?["notes"][0], first);
    assert_eq!(add(&repo, "HEAD", "true")?["id"], 2);
    git(&repo, &["config", "--unset", "git-span.dir"])?;
    let out = repo.run_span(["doctor"])?;
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(envelope(&repo, &["show", "1"])?["notes"][0], first);
    std::fs::remove_file(cache).ok();
    assert_eq!(add(&repo, "HEAD", "false")?["id"], 3);
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: fail-closed durable storage"]
fn notes_corrupt_storage_is_preserved_and_errors_emit_no_json_success() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let db = repo.path().join(".git/span/notes.db");
    std::fs::create_dir_all(db.parent().unwrap())?;
    std::fs::write(&db, b"broken durable notes")?;
    for args in [
        vec!["notes", "add", "HEAD", "null", "--format", "json"],
        vec!["notes", "list", "--format", "json"],
        vec!["notes", "show", "1", "--format", "json"],
        vec!["notes", "remove", "1", "--format", "json"],
    ] {
        failed_without_stdout(&repo, &args)?;
        assert_eq!(std::fs::read(&db)?, b"broken durable notes");
    }
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: human help and command reservation"]
fn notes_human_output_help_and_reserved_name_are_visible() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.span_stdout(["notes", "add", "HEAD", "{\"a\":1}"])?;
    assert!(out.contains('1'));
    let out = repo.span_stdout(["notes", "list"])?;
    assert!(out.contains('1'));
    assert!(out.contains(&git(&repo, &["rev-parse", "HEAD"])?));
    assert!(repo.span_stdout(["notes", "show", "1"])?.contains("a"));
    for leaf in ["add", "list", "show", "remove"] {
        assert!(
            repo.span_stdout(["notes", leaf, "--help"])?
                .contains("--format")
        );
    }
    failed_without_stdout(&repo, &["add", "notes", "file1.txt"])?;
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: detached associations"]
fn notes_unfiltered_listing_retains_commits_no_longer_reachable() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let base = git(&repo, &["rev-parse", "HEAD"])?;
    git(&repo, &["commit", "--allow-empty", "-m", "detached-note"])?;
    let record = add(&repo, "HEAD", "null")?;
    git(&repo, &["reset", "--hard", &base])?;
    assert_eq!(envelope(&repo, &["list"])?["notes"], json!([record]));
    assert_eq!(envelope(&repo, &["list", "HEAD"])?["notes"], json!([]));
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: machine suppression"]
fn notes_every_json_leaf_suppresses_update_checks_on_terminal_stdout() -> Result<()> {
    use clap::Parser;
    for leaf in ["add", "list", "show", "remove"] {
        let mut args = vec!["git-span", "notes", leaf];
        match leaf {
            "add" => args.extend(["HEAD", "null"]),
            "show" | "remove" => args.push("1"),
            _ => {}
        }
        args.extend(["--format", "json"]);
        let cli = git_span::cli::Cli::try_parse_from(args)?;
        assert!(git_span::update_check::suppress::signals_for(&cli, true).suppressed());
    }
    Ok(())
}

#[test]
#[ignore = "notes bootstrap: concurrent duplicate/remove linearizability"]
fn notes_duplicate_remove_race_has_only_serializable_results() -> Result<()> {
    let repo = TestRepo::seeded()?;
    add(&repo, "HEAD", "null")?;
    let duplicate = command(
        repo.path(),
        &["notes", "add", "HEAD", "null", "--format", "json"],
    )
    .stdout(Stdio::piped())
    .spawn()?;
    let removed = command(repo.path(), &["notes", "remove", "1", "--format", "json"])
        .stdout(Stdio::piped())
        .spawn()?;
    let added = duplicate.wait_with_output()?;
    let deleted = removed.wait_with_output()?;
    assert!(added.status.success());
    assert!(deleted.status.success());
    let id = serde_json::from_slice::<Value>(&added.stdout)?["notes"][0]["id"]
        .as_u64()
        .unwrap();
    let final_notes = envelope(&repo, &["list"])?;
    match id {
        1 => assert_eq!(final_notes["notes"], json!([])),
        2 => assert_eq!(final_notes["notes"][0]["id"], 2),
        other => panic!("nonserializable duplicate/remove ID {other}"),
    }
    Ok(())
}

#[cfg(unix)]
#[test]
#[ignore = "notes bootstrap: unwritable storage"]
fn notes_unwritable_storage_fails_without_success_or_allocation() -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let repo = TestRepo::seeded()?;
    let directory = repo.path().join(".git/span");
    std::fs::create_dir_all(&directory)?;
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o500))?;
    let output = repo.run_span(["notes", "add", "HEAD", "null", "--format", "json"])?;
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(!directory.join("notes.db").exists());
    assert_eq!(add(&repo, "HEAD", "null")?["id"], 1);
    Ok(())
}
