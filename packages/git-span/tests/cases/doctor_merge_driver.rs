//! `git span doctor` reports an incomplete merge-driver registration for
//! `.span/` conflicts: the repository-root `.gitattributes` rule and the
//! per-clone `merge.span.driver` git config block are independent — git
//! distributes one and not the other — so each missing half is its own
//! finding, quoting the exact text to add and keyed off the resolved span
//! root. Registration stays manual by design; doctor only makes the gap
//! visible, never writes these files.

use crate::support;

use anyhow::Result;
use support::TestRepo;

/// Run `doctor` with an isolated `HOME` and system config disabled, so the
/// merged config snapshot cannot pick up a dev machine's global
/// `merge.span.driver`. Only the "absent" assertions need this — presence
/// assertions cannot be polluted.
fn doctor_isolated(repo: &TestRepo) -> Result<std::process::Output> {
    let home = tempfile::tempdir()?;
    let home_str = home.path().to_str().unwrap().to_string();
    repo.run_span_with_envs(
        ["doctor"],
        &[("HOME", &home_str), ("GIT_CONFIG_NOSYSTEM", "1")],
    )
}

#[test]
fn doctor_is_silent_when_the_merge_driver_is_fully_registered() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.register_span_merge_driver()?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "a fully registered repo must exit 0;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("no findings"),
        "a fully registered repo must report no findings;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn doctor_reports_both_findings_when_nothing_is_registered() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;

    let out = doctor_isolated(&repo)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "an unregistered repo must exit 1;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("`.span/** merge=span` rule in the repository-root `.gitattributes`"),
        "stdout must quote the missing `.gitattributes` rule;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("merge.span.driver"),
        "stdout must name the missing config key;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("[merge \"span\"]"),
        "stdout must quote the missing `[merge \"span\"]` block;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("driver = git span merge-driver %O %A %B %L"),
        "stdout must quote the driver command;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn doctor_reports_only_the_rule_when_the_config_block_is_registered() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.run_git([
        "config",
        "merge.span.driver",
        "git span merge-driver %O %A %B %L",
    ])?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "a repo with only the config block must exit 1;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("`.span/** merge=span` rule in the repository-root `.gitattributes`"),
        "stdout must quote the missing `.gitattributes` rule;\nstdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("merge.span.driver"),
        "stdout must not report the config block when it is registered;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn doctor_reports_only_the_config_block_when_the_rule_is_committed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", ".span/** merge=span\n")?;
    repo.commit_all("register the span merge driver rule")?;

    let out = doctor_isolated(&repo)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "a repo with only the rule must exit 1;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("merge.span.driver"),
        "stdout must name the missing config key;\nstdout:\n{stdout}"
    );
    assert!(
        !stdout.contains("repository-root `.gitattributes`"),
        "stdout must not report the rule when it is committed;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn doctor_keys_the_rule_off_the_resolved_span_root() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_git(["config", "git-span.dir", "meta/span"])?;

    // The default-root rule is not equivalent when the span root is
    // `meta/span` — the finding must quote the resolved root.
    repo.write_file(".gitattributes", ".span/** merge=span\n")?;
    repo.commit_all("register only the default-root rule")?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "a `meta/span` repo with only the default-root rule must exit 1;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("`meta/span/** merge=span` rule"),
        "the finding must quote the resolved span root, not `.span`;\nstdout:\n{stdout}"
    );

    // With the resolved-root rule plus the driver block, doctor is silent.
    repo.write_file(".gitattributes", "meta/span/** merge=span\n")?;
    repo.commit_all("register the resolved-root rule")?;
    repo.run_git([
        "config",
        "merge.span.driver",
        "git span merge-driver %O %A %B %L",
    ])?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "a `meta/span` repo with both halves registered must exit 0;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    Ok(())
}

#[test]
fn doctor_accepts_equivalent_rules_and_rejects_unsets() -> Result<()> {
    // Extra attributes alongside `merge=span` are equivalent.
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", ".span/** merge=span text\n")?;
    repo.commit_all("register with extra attributes")?;
    repo.run_git([
        "config",
        "merge.span.driver",
        "git span merge-driver %O %A %B %L",
    ])?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success(),
        "`.span/** merge=span text` must count as registered;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    // Unsetting the merge attribute is not registration.
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", ".span/** -merge\n")?;
    repo.commit_all("unset the merge attribute")?;
    repo.run_git([
        "config",
        "merge.span.driver",
        "git span merge-driver %O %A %B %L",
    ])?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !out.status.success(),
        "`.span/** -merge` must not count as registered;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("`.span/** merge=span` rule"),
        "stdout must still quote the missing rule;\nstdout:\n{stdout}"
    );

    Ok(())
}
