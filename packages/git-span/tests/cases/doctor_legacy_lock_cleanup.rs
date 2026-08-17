//! `git span doctor` removes legacy per-span lock artifacts left in
//! `.span/` by older builds (the `.span-lock-<hash>`, `.<name>.lock`, and
//! `.<leaf>.context.lock` families). Mutations now serialize through a
//! single repository-wide lock under the git directory, so any of these
//! files still sitting in the span root is residue from before that
//! change — doctor cleans it up and names what it removed under a
//! `## Cleanup` section, without affecting the exit code.

use crate::support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn doctor_removes_legacy_lock_files_and_reports_them() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Create a hierarchical span so `.span/team/` exists.
    repo.run_span(["add", "team/member", "file1.txt"])?;

    // Pre-seed legacy lock artifacts: a hierarchical-span lock at the span
    // root, a flat-span lock at the root, and a context-repair lock nested
    // under a subdirectory.
    repo.write_file(".span/.span-lock-0123abcd", "")?;
    repo.write_file(".span/.foo.lock", "")?;
    repo.write_file(".span/team/.member.context.lock", "")?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "doctor must exit 0 when the only residue is legacy lock files;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    // All three legacy lock files are gone from the worktree.
    assert!(
        !repo.path().join(".span/.span-lock-0123abcd").exists(),
        "`.span-lock-0123abcd` should have been removed;\nstdout:\n{stdout}"
    );
    assert!(
        !repo.path().join(".span/.foo.lock").exists(),
        "`.foo.lock` should have been removed;\nstdout:\n{stdout}"
    );
    assert!(
        !repo.path().join(".span/team/.member.context.lock").exists(),
        "`.member.context.lock` should have been removed;\nstdout:\n{stdout}"
    );

    // Control files and the span itself are untouched.
    assert!(repo.path().join(".span/.gitattributes").exists());
    assert!(repo.path().join(".span/.gitignore").exists());
    assert!(repo.path().join(".span/.hookignore").exists());
    assert!(repo.path().join(".span/team/member").exists());

    // Each removed file is named under a `## Cleanup` section.
    assert!(
        stdout.contains("## Cleanup"),
        "stdout must contain a `## Cleanup` section;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`.span/.span-lock-0123abcd`"),
        "stdout must name the removed hierarchical-span lock;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`.span/.foo.lock`"),
        "stdout must name the removed flat-span lock;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("`.span/team/.member.context.lock`"),
        "stdout must name the removed context-repair lock;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn doctor_omits_cleanup_section_when_nothing_is_stale() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.run_span(["add", "test/foo", "file1.txt"])?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "doctor must exit 0 for a healthy repo;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        !stdout.contains("## Cleanup"),
        "a clean repo's doctor output must not contain a `## Cleanup` heading;\nstdout:\n{stdout}"
    );

    Ok(())
}
