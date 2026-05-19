//! Reproduction: the one-step file->directory `git mesh move` that the
//! collision error itself recommends.
//!
//! git-mesh's prefix-collision error tells the user to remediate with
//! `git mesh move a/b a/b/index`. But `.mesh/a/b` is a regular file, and
//! the destination `.mesh/a/b/index` needs `.mesh/a/b/` to be a
//! directory. The rename does not handle the file->directory transition,
//! so the documented one-step fix fails with an
//! "File exists (os error 17)"-style error.
//!
//! This test asserts the one-step move SUCCEEDS and that
//! `.mesh/a/b/index` exists afterward. It MUST FAIL against current
//! code, which exits non-zero with the file-exists error.

mod support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn one_step_move_file_to_directory_succeeds() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;

    // Seed a committed file-backed mesh at `.mesh/a/b`.
    repo.mesh_stdout(["add", "a/b", "f.txt"])?;
    repo.mesh_stdout(["why", "a/b", "-m", "seed mesh a/b"])?;
    repo.commit_all("seed mesh a/b")?;
    assert!(
        repo.path().join(".mesh/a/b").is_file(),
        "precondition: `.mesh/a/b` must be a regular file before the move"
    );

    // The exact one-step remediation the collision error recommends.
    let out = repo.run_mesh(["move", "a/b", "a/b/index"])?;

    assert!(
        out.status.success(),
        "`git mesh move a/b a/b/index` must succeed (exit 0); \
         the documented one-step fix must be possible. \
         code={:?} stdout={} stderr={}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );

    assert!(
        repo.path().join(".mesh/a/b/index").is_file(),
        "after the move, `.mesh/a/b/index` must exist as a regular file"
    );

    Ok(())
}
