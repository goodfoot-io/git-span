//! `why -m`/`-F` bypass `validate_span_name`, allowing path-traversal
//! names like `../escape` to write outside `.span/`.
//!
//! Every other handler (`add`, `remove`, `why` reader, `why --edit`)
//! calls `validate_span_name` first.  The `-m` and `-F` writer paths
//! skip this check.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn rejects_path_traversal_name_in_why_m() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_span(["why", "../escape", "test body"])?;

    // The -m path does not call validate_span_name, so it currently
    // accepts path-traversal names.  Once validation is added this
    // assertion will pass (the command exits non-zero).
    assert!(
        !out.status.success(),
        "BUG: why -m accepted path-traversal name `../escape` (exit {:?})",
        out.status.code()
    );

    // No file should be written outside .span/.
    let escaped = repo.dir.path().join("escape");
    assert!(
        !escaped.exists(),
        "BUG: why -m wrote file outside .span/ at {:?}",
        escaped
    );

    Ok(())
}

#[test]
fn rejects_path_traversal_name_in_why_f() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.write_file("body.txt", "file-sourced body")?;
    let out = repo.run_span(["why", "../escape", "-F", "body.txt"])?;

    // Same bypass for -F.
    assert!(
        !out.status.success(),
        "BUG: why -F accepted path-traversal name `../escape` (exit {:?})",
        out.status.code()
    );

    let escaped = repo.dir.path().join("escape");
    assert!(
        !escaped.exists(),
        "BUG: why -F wrote file outside .span/ at {:?}",
        escaped
    );

    Ok(())
}
