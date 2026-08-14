//! Regression coverage for partial conflict resolution by `git span drift
//! --fix`. A partial rewrite must preserve every committed side and must not
//! report success while conflict residue remains unanalyzed.

use crate::support;
use anyhow::Result;
use support::TestRepo;

use super::round2_repair_domain::{ORIGINAL, line_slice_hash};

fn read_span(repo: &TestRepo) -> Result<String> {
    Ok(std::fs::read_to_string(repo.path().join(".span/m"))?)
}

fn span_with_config(why: &str) -> String {
    format!(
        "file1.txt#L1-L5 rk64:{}\n\n{why}\n\n[config]\nfollow_moves = true\n",
        line_slice_hash(ORIGINAL, 1, 5)
    )
}

#[test]
fn fix_preserves_valid_config_while_why_residue_remains() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file(".span/m", &span_with_config("base rationale"))?;
    repo.commit_all("declare configured span")?;

    repo.run_git(["checkout", "-b", "side"])?;
    repo.write_file(".span/m", &span_with_config("their rationale"))?;
    repo.commit_all("side changes rationale")?;

    repo.run_git(["checkout", "main"])?;
    repo.write_file(".span/m", &span_with_config("our rationale"))?;
    repo.commit_all("main changes rationale")?;

    let merge = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "--no-edit", "side"])
        .output()?;
    assert!(
        !merge.status.success(),
        "fixture assumption: the real merge must leave `.span/m` unmerged"
    );
    let conflicted = read_span(&repo)?;
    assert!(
        conflicted.contains("<<<<<<<")
            && conflicted.contains("[config]")
            && conflicted.contains("follow_moves = true"),
        "fixture assumption: Git's conflict must still carry the valid config; file=\n{conflicted}"
    );

    let out = repo.run_span(["drift", "--fix", "--no-exit-code"])?;
    let after = read_span(&repo)?;
    assert!(
        after.contains("<<<<<<<")
            && after.contains("our rationale")
            && after.contains("their rationale"),
        "the unresolved why sides must remain reviewable; file=\n{after}"
    );
    assert!(
        after.contains("[config]") && after.contains("follow_moves = true"),
        "partial resolution must preserve the valid config shared by base, ours, and theirs; \
         file=\n{after}\nstdout=\n{}\nstderr=\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

#[test]
fn fix_exits_nonzero_while_unconfigured_residue_remains() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let fixture = format!(
        "file1.txt#L1-L5 rk64:{}\n\n<<<<<<< ours\nour rationale\n=======\ntheir rationale\n>>>>>>> theirs\n",
        line_slice_hash(ORIGINAL, 1, 5)
    );
    repo.write_file(".span/m", &fixture)?;

    let out = repo.run_span(["drift", "--fix"])?;
    let after = read_span(&repo)?;
    assert!(
        after.contains("<<<<<<<")
            && after.contains("our rationale")
            && after.contains("their rationale"),
        "fixture assumption: partial resolution must leave both residue sides; file=\n{after}"
    );
    assert_eq!(
        out.status.code(),
        Some(1),
        "residue is not a clean result and must remain discoverable to scripts; stdout=\n{}\nstderr=\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}
