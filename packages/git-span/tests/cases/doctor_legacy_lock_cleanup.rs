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

    // Register the merge driver so doctor's merge-driver checks stay silent
    // and the exit code is about the lock residue alone.
    repo.register_span_merge_driver()?;

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
fn doctor_removes_a_legacy_lock_symlink_without_following_it() -> Result<()> {
    if !support::symlinks_supported() {
        return Ok(());
    }

    let repo = TestRepo::seeded()?;
    repo.run_span(["add", "team/member", "file1.txt"])?;
    repo.register_span_merge_driver()?;

    // Cards worktree provisioning symlinks untracked files — including
    // legacy lock files — from the main checkout into a worktree, so a
    // lock-named symlink is a real-world shape here, not just a synthetic
    // one. Point it at a file outside `.span/` entirely, so "the target
    // survives" is unambiguous.
    let target = repo.path().join("outside-span-target.txt");
    std::fs::write(&target, "kept\n")?;
    support::symlink_file(&target, &repo.path().join(".span/.linked.lock"))?;

    // A symlink whose basename does not match the legacy-lock pattern must
    // survive untouched — only lock-named entries are in scope. Dot-prefix
    // it like the other config artifacts (`.gitignore`, `.hookignore`) so
    // it is excluded from span-name scanning entirely, the same way
    // `.foo.lock` is above — otherwise the span reader would try to parse
    // its content as a span declaration, which is not what this test is
    // about.
    support::symlink_file(&target, &repo.path().join(".span/.other-config-artifact"))?;

    let out = repo.run_span(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        out.status.success(),
        "doctor must exit 0 after cleaning a legacy lock symlink;\n\
         exit: {:?}\nstdout:\n{stdout}\nstderr:\n{stderr}",
        out.status.code()
    );

    assert!(
        !repo.path().join(".span/.linked.lock").exists(),
        "the lock symlink itself should have been removed;\nstdout:\n{stdout}"
    );
    assert!(
        target.exists(),
        "removing the lock symlink must never remove its target"
    );
    assert_eq!(
        std::fs::read_to_string(&target)?,
        "kept\n",
        "the symlink target's content must be untouched"
    );
    assert!(
        repo.path().join(".span/.other-config-artifact").exists(),
        "a symlink whose name is not a legacy-lock name must survive"
    );

    assert!(
        stdout.contains("`.span/.linked.lock`"),
        "stdout must name the removed lock symlink;\nstdout:\n{stdout}"
    );

    Ok(())
}

#[test]
fn doctor_omits_cleanup_section_when_nothing_is_stale() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.run_span(["add", "test/foo", "file1.txt"])?;
    repo.register_span_merge_driver()?;

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

#[test]
fn concurrent_doctor_runs_never_report_a_lost_delete_race_as_a_finding() -> Result<()> {
    // `doctor` dispatches under `Mode::Shared`, so concurrent `git span
    // doctor` invocations run at the same time rather than serializing
    // through the repository lock — unlike a mutating command. Two runs
    // can both enumerate the same stale legacy-lock file; whichever loses
    // the delete race must observe the file already gone (`NotFound`) and
    // treat that as confirmation the cleanup already happened, not as
    // damage. Before the fix, the loser reported "could not clean legacy
    // lock file" as a finding and exited 1 for an otherwise perfectly
    // healthy repository.
    //
    // The race window is short and process startup dominates, so repeat
    // several times rather than relying on a single interleaving.
    for attempt in 0..20 {
        let repo = TestRepo::seeded()?;
        repo.run_span(["add", "test/span", "file1.txt"])?;
        repo.register_span_merge_driver()?;
        repo.write_file(".span/.race.lock", "")?;

        let path_a = repo.path().to_path_buf();
        let a = std::thread::spawn(move || -> Result<std::process::Output> {
            let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
            cmd.current_dir(&path_a);
            cmd.args(["doctor"]);
            Ok(cmd.output()?)
        });

        let path_b = repo.path().to_path_buf();
        let b = std::thread::spawn(move || -> Result<std::process::Output> {
            let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-span"));
            cmd.current_dir(&path_b);
            cmd.args(["doctor"]);
            Ok(cmd.output()?)
        });

        let out_a = a.join().unwrap()?;
        let out_b = b.join().unwrap()?;

        assert!(
            out_a.status.success(),
            "attempt {attempt}: doctor A must exit 0 even if it lost the delete \
             race to doctor B;\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&out_a.stdout),
            String::from_utf8_lossy(&out_a.stderr)
        );
        assert!(
            out_b.status.success(),
            "attempt {attempt}: doctor B must exit 0 even if it lost the delete \
             race to doctor A;\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&out_b.stdout),
            String::from_utf8_lossy(&out_b.stderr)
        );
        assert!(
            !repo.path().join(".span/.race.lock").exists(),
            "attempt {attempt}: the legacy lock file must be gone regardless \
             of which process actually removed it"
        );
    }

    Ok(())
}
