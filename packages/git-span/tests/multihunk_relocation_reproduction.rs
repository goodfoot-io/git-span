//! D2: old-file hunk offsets must not be applied to an already-shifted range.
use anyhow::Result;
use serde_json::{Value, json};
use std::path::Path;
use std::process::{Command, Output};

fn git(root: &Path, args: &[&str]) -> Result<()> {
    let output = Command::new("git").current_dir(root).args(args).output()?;
    anyhow::ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

fn span(root: &Path, args: &[&str], exit: i32) -> Result<Output> {
    let mut command = Command::new(env!("CARGO_BIN_EXE_git-span"));
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_SPAN_") {
            command.env_remove(key);
        }
    }
    let output = command
        .current_dir(root)
        .args(args)
        .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .output()?;
    assert_eq!(
        output.status.code(),
        Some(exit),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}

fn fixture() -> Result<tempfile::TempDir> {
    let repo = tempfile::tempdir()?;
    let root = repo.path();
    git(root, &["init", "--initial-branch=main"])?;
    git(root, &["config", "user.name", "Test"])?;
    git(root, &["config", "user.email", "test@example.com"])?;
    git(root, &["config", "commit.gpgsign", "false"])?;
    let mut lines: Vec<String> = (1..=200)
        .map(|n| format!("unique_original_line_{n} = {n}"))
        .collect();
    std::fs::write(root.join("app.py"), format!("{}\n", lines.join("\n")))?;
    std::fs::write(root.join("w.txt"), "w\n")?;
    git(root, &["add", "."])?;
    git(root, &["commit", "-m", "original"])?;
    span(root, &["add", "probe", "app.py#L50-L60", "w.txt#L1-L1"], 0)?;
    span(root, &["why", "probe", "coupled content"], 0)?;
    git(root, &["add", "."])?;
    git(root, &["commit", "-m", "anchor"])?;

    lines[54] = "meaningfully_changed = True".into();
    let changed: Vec<String> = (0..100)
        .map(|n| format!("prefix_{n}"))
        .chain(lines[..99].iter().cloned())
        .chain((0..100).map(|n| format!("middle_{n}")))
        .chain(lines[99..].iter().cloned())
        .collect();
    // Independent oracle: only the first insertion precedes the tracked region.
    assert_eq!(changed[149], "unique_original_line_50 = 50");
    assert_eq!(changed[154], "meaningfully_changed = True");
    assert_eq!(changed[159], "unique_original_line_60 = 60");
    std::fs::write(root.join("app.py"), format!("{}\n", changed.join("\n")))?;
    Ok(repo)
}

#[test]
fn drift_json_reports_changed_region_after_only_the_preceding_insertion() -> Result<()> {
    let repo = fixture()?;
    let output = span(repo.path(), &["drift", "--format", "json"], 1)?;
    let document: Value = serde_json::from_slice(&output.stdout)?;
    let finding = document["findings"]
        .as_array()
        .unwrap()
        .iter()
        .find(|finding| finding["anchored"]["path"] == "app.py")
        .unwrap();
    assert_eq!(finding["status"]["code"], "CHANGED");

    // D2b is a limit on D2: --fix must not persist the bad inferred address.
    let definition = repo.path().join(".span/probe");
    let before = std::fs::read(&definition)?;
    span(repo.path(), &["drift", "--fix", "--no-exit-code"], 0)?;
    assert_eq!(std::fs::read(definition)?, before);

    assert_eq!(
        finding["current"]["extent"],
        json!({"kind": "lines", "start": 150, "end": 160})
    );
    Ok(())
}

#[test]
fn context_reports_changed_region_after_only_the_preceding_insertion() -> Result<()> {
    let repo = fixture()?;
    let output = span(repo.path(), &["context", "app.py", "--format", "json"], 0)?;
    let document: Value = serde_json::from_slice(&output.stdout)?;
    let anchor = document["spans"][0]["anchors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|anchor| anchor["anchored"]["path"] == "app.py")
        .unwrap();
    assert_eq!(anchor["status"]["code"], "CHANGED");
    assert_eq!(
        anchor["current"]["extent"],
        json!({"kind": "lines", "start": 150, "end": 160})
    );
    Ok(())
}
