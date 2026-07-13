//! Reproduction test: `git span doctor` must not report deletion
//! tombstones as parse errors.
//!
//! When a span is deleted with `git span delete`, the worktree file is
//! removed but the span name remains visible in HEAD and index.
//! [`read_effective`] returns `Ok(None)` for such deletion tombstones,
//! which [`read_span_in`] converts to `Error::SpanNotFound`. Doctor then
//! reports `ERROR — span '…' failed to parse: span not found` for a
//! perfectly legitimate pending deletion.
//!
//! [`load_all_spans_in`] already distinguishes `Ok(None)` and skips it
//! silently — doctor must do the same.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn doctor_skips_deletion_tombstone() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Create a span and commit it.
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "add test/foo span"])?;

    // Delete the span — removes the worktree file, creates a tombstone.
    let del = repo.run_span(["delete", "test/foo"])?;
    assert!(
        del.status.success(),
        "delete must succeed;\nstderr:\n{}",
        String::from_utf8_lossy(&del.stderr)
    );

    // Run doctor. The deleted span name is still visible in HEAD/index,
    // but read_effective returns Ok(None) for it (deletion tombstone).
    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    // Current broken behavior: ERROR — span 'test/foo' failed to parse: span not found
    // Expected: doctor must NOT report the deleted span as an error.
    assert!(
        !stdout.contains("test/foo"),
        "doctor must not report deletion tombstone 'test/foo' as an error;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    // And doctor should exit 0 since there are no real findings.
    assert!(
        out.status.success(),
        "doctor must exit 0 when only deletion tombstones exist;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    Ok(())
}
