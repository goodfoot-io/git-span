//! Reproduction: the one-step file->directory `git span move` that the
//! collision error itself recommends.
//!
//! git-span's prefix-collision error tells the user to remediate with
//! `git span move a/b a/b/index`. But `.span/a/b` is a regular file, and
//! the destination `.span/a/b/index` needs `.span/a/b/` to be a
//! directory. The rename does not handle the file->directory transition,
//! so the documented one-step fix fails with an
//! "File exists (os error 17)"-style error.
//!
//! This test asserts the one-step move SUCCEEDS and that
//! `.span/a/b/index` exists afterward. It MUST FAIL against current
//! code, which exits non-zero with the file-exists error.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn one_step_move_file_to_directory_succeeds() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("f.txt", "hi\n")?;
    repo.commit_all("init")?;

    // Seed a committed file-backed span at `.span/a/b`.
    repo.span_stdout(["add", "a/b", "f.txt"])?;
    repo.span_stdout(["why", "a/b", "-m", "seed span a/b"])?;
    repo.commit_all("seed span a/b")?;
    assert!(
        repo.path().join(".span/a/b").is_file(),
        "precondition: `.span/a/b` must be a regular file before the move"
    );

    // The exact one-step remediation the collision error recommends.
    let out = repo.run_span(["move", "a/b", "a/b/index"])?;

    assert!(
        out.status.success(),
        "`git span move a/b a/b/index` must succeed (exit 0); \
         the documented one-step fix must be possible. \
         code={:?} stdout={} stderr={}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );

    assert!(
        repo.path().join(".span/a/b/index").is_file(),
        "after the move, `.span/a/b/index` must exist as a regular file"
    );

    Ok(())
}
