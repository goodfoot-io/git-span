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
        stdout.contains("no `merge=span` for `.span/**` in the committed repository-root `.gitattributes`"),
        "stdout must name the missing rule and its committed state;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("commit it: `.span/** merge=span`"),
        "stdout must quote the exact line to add;\nstdout:\n{stdout}"
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
    assert!(
        stdout.contains("files under `.span/`"),
        "the prose must name the resolved span root, not a hardcoded path;\nstdout:\n{stdout}"
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
        stdout.contains("no `merge=span` for `.span/**` in the committed repository-root `.gitattributes`"),
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
        stdout.contains("`meta/span/** merge=span`"),
        "the finding must quote the resolved span root, not `.span`;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains("files under `meta/span/`"),
        "the prose must name the resolved span root, not a hardcoded `.span`;\nstdout:\n{stdout}"
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
        stdout.contains("no `merge=span` for `.span/**`"),
        "stdout must still report the missing rule;\nstdout:\n{stdout}"
    );

    Ok(())
}

/// A repo with no `.span/` directory cannot receive `.span/` conflicts from
/// any merge, so the merge-driver checks are vacuous — the same existence
/// gate the legacy-lock cleanup uses. Doctor stays silent and exits 0.
#[test]
fn doctor_is_silent_on_a_repo_without_a_span_root() -> Result<()> {
    let repo = TestRepo::seeded()?;

    let out = doctor_isolated(&repo)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "a span-less repo must exit 0;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("no findings"),
        "a span-less repo must report no findings;\nstdout:\n{stdout}"
    );

    Ok(())
}

/// The root-anchored form `/{span_root}/**` is git-equivalent to
/// `{span_root}/**` in a repository-root file — git applies it to the same
/// paths — so it must count as registered.
#[test]
fn doctor_accepts_the_root_anchored_rule_form() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", "/.span/** merge=span\n")?;
    repo.commit_all("register the root-anchored rule")?;
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
        "`/.span/** merge=span` must count as registered;\nexit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    Ok(())
}

/// Git evaluates `.gitattributes` patterns in order with last-match-wins
/// semantics: a later `-merge` line for the same pattern unsets the
/// attribute, so doctor must still report the gap — the merges will not
/// collapse.
#[test]
fn doctor_rejects_a_later_negating_line() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", ".span/** merge=span\n.span/** -merge\n")?;
    repo.commit_all("register then unset the rule")?;
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
        "a later `-merge` line unsets the attribute, so doctor must exit 1;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("in the committed repository-root `.gitattributes`"),
        "the gitattributes finding must persist;\nstdout:\n{stdout}"
    );

    Ok(())
}

/// A later matching line that does not mention `merge` leaves the attribute
/// set — git only lets the last line that *mentions* the attribute decide.
#[test]
fn doctor_keeps_registration_when_a_later_matching_line_mentions_no_merge() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", ".span/** merge=span\n.span/** text\n")?;
    repo.commit_all("register with a later non-merge attribute line")?;
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
        "a matching line without a `merge` token must not unset the rule;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    Ok(())
}

/// Registration is a *committed* rule: an uncommitted paste must not certify
/// the repo healthy, or the finding's own advice ("add … and commit it")
/// would lie to the paste-then-verify loop.
#[test]
fn doctor_ignores_an_uncommitted_rule() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    // Written but never staged or committed.
    repo.write_file(".gitattributes", ".span/** merge=span\n")?;
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
        "an uncommitted rule must not count as registered;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );
    assert!(
        stdout.contains("in the committed repository-root `.gitattributes`"),
        "the finding must name the committed state;\nstdout:\n{stdout}"
    );

    Ok(())
}

/// A span root that cannot appear verbatim in a `.gitattributes` pattern
/// (`#`, `!`, whitespace, globs, a trailing slash) would make the quoted fix
/// a git no-op or unsatisfiable, so resolution must reject it up front —
/// fail closed rather than issue a dead recommendation.
#[test]
fn doctor_rejects_span_roots_that_would_break_the_quoted_rule() -> Result<()> {
    let repo = TestRepo::seeded()?;

    for (root, expected) in [
        ("#span", "span root must not contain"),
        ("!span", "span root must not contain"),
        ("span dir", "span root must not contain"),
        ("span*", "span root must not contain"),
        ("span[", "span root must not contain"),
        ("meta/span/", "span root must not end with `/`"),
    ] {
        let out = repo.run_span_with_envs(["doctor"], &[("GIT_SPAN_DIR", root)])?;
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !out.status.success(),
            "span root `{root}` must be rejected;\nexit: {:?}\nstderr:\n{stderr}",
            out.status.code()
        );
        assert!(
            stderr.contains(expected),
            "rejection for `{root}` must say why;\nstderr:\n{stderr}"
        );
    }

    Ok(())
}

/// The config finding's quoted `[merge "span"]` block must be the *last*
/// copyable thing in the finding: a user who selects from the block to the
/// end of the output pastes exactly the block, and a `.git/config` that
/// receives that paste must still parse. This is load-bearing — the finding's
/// prose above the block contains backticked tokens with `=` that git config
/// would read as a key/value, and any trailing line would be an unexpected
/// token that invalidates the entire config, breaking every git command
/// until hand-repair.
#[test]
fn doctor_pasted_config_finding_never_corrupts_git_config() -> Result<()> {
    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.write_file(".gitattributes", ".span/** merge=span\n")?;
    repo.commit_all("register the span merge driver rule")?;

    // Only the config half is missing, so the finding's block is the last
    // copyable region in the output.
    let out = doctor_isolated(&repo)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !out.status.success(),
        "an unregistered repo must exit 1;\nstdout:\n{stdout}"
    );

    // Extract from `[merge "span"]` to the end of the finding (the `## Store`
    // section that follows is not part of the finding).
    let block_start = stdout
        .find("[merge \"span\"]")
        .expect("finding must quote the config block;\nstdout:\n{stdout}");
    let block_end = stdout[block_start..]
        .find("\n## ")
        .map(|i| block_start + i)
        .unwrap_or(stdout.len());
    let pasted = stdout[block_start..block_end].trim_end();

    // Simulate the paste: append the selected text to the existing config.
    let config_path = repo.path().join(".git/config");
    let existing = std::fs::read_to_string(&config_path)?;
    std::fs::write(&config_path, format!("{existing}\n{pasted}\n"))?;

    // The config must still parse, the driver must be registered, and doctor
    // must converge — the witness that the paste never corrupts the repo.
    let list = repo.run_git(["config", "--list"])?;
    assert!(
        list.status.success(),
        "pasting the finding into `.git/config` must leave it parseable;\n\
         stderr:\n{}",
        String::from_utf8_lossy(&list.stderr)
    );
    let driver = repo.run_git(["config", "merge.span.driver"])?;
    assert_eq!(
        String::from_utf8_lossy(&driver.stdout).trim(),
        "git span merge-driver %O %A %B %L",
        "the pasted block must register the driver"
    );

    let out = doctor_isolated(&repo)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "doctor must converge to exit 0 after the paste;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        stdout.contains("no findings"),
        "doctor must report no findings after the paste;\nstdout:\n{stdout}"
    );

    Ok(())
}
