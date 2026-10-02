//! Durable notes must preserve full object IDs for both native Git hash formats.
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::path::Path;
use std::process::Command;

fn git(directory: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .current_dir(directory)
        .args(args)
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

fn notes(directory: &Path, args: &[&str]) -> Result<Value> {
    let output = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(directory)
        .arg("notes")
        .args(args)
        .args(["--format", "json"])
        .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
        .env_remove("GIT_SPAN_DIR")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .output()?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout)?;
    assert_eq!(envelope["schema_version"], 1);
    Ok(envelope)
}

#[test]
fn notes_full_sha_round_trip_survives_linked_worktree_removal() -> Result<()> {
    for (format, length) in [("sha1", 40), ("sha256", 64)] {
        let temporary = tempfile::tempdir()?;
        let repository = temporary.path().join("repository");
        std::fs::create_dir(&repository)?;
        git(&repository, &["init", &format!("--object-format={format}")])?;
        git(&repository, &["config", "user.name", "Notes Test"])?;
        git(&repository, &["config", "user.email", "notes@example.test"])?;
        git(&repository, &["commit", "--allow-empty", "-m", "initial"])?;
        let linked = temporary.path().join("linked");
        git(
            &repository,
            &[
                "worktree",
                "add",
                "--detach",
                linked.to_str().unwrap(),
                "HEAD",
            ],
        )?;
        git(&linked, &["commit", "--allow-empty", "-m", "recorded"])?;
        let sha = git(&linked, &["rev-parse", "HEAD"])?;
        assert_eq!(sha.len(), length);
        let document = r#"{"schema_version":1,"host":"codex","session_id":"object-format-test"}"#;
        let added = notes(&linked, &["add", &sha, document])?;
        assert_eq!(added["operation"], "add");
        assert_eq!(added["notes"][0]["commit_sha"], sha);
        assert_eq!(
            added["notes"][0]["document"],
            serde_json::from_str::<Value>(document)?
        );
        assert_eq!(
            notes(&repository, &["add", &sha, document])?["notes"],
            added["notes"]
        );
        assert_eq!(
            notes(&repository, &["list", &sha, "--exact"])?["notes"],
            added["notes"]
        );
        git(
            &repository,
            &["worktree", "remove", linked.to_str().unwrap()],
        )?;
        assert_eq!(
            notes(&repository, &["list", &sha, "--exact"])?["notes"],
            added["notes"]
        );
        assert_eq!(notes(&repository, &["show", "1"])?["notes"], added["notes"]);
        assert_eq!(
            notes(&repository, &["list", "HEAD", "--exact"])?["notes"],
            json!([])
        );
        assert!(repository.join(".git/span/notes.db").is_file());
    }
    Ok(())
}
