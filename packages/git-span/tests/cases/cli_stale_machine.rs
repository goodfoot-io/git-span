//! CLI: `git span stale` machine formats (§10.4).

use crate::support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

fn seed(repo: &TestRepo, name: &str) -> Result<()> {
    repo.span_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.span_stdout(["why", name, "seed"])?;
    {
        repo.run_git(["add", ".span"])?;
        repo.run_git(["commit", "-m", "span commit"])?;
    }
    Ok(())
}

fn drift(repo: &TestRepo) -> Result<String> {
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    repo.commit_all("mutate")
}

#[test]

fn porcelain_one_line_per_finding() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8_lossy(&out.stdout);
    // `# porcelain v1` header + one finding line.
    let lines: Vec<&str> = text.trim().lines().collect();
    assert_eq!(lines.len(), 2, "header + 1 finding: {text}");
    assert_eq!(lines[0], "# porcelain v2");
    assert!(text.contains("CHANGED"));
    assert!(text.contains("file1.txt"));
    Ok(())
}

#[test]

fn porcelain_clean_is_empty() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    let out = repo.run_span(["stale", "m", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&out.stdout).trim().is_empty());
    Ok(())
}

#[test]

fn json_has_schema_version() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=json"])?;
    let v: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(v["schema_version"], 2);
    assert!(v["findings"].is_array());
    Ok(())
}

#[test]

fn json_envelope_has_span_field() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=json"])?;
    let v: Value = serde_json::from_slice(&out.stdout)?;
    assert_eq!(v["schema_version"], 2);
    assert_eq!(v["span"], "m");
    Ok(())
}

#[test]

fn json_finding_has_status_and_anchored() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed(&repo, "m")?;
    drift(&repo)?;
    let out = repo.run_span(["stale", "m", "--format=json"])?;
    let v: Value = serde_json::from_slice(&out.stdout)?;
    let first = &v["findings"][0];
    assert_eq!(first["status"]["code"], "CHANGED");
    assert!(first["anchored"]["path"].is_string());
    assert_eq!(first["anchored"]["extent"]["kind"], "lines");
    assert_eq!(first["anchored"]["extent"]["start"], 1);
    assert_eq!(first["anchored"]["extent"]["end"], 5);
    Ok(())
}



#[test]

fn tool_error_exits_one() -> Result<()> {
    // Running outside a git repo is an operational failure: the
    // command is well-formed, the environment is missing. Operational
    // failures exit 1; exit 2 is reserved for clap usage errors.
    let dir = tempfile::tempdir()?;
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"))
        .current_dir(dir.path())
        .args(["stale"])
        .output()?;
    assert_eq!(out.status.code(), Some(1));
    Ok(())
}

