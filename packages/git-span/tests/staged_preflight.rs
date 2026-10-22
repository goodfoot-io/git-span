//! Explicit staged preflight inspects index evidence without mutating user state.
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::process::Command;

#[path = "support/staged_preflight.rs"]
mod support;
use support::Repo;

#[test]
fn staged_preflight_uses_index_definitions_and_blobs_without_mutation() -> Result<()> {
    let repo = Repo::new()?;
    let out = repo.output(&["add", "coupling", "a.txt#L1-L1"])?;
    ensure!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    ensure!(
        repo.output(&["why", "coupling", "staged obligation"])?
            .status
            .success(),
        "write why"
    );
    repo.git(&["add", ".span"])?;
    repo.git(&["commit", "-qm", "span"])?;
    let span_path = repo.0.path().join(".span/coupling");
    let definition = std::fs::read_to_string(&span_path)?;
    std::fs::write(
        &span_path,
        definition.replace("staged obligation", "unstaged meaning"),
    )?;
    repo.write("a.txt", "staged wrong\nsecond\n")?;
    repo.git(&["add", "a.txt"])?;
    repo.write("a.txt", "first\nsecond\n")?;
    let before = repo.git(&["status", "--porcelain"])?;
    let index_before = std::fs::read(repo.0.path().join(".git/index"))?;
    let report = repo.span(&["preflight", "--format", "json"])?;
    assert_eq!(
        index_before,
        std::fs::read(repo.0.path().join(".git/index"))?
    );
    assert_eq!(report["obligations"][0]["why"], "staged obligation");
    assert!(!repo.0.path().join(".git/span/notes.db").exists());
    assert_eq!(report["obligations"].as_array().expect("array").len(), 1);
    assert_eq!(report["obligations"][0]["name"], "coupling");
    assert_eq!(
        report["obligations"][0]["anchors"][0]["content_matches"],
        false
    );
    assert_eq!(report["staged_tree"], repo.git(&["write-tree"])?);
    assert_eq!(report, repo.span(&["preflight", "--format", "json"])?);
    assert_eq!(before, repo.git(&["status", "--porcelain"])?);
    repo.git(&["add", "a.txt"])?;
    let restaged = repo.span(&["preflight", "--format", "json"])?;
    assert_ne!(report["evidence_revision"], restaged["evidence_revision"]);
    assert_eq!(restaged["obligations"], json!([]));
    Ok(())
}
#[test]
fn staged_preflight_keeps_removed_spans_and_deleted_sources_visible() -> Result<()> {
    let repo = Repo::new()?;
    let out = repo.output(&["add", "coupling", "a.txt#L1-L1"])?;
    ensure!(out.status.success(), "span add");
    repo.git(&["add", ".span"])?;
    repo.git(&["commit", "-qm", "span"])?;
    repo.git(&["rm", "a.txt", ".span/coupling"])?;
    let report = repo.span(&["preflight", "--format", "json"])?;
    assert_eq!(report["removed_spans"][0]["name"], "coupling");
    assert_eq!(report["removed_spans"][0]["anchors"][0]["present"], false);
    Ok(())
}

#[test]
fn staged_preflight_rejects_unmerged_and_tree_hash_matches_git() -> Result<()> {
    let repo = Repo::new()?;
    repo.write("dir/inner.txt", "nested\n")?;
    repo.write("dir.file", "sibling\n")?;
    repo.git(&["add", "."])?;
    support::stage_symlink(&repo)?;
    let report = repo.span(&["preflight", "--format", "json"])?;
    assert_eq!(report["staged_tree"], repo.git(&["write-tree"])?);
    let oid = repo.git(&["rev-parse", "HEAD:a.txt"])?;
    let input = format!("100644 {oid} 1\tconflict.txt\n100644 {oid} 2\tconflict.txt\n");
    use std::io::Write;
    let mut child = Command::new("git")
        .current_dir(repo.0.path())
        .args(["update-index", "--index-info"])
        .stdin(std::process::Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .expect("piped input")
        .write_all(input.as_bytes())?;
    assert!(child.wait()?.success());
    let out = repo.output(&["preflight", "--format", "json"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("unmerged"));
    Ok(())
}

#[test]
fn staged_preflight_fingerprints_definition_and_source_bounds() -> Result<()> {
    let repo = Repo::new()?;
    ensure!(
        repo.output(&["add", "coupling", "a.txt#L1-L1"])?
            .status
            .success(),
        "add"
    );
    let span = repo.0.path().join(".span/coupling");
    let original = std::fs::read_to_string(&span)?;
    let (address, _) = original
        .lines()
        .next()
        .expect("anchor record")
        .split_once(' ')
        .expect("anchor hash separator");
    for (suffix, expected_match) in [("0000000000000001", false), ("0000000000000002", false)] {
        std::fs::write(
            &span,
            format!("{address} rk64:{suffix}\n\nstaged obligation\n"),
        )?;
        repo.git(&["add", ".span"])?;
        let report = repo.span(&["preflight", "--format", "json"])?;
        assert_eq!(
            report["obligations"][0]["anchors"][0]["content_matches"],
            expected_match
        );
        if suffix.ends_with('1') {
            repo.write(
                "first-revision.json",
                &report["obligations"][0]["evidence_revision"].to_string(),
            )?;
        } else {
            let previous: Value = serde_json::from_str(&std::fs::read_to_string(
                repo.0.path().join("first-revision.json"),
            )?)?;
            assert_ne!(previous, report["obligations"][0]["evidence_revision"]);
        }
    }
    // An empty stored range cannot match an out-of-bounds declared address.
    std::fs::write(
        &span,
        "a.txt#L100-L100 rk64:0000000000000000\n\nempty range\n",
    )?;
    repo.git(&["add", ".span"])?;
    assert_eq!(
        repo.span(&["preflight", "--format", "json"])?["obligations"][0]["anchors"][0]["content_matches"],
        false
    );
    repo.write("a.txt", &"x".repeat(16 * 1024 * 1024 + 1))?;
    repo.git(&["add", "a.txt"])?;
    let out = repo.output(&["preflight", "--format", "json"])?;
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("16 MiB"));
    Ok(())
}

#[test]
fn staged_preflight_excludes_intent_to_add_and_honors_alternate_index() -> Result<()> {
    let repo = Repo::new()?;
    repo.write("new.txt", "not staged yet\n")?;
    repo.git(&["add", "-N", "new.txt"])?;
    let report = repo.span(&["preflight", "--format", "json"])?;
    assert_eq!(report["staged_tree"], repo.git(&["write-tree"])?);
    let alternate = repo.0.path().join("alternate-index");
    std::fs::copy(repo.0.path().join(".git/index"), &alternate)?;
    repo.git(&["add", "new.txt"])?;
    let out = Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(repo.0.path())
        .env("GIT_INDEX_FILE", &alternate)
        .env("GIT_SPAN_DISABLE_UPDATE_CHECK", "1")
        .args(["preflight", "--format", "json"])
        .output()?;
    ensure!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let selected: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(selected["staged_tree"], report["staged_tree"]);
    assert_ne!(
        selected["staged_tree"],
        repo.span(&["preflight", "--format", "json"])?["staged_tree"]
    );
    Ok(())
}
