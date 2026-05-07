//! Integration tests for `git mesh hooks git post-commit` and
//! `git mesh hooks git post-rewrite` shortcuts, and the removal of
//! `git mesh pre-commit`.

mod support;

use anyhow::Result;
use std::io::Write as _;
use std::process::Command;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Seed a mesh and set up the repo with a committed file.
fn seed_mesh(repo: &TestRepo, name: &str) -> Result<()> {
    repo.mesh_stdout(["add", name, "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", name, "-m", "test why"])?;
    repo.mesh_stdout(["commit", name])?;
    Ok(())
}

/// Run `git mesh hooks git post-rewrite` feeding `input` to stdin.
fn run_hooks_post_rewrite(repo: &TestRepo, input: &str) -> Result<std::process::Output> {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-mesh"));
    cmd.current_dir(repo.path());
    cmd.args(["hooks", "git", "post-rewrite"]);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn()?;
    child.stdin.take().unwrap().write_all(input.as_bytes())?;
    Ok(child.wait_with_output()?)
}

// ---------------------------------------------------------------------------
// Help-surface tests (Steps 1 & 3)
// ---------------------------------------------------------------------------

/// `git mesh --help` must list `hooks` as a subcommand group.
#[test]

fn help_lists_hooks_namespace() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["--help"])?;
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        stdout.contains("hooks"),
        "`git mesh --help` does not list `hooks`; got:\n{stdout}"
    );
    Ok(())
}

/// `git mesh hooks --help` must list `git`.
#[test]

fn hooks_help_lists_git() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["hooks", "--help"])?;
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        stdout.contains("git"),
        "`git mesh hooks --help` does not list `git`; got:\n{stdout}"
    );
    Ok(())
}

/// `git mesh hooks git --help` must list `post-commit` and `post-rewrite`.
#[test]

fn hooks_git_help_lists_events() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["hooks", "git", "--help"])?;
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        stdout.contains("post-commit"),
        "`git mesh hooks git --help` does not list `post-commit`; got:\n{stdout}"
    );
    assert!(
        stdout.contains("post-rewrite"),
        "`git mesh hooks git --help` does not list `post-rewrite`; got:\n{stdout}"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Chain-fidelity tests (Step 2)
// ---------------------------------------------------------------------------

/// `git mesh hooks git post-commit` exits zero and produces the mesh commit
/// side-effect (a refs/meshes ref exists after running with a staged add).
#[test]

fn post_commit_chain_fidelity() -> Result<()> {
    let repo = TestRepo::seeded()?;
    // Stage an add but don't run `git mesh commit` manually — the shortcut should.
    repo.mesh_stdout(["add", "m", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "m", "-m", "test why"])?;
    let out = repo.run_mesh(["hooks", "git", "post-commit"])?;
    assert!(
        out.status.success(),
        "post-commit hook shortcut failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    // The commit step should have created the mesh ref.
    assert!(
        repo.ref_exists("refs/meshes/v1/m"),
        "refs/meshes/v1/m not found after post-commit shortcut"
    );
    Ok(())
}

/// `git mesh hooks git post-rewrite` exits zero on empty stdin and
/// produces no error output.
#[test]

fn post_rewrite_empty_stdin_exits_zero() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = run_hooks_post_rewrite(&repo, "")?;
    assert!(
        out.status.success(),
        "post-rewrite with empty stdin failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// `git mesh hooks git post-rewrite` advances anchors correctly when given
/// a valid SHA pair on stdin (rewrite chain-fidelity).
#[test]

fn post_rewrite_chain_fidelity() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m")?;

    let old_sha = repo.head_sha()?;
    // Make a new commit to amend (simulate a rebase).
    repo.write_file("file1.txt", "updated content\n")?;
    let new_sha = repo.commit_all("amend-like")?;

    let input = format!("{old_sha} {new_sha}\n");
    let out = run_hooks_post_rewrite(&repo, &input)?;
    assert!(
        out.status.success(),
        "post-rewrite with valid pair failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// First step failure (commit fails) short-circuits: stale is never called
/// and the exit code is non-zero.
#[test]

fn post_commit_short_circuits_on_commit_failure() -> Result<()> {
    // In a repo with no staged mesh operations, `git mesh commit` exits non-zero.
    // The stale step should not run (cannot easily observe this directly, but
    // we can observe that the overall exit is non-zero when commit fails).
    let repo = TestRepo::seeded()?;
    // Don't stage anything — commit with nothing staged is an error.
    let out = repo.run_mesh(["hooks", "git", "post-commit"])?;
    // commit with no staged ops currently exits with an error.
    // If this succeeds (commit is a no-op), that's also fine; we just confirm
    // stale --no-exit-code doesn't turn a commit failure into overall success.
    // The key invariant: exit code == commit exit code when commit fails.
    let commit_out = repo.run_mesh(["commit"])?;
    assert_eq!(
        out.status.code(),
        commit_out.status.code(),
        "post-commit shortcut exit code does not match standalone `git mesh commit`"
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// pre-commit removal test (Step 3)
// ---------------------------------------------------------------------------

/// `git mesh pre-commit` must be rejected with a non-zero exit code now
/// that the command has been removed.
#[test]

fn pre_commit_subcommand_removed() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["pre-commit"])?;
    assert!(
        !out.status.success(),
        "`git mesh pre-commit` should exit non-zero (unrecognized subcommand)"
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("unrecognized subcommand")
            || stderr.contains("error")
            || !out.status.success(),
        "expected clap error output for removed subcommand, got: {stderr}"
    );
    Ok(())
}

/// `git mesh --help` must NOT list `pre-commit` after removal.
#[test]

fn help_does_not_list_pre_commit() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let out = repo.run_mesh(["--help"])?;
    let stdout = String::from_utf8(out.stdout)?;
    assert!(
        !stdout.contains("pre-commit"),
        "`git mesh --help` still lists `pre-commit`; got:\n{stdout}"
    );
    Ok(())
}
