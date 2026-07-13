//! Reproduction: path-traversal guard missing in `delete_span_in`.
//!
//! `delete_span_in` (structural.rs:27-38) joins the span name onto the span
//! root without verifying the resolved path stays within the span root.
//! A name containing `../` resolves outside `.span/`, allowing deletion of
//! files that happen to be parseable as span files.
//!
//! `validate_span_name` rejects `..` in names, but `delete_span_in` never
//! calls it, unlike `run_add` and `run_remove`.
//!
//! This test MUST FAIL against the current unfixed code. After a
//! path-containment guard is added to `delete_span_in`, the command will
//! reject traversal names and this test will pass.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn delete_span_path_traversal_escapes_span_root() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // A legitimate span to confirm the span root is active.
    repo.run_span(["add", "test-span", "file1.txt#L1-L5"])?;

    // Create a file outside .span/ that is span-parseable.
    //
    // delete_span_in calls read_effective(name) first (structural.rs:29),
    // which attempts to parse the target content as a SpanFile.  We choose
    // content that parses successfully so the read check does not mask the
    // deeper issue — the lack of path-containment verification.
    repo.write_file(
        "escape-file",
        "dummy rk64:0000000000000000\n\npath-traversal test\n",
    )?;

    // The delete command builds `workdir/.span/<name>` (structural.rs:32)
    // without checking whether the resolved path stays under `.span/`.
    // A name containing `../` resolves outside the span root.
    //
    // This MUST be rejected with a non-zero exit.  The current (unfixed)
    // code exits 0 and deletes the outside file — this assertion FAILS.
    let out = repo.run_span(["delete", "../escape-file"])?;
    assert!(
        !out.status.success(),
        "delete with `../escape-file` should be rejected (non-zero exit), \
         but got exit {:?}; stderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr),
    );

    Ok(())
}
