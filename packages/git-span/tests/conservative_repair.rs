//! Automatic repair must not acknowledge similarity as content identity.
use anyhow::{Result, ensure};
use serde_json::Value;
use std::path::Path;
use std::process::{Command, Output};

fn git(root: &Path, args: &[&str]) -> Result<()> {
    let output = Command::new("git").current_dir(root).args(args).output()?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(())
}

fn span(root: &Path, args: &[&str]) -> Result<Output> {
    let output = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(root)
        .args(args)
        .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
        .env("GIT_SPAN_CONTEXT_DISABLE_SERVICE", "1")
        .output()?;
    ensure!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}

fn fixture(original: &str, candidate: Option<&str>) -> Result<tempfile::TempDir> {
    let repo = tempfile::tempdir()?;
    let root = repo.path();
    git(root, &["init", "--initial-branch=main"])?;
    git(root, &["config", "user.name", "Test"])?;
    git(root, &["config", "user.email", "test@example.com"])?;
    git(root, &["config", "commit.gpgsign", "false"])?;
    std::fs::write(root.join("source.txt"), original)?;
    if let Some(candidate) = candidate {
        std::fs::write(root.join("candidate.txt"), candidate)?;
    }
    git(root, &["add", "."])?;
    git(root, &["commit", "-m", "original"])?;
    let address = format!("source.txt#L1-L{}", original.lines().count());
    span(root, &["add", "probe", &address])?;
    span(root, &["why", "probe", "Preserve reviewed content."])?;
    git(root, &["add", "."])?;
    git(root, &["commit", "-m", "anchor"])?;
    Ok(repo)
}

#[test]
fn drift_fix_preserves_literal_whitespace_change() -> Result<()> {
    let repo = fixture("print(\"alpha beta\")\n", None)?;
    let definition = repo.path().join(".span/probe");
    let before = std::fs::read(&definition)?;
    std::fs::write(repo.path().join("source.txt"), "print(\"alphabeta\")\n")?;
    span(repo.path(), &["drift", "--fix", "--no-exit-code"])?;
    assert_eq!(
        std::fs::read(definition)?,
        before,
        "literal content must not be rehashed"
    );
    Ok(())
}

#[test]
fn fuzzy_destinations_are_candidates_not_repair_authority() -> Result<()> {
    let original = (1..=50)
        .map(|n| format!("fn worker_{n:02}(param: u32) -> u32 {{ param * {n} }}\n"))
        .collect::<String>();
    let candidate = original.replace(
        "worker_25(param: u32) -> u32",
        "worker_25(param: u64) -> u64",
    );
    for route in ["drift", "context"] {
        let repo = fixture(&original, Some(&candidate))?;
        let definition = repo.path().join(".span/probe");
        let before = std::fs::read(&definition)?;
        git(repo.path(), &["rm", "source.txt"])?;
        let observed = span(
            repo.path(),
            &["context", "candidate.txt", "--format", "json"],
        )?;
        let observed: Value = serde_json::from_slice(&observed.stdout)?;
        assert_eq!(
            observed["spans"][0]["anchors"][0]["status"]["code"],
            "MOVED"
        );
        if route == "drift" {
            span(repo.path(), &["drift", "--fix", "--no-exit-code"])?;
        } else {
            span(
                repo.path(),
                &["context", "candidate.txt", "--fix", "--format", "json"],
            )?;
        }
        assert_eq!(
            std::fs::read(definition)?,
            before,
            "{route} must preserve a fuzzy candidate for review"
        );
    }
    Ok(())
}

#[test]
fn location_refresh_of_independent_spans_stays_in_addressed_files() -> Result<()> {
    let original = (1..=30)
        .map(|n| format!("unique source line {n}\n"))
        .collect::<String>();
    let other = (1..=30)
        .map(|n| format!("unique candidate line {n}\n"))
        .collect::<String>();
    let repo = fixture(&original, Some(&other))?;
    let root = repo.path();
    span(root, &["add", "probe", "candidate.txt#L10-L11"])?;
    span(
        root,
        &[
            "add",
            "independent",
            "source.txt#L20-L21",
            "candidate.txt#L20-L21",
        ],
    )?;
    span(root, &["add", "unrelated", "candidate.txt#L5-L6"])?;
    git(root, &["add", "."])?;
    git(root, &["commit", "-m", "independent relationships"])?;
    let unrelated = std::fs::read(root.join(".span/unrelated"))?;
    std::fs::write(root.join("source.txt"), format!("inserted\n{original}"))?;
    std::fs::write(root.join("candidate.txt"), format!("inserted\n{other}"))?;
    span(
        root,
        &["context", "source.txt#L1-L2", "--fix", "--format", "json"],
    )?;
    let selected = std::fs::read_to_string(root.join(".span/probe"))?;
    assert!(
        selected.contains("candidate.txt#L11-L12"),
        "selected relationships retain their full exact-move repair"
    );
    let independent = std::fs::read_to_string(root.join(".span/independent"))?;
    assert!(independent.contains("source.txt#L21-L22"));
    assert!(
        independent.contains("candidate.txt#L20-L21"),
        "unselected relationship must not expand repair into an unaddressed file"
    );
    assert_eq!(std::fs::read(root.join(".span/unrelated"))?, unrelated);
    Ok(())
}

#[test]
fn exact_moves_verify_original_rules_before_adopting_destination_normalization() -> Result<()> {
    for (route, changed) in [
        ("drift", false),
        ("context", false),
        ("drift", true),
        ("context", true),
    ] {
        let repo = fixture("one\ntwo\nthree $Id$\nprint(\"alpha beta\")\nfive\n", None)?;
        let root = repo.path();
        std::fs::write(root.join(".gitattributes"), "source.txt ident\n")?;
        git(root, &["add", ".gitattributes"])?;
        git(root, &["commit", "-m", "source path has ident conversion"])?;
        std::fs::remove_file(root.join("source.txt"))?;
        git(root, &["checkout", "--", "source.txt"])?;
        let expanded = std::fs::read_to_string(root.join("source.txt"))?;
        assert!(
            expanded.contains("$Id:"),
            "fixture must exercise real ident expansion"
        );
        std::fs::rename(root.join("source.txt"), root.join("destination.txt"))?;
        let before = std::fs::read_to_string(root.join(".span/probe"))?;
        if changed {
            std::fs::write(
                root.join("destination.txt"),
                expanded.replace("alpha beta", "alphabeta"),
            )?;
        }
        if route == "drift" {
            span(root, &["drift", "--fix", "--no-exit-code"])?;
        } else {
            span(
                root,
                &["context", "destination.txt", "--fix", "--format", "json"],
            )?;
        }
        let definition = std::fs::read_to_string(root.join(".span/probe"))?;
        if changed {
            assert_eq!(
                definition, before,
                "{route} must not acknowledge a literal change across conversion contexts"
            );
            continue;
        }
        assert!(
            definition.contains("destination.txt#L1-L5"),
            "{route} should preserve verified identity across the path conversion change"
        );
        assert!(!definition.contains("source.txt#L1-L5"));
        span(root, &["drift"])?;
    }
    Ok(())
}
