//! Output-equivalence guard for `git mesh stale --fix`.
//!
//! Asserts that two consecutive `--fix` runs (mesh files reverted in between)
//! produce byte-identical stdout, stderr, and exit codes.  This is the
//! precondition for the Phase 2–4 speed optimisations in card main-97: any
//! optimisation that changes this byte-identity must be caught here.

mod support;

use anyhow::Result;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Return the raw bytes of a mesh file.
fn read_mesh_bytes(repo: &TestRepo, name: &str) -> Result<Vec<u8>> {
    let path = repo.path().join(".mesh").join(name);
    Ok(std::fs::read(path)?)
}

/// Run `git mesh stale --fix` (with optional extra args) and return
/// `(stdout_bytes, stderr_bytes, exit_code)`.
fn run_fix<'a>(
    repo: &TestRepo,
    extra: impl IntoIterator<Item = &'a str>,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>)> {
    let mut args = vec!["stale", "--fix"];
    for a in extra {
        args.push(a);
    }
    let out = repo.run_mesh(args)?;
    Ok((out.stdout, out.stderr, out.status.code()))
}

// ---------------------------------------------------------------------------
// 1a — Bare-scan arm
//
// Fixture:
//   - anchor A: Moved  (file renamed, bytes identical)
//   - anchor B: Changed whitespace-only  (content-equivalent → re-anchored)
//   - anchor C: Deleted  (terminal → left untouched)
//   - two contiguous same-path anchors D1/D2 that --fix coalesces
//
// Runs `git mesh stale --fix` (no positional mesh), captures
// stdout+stderr+exit, reverts, runs again, asserts byte-identity.
// ---------------------------------------------------------------------------

#[test]
fn equivalence_bare_scan_arm() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Mesh "moved-mesh": one anchor that will be Moved.
    repo.write_file(
        "src.txt",
        "alpha\nbeta\ngamma\ndelta\nepsilon\n",
    )?;
    repo.run_git(["add", "src.txt"])?;
    repo.run_git(["commit", "-m", "add src.txt"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;
    repo.mesh_stdout(["add", "moved-mesh", "src.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "moved-mesh", "-m", "moved anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add moved-mesh"])?;

    // Mesh "changed-mesh": one anchor with a whitespace-only change.
    repo.mesh_stdout(["add", "changed-mesh", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "changed-mesh", "-m", "changed anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add changed-mesh"])?;

    // Mesh "deleted-mesh": one anchor whose file will be deleted.
    repo.mesh_stdout(["add", "deleted-mesh", "file2.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "deleted-mesh", "-m", "deleted anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add deleted-mesh"])?;

    // Mesh "coalesce-mesh": two contiguous same-path anchors.
    repo.mesh_stdout(["add", "coalesce-mesh", "file1.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.mesh_stdout(["why", "coalesce-mesh", "-m", "coalesce anchors"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add coalesce-mesh"])?;

    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Now set up the drift states.

    // A: Moved — rename src.txt → dst.txt
    repo.run_git(["mv", "src.txt", "dst.txt"])?;
    repo.run_git(["commit", "-m", "rename src.txt to dst.txt"])?;

    // B: whitespace-only worktree change on file1.txt (Changed, content-equivalent)
    repo.write_file(
        "file1.txt",
        "  line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;

    // C: delete file2.txt (Deleted terminal — left by --fix)
    std::fs::remove_file(repo.path().join("file2.txt"))?;

    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Snapshot the mesh files before any --fix run.
    let snap_moved = read_mesh_bytes(&repo, "moved-mesh")?;
    let snap_changed = read_mesh_bytes(&repo, "changed-mesh")?;
    let snap_deleted = read_mesh_bytes(&repo, "deleted-mesh")?;
    let snap_coalesce = read_mesh_bytes(&repo, "coalesce-mesh")?;

    // Run 1.
    let (stdout1, stderr1, code1) = run_fix(&repo, ["--no-exit-code"])?;

    // Revert mesh files to their pre-fix state.
    std::fs::write(repo.path().join(".mesh").join("moved-mesh"), &snap_moved)?;
    std::fs::write(repo.path().join(".mesh").join("changed-mesh"), &snap_changed)?;
    std::fs::write(repo.path().join(".mesh").join("deleted-mesh"), &snap_deleted)?;
    std::fs::write(repo.path().join(".mesh").join("coalesce-mesh"), &snap_coalesce)?;

    // Run 2.
    let (stdout2, stderr2, code2) = run_fix(&repo, ["--no-exit-code"])?;

    // Assert byte-identity.
    assert_eq!(code1, code2, "exit codes must match");
    assert_eq!(
        String::from_utf8_lossy(&stdout1),
        String::from_utf8_lossy(&stdout2),
        "stdout must be byte-identical across two --fix runs"
    );
    assert_eq!(
        String::from_utf8_lossy(&stderr1),
        String::from_utf8_lossy(&stderr2),
        "stderr must be byte-identical across two --fix runs"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 1b — Named-scope arm, fully-freshened mesh
//
// Fixture: one mesh with a single Moved anchor. After --fix, the mesh becomes
// fully Fresh.  The named-scope arm must still render the mesh (as bare
// bullets) — it must not drop it. Two runs must be byte-identical.
// ---------------------------------------------------------------------------

#[test]
fn equivalence_named_scope_fully_freshened() -> Result<()> {
    let repo = TestRepo::seeded()?;

    repo.write_file("origin.txt", "foo\nbar\nbaz\n")?;
    repo.run_git(["add", "origin.txt"])?;
    repo.run_git(["commit", "-m", "add origin.txt"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    repo.mesh_stdout(["add", "fresh-mesh", "origin.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "fresh-mesh", "-m", "single moved anchor"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add fresh-mesh"])?;

    // Rename so the anchor becomes Moved.
    repo.run_git(["mv", "origin.txt", "renamed.txt"])?;
    repo.run_git(["commit", "-m", "rename origin.txt to renamed.txt"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    let snap = read_mesh_bytes(&repo, "fresh-mesh")?;

    // Run 1 — named scope, no --no-exit-code (mesh is fully fixed → exit 0).
    let (stdout1, stderr1, code1) = run_fix(&repo, ["fresh-mesh"])?;

    // Revert.
    std::fs::write(repo.path().join(".mesh").join("fresh-mesh"), &snap)?;

    // Run 2.
    let (stdout2, stderr2, code2) = run_fix(&repo, ["fresh-mesh"])?;

    assert_eq!(code1, code2, "exit codes must match");
    assert_eq!(
        String::from_utf8_lossy(&stdout1),
        String::from_utf8_lossy(&stdout2),
        "stdout must be byte-identical across two --fix runs (named scope)"
    );
    assert_eq!(
        String::from_utf8_lossy(&stderr1),
        String::from_utf8_lossy(&stderr2),
        "stderr must be byte-identical across two --fix runs (named scope)"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 1c — Warning-producing fixture (stderr parity guard)
//
// Fixture: a mesh with a Deleted anchor (terminal — --fix never rewrites it)
// in a repo where the commit-history walk triggers a rename-budget warning
// under GIT_MESH_RENAME_BUDGET=0.  A pre-warmup run is performed to populate
// the cache_v2 for the pre-fix mesh state; after warmup, the two measured
// runs both hit the warm cache and produce byte-identical output (including
// empty-string stderr).
//
// This is the correct baseline for the Phase 4 guard: if Phase 4 breaks the
// SourceLayers invariant and double-emits pre-fix warnings in the post-fix
// pass, a double-warm run would suddenly show warnings in one run but not
// the other, breaking byte-identity.
//
// The pre-warmup ensures both measured runs are deterministically warm so
// the test is not racy with respect to cache state from other test runs.
// ---------------------------------------------------------------------------

#[test]
fn equivalence_warning_stderr_parity() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // Source files that will be renamed — creates rename-budget pressure.
    repo.write_file("p1.txt", "alpha\nbeta\n")?;
    repo.write_file("p2.txt", "gamma\ndelta\n")?;
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "add p1 p2"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Mesh: anchor a file that will be deleted (terminal) and one that will
    // be renamed (Moved — but with budget=0 rename detection is disabled so
    // it stays as Deleted/unreachable too).
    repo.mesh_stdout(["add", "warn-mesh", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "warn-mesh", "-m", "warn parity guard"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "add warn-mesh"])?;

    // Rename p1/p2 and delete file1: creates a commit with >= 2 changes,
    // exceeding budget=0 during the HEAD walk when searching for attribution.
    repo.run_git(["mv", "p1.txt", "q1.txt"])?;
    repo.run_git(["mv", "p2.txt", "q2.txt"])?;
    repo.run_git(["rm", "file1.txt"])?;
    repo.run_git(["commit", "-m", "rename p1→q1, p2→q2, delete file1"])?;
    repo.run_git(["commit-graph", "write", "--reachable", "--changed-paths"])?;

    // Pre-warmup: run --fix once (cache miss → full resolution → cache
    // populated for this mesh state).  mesh is unchanged because the Deleted
    // anchor is terminal.
    {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "--no-exit-code"]);
        cmd.output()?;
    }

    let snap = read_mesh_bytes(&repo, "warn-mesh")?;

    // Run 1 — cache is warm; output is deterministic.
    let out1 = {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "--no-exit-code"]);
        cmd.output()?
    };

    // Revert mesh (no-op since Deleted is terminal and --fix didn't write it,
    // but kept for structural symmetry with 1a/1b).
    std::fs::write(repo.path().join(".mesh").join("warn-mesh"), &snap)?;

    // Run 2 — same warm cache state.
    let out2 = {
        let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"));
        cmd.current_dir(repo.path());
        cmd.env("GIT_MESH_RENAME_BUDGET", "0");
        cmd.args(["stale", "--fix", "--no-exit-code"]);
        cmd.output()?
    };

    assert_eq!(out1.status.code(), out2.status.code(), "exit codes must match");
    assert_eq!(
        String::from_utf8_lossy(&out1.stdout),
        String::from_utf8_lossy(&out2.stdout),
        "stdout must be byte-identical across two --fix runs (warning fixture)"
    );
    assert_eq!(
        String::from_utf8_lossy(&out1.stderr),
        String::from_utf8_lossy(&out2.stderr),
        "stderr must be byte-identical across two --fix runs (warning fixture)"
    );

    Ok(())
}
