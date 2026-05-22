//! Regression: `git mesh add` must refuse an anchor whose target path is
//! gitignored.
//!
//! git-mesh resolves anchored content through git's layers, so a path git
//! never sees (a gitignored build artifact) can never resolve — `stale`
//! reports it `deleted` forever, with no commit able to clear it and no
//! in-tool resolution. The fix rejects such a target at `add` time.
//!
//! The reject keys on the *gitignore match*, not on trackedness:
//!   - gitignored + untracked  → rejected (permanently unresolvable).
//!   - untracked but NOT ignored → allowed (resolves the moment it is
//!     committed — a legitimate, self-healing anchor).
//!   - tracked (force-added) but matching a pattern → allowed (git tracks
//!     it, so it resolves normally).

mod support;

use anyhow::Result;
use support::TestRepo;

/// Case A: a gitignored, untracked target is rejected at `add` time.
#[test]
fn add_rejects_gitignored_anchor_target() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("doc.md", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("seed doc")?;

    // A generated artifact: present on disk, but gitignored.
    repo.write_file("generated.ts", "gen1\ngen2\ngen3\ngen4\ngen5\n")?;
    repo.write_file(".gitignore", "generated.ts\n")?;
    repo.commit_all("ignore generated.ts")?;

    let out = repo.run_mesh(["add", "ignored-demo", "generated.ts#L1-L5"])?;
    assert!(
        !out.status.success(),
        "add must reject a gitignored anchor target; got exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("gitignored"),
        "reject message must name the gitignore cause; stderr:\n{stderr}"
    );

    // The reject is fail-closed at the source: no mesh file is written.
    assert!(
        !repo.path().join(".mesh/ignored-demo").exists(),
        "a rejected add must not create the mesh file"
    );
    Ok(())
}

/// Case B (contrast): an untracked-but-NOT-ignored target is allowed —
/// it is a legitimate anchor that resolves once the file is committed.
#[test]
fn add_allows_untracked_not_ignored_anchor_target() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("doc.md", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.commit_all("seed doc")?;

    // On disk, not committed, not ignored.
    repo.write_file("newcode.ts", "n1\nn2\nn3\n")?;

    let out = repo.run_mesh(["add", "transient-demo", "newcode.ts#L1-L3"])?;
    assert!(
        out.status.success(),
        "add must allow an untracked-but-not-ignored target; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(repo.path().join(".mesh/transient-demo").exists());
    Ok(())
}

/// A path matched by a `.gitignore` pattern but force-added to git is
/// tracked, so it resolves normally and must still be allowed — the
/// reject keys on git's effective "would be excluded", not the raw
/// pattern match.
#[test]
fn add_allows_force_added_tracked_path_matching_ignore_pattern() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("doc.md", "l1\nl2\nl3\nl4\nl5\n")?;
    repo.write_file("generated.ts", "gen1\ngen2\ngen3\ngen4\ngen5\n")?;
    repo.write_file(".gitignore", "generated.ts\n")?;
    // Force-add the ignored path so git tracks it.
    repo.run_git(["add", "-f", "generated.ts"])?;
    repo.commit_all("force-add generated.ts despite ignore")?;

    let out = repo.run_mesh(["add", "forced-demo", "generated.ts#L1-L5"])?;
    assert!(
        out.status.success(),
        "add must allow a tracked path even if it matches an ignore pattern; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}
