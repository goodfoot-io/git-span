//! Recovery and surfacing for a PRE-EXISTING poisoned mesh — a committed
//! mesh file that already carries an anchor pointing inside the resolved mesh
//! root (a hand-edit that bypassed add-time Layer-1 rejection).
//!
//! Contract:
//! - `MeshFile::parse` is a pure text→struct transform, so a poisoned mesh
//!   stays loadable and repairable.
//! - `stale`/`doctor` surface the interior anchor per-mesh as a loud,
//!   actionable report, while still reporting other (clean) meshes — one
//!   poisoned mesh never blanks the whole corpus.
//! - `remove`/`delete` repair the poisoned mesh; `stale --fix` does NOT
//!   silently no-op (it excises the offending anchor); `show`/`list` operate.

mod support;

use anyhow::Result;
use support::TestRepo;

const POISON_HASH: &str =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// Seed a repo with one CLEAN mesh and one POISONED mesh (carrying a
/// mesh-root-interior anchor), both committed. Returns the repo.
fn repo_with_poisoned_and_clean_mesh() -> Result<TestRepo> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\nline3\n")?;
    repo.commit_all("seed source")?;

    // Clean mesh authored the supported way.
    let out = repo.run_mesh(["add", "clean/flow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "seeding clean mesh failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Poisoned mesh: hand-written with an anchor inside `.mesh`.
    repo.write_file(
        ".mesh/poison",
        &format!(".mesh/clean/flow {POISON_HASH}\n\nSmuggled a mesh document as an anchor.\n"),
    )?;
    repo.commit_all("commit clean + poisoned meshes")?;
    repo.write_commit_graph()?;
    Ok(repo)
}

#[test]
fn stale_surfaces_poison_per_mesh_without_blanking_clean_mesh() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_mesh()?;

    // Make the clean mesh drift so stale has something to report for it too.
    repo.write_file("src/lib.rs", "line1\nCHANGED\nline3\n")?;

    let out = repo.run_mesh(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "stale must exit non-zero with a poisoned mesh present;\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    // Poison surfaced, actionably, naming file/anchor/root/fix.
    assert!(
        stderr.contains("interior-anchor"),
        "report header missing; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(".mesh/poison"),
        "report must name the mesh file; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains("git mesh remove poison .mesh/clean/flow"),
        "report must name a working repair command; stderr:\n{stderr}"
    );
    // The clean mesh's drift is still reported on stdout — not blanked.
    assert!(
        stdout.contains("clean/flow"),
        "clean mesh must still be reported; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
fn doctor_surfaces_poison_per_mesh() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_mesh()?;

    let out = repo.run_mesh(["doctor"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        !out.status.success(),
        "doctor must exit non-zero when an interior anchor is present;\nstdout:\n{stdout}"
    );
    assert!(
        stdout.contains(".mesh/poison") && stdout.contains("git mesh remove poison"),
        "doctor must name the poisoned mesh and a working fix; stdout:\n{stdout}"
    );
    Ok(())
}

#[test]
fn remove_repairs_poisoned_mesh() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_mesh()?;

    let out = repo.run_mesh(["remove", "poison", ".mesh/clean/flow"])?;
    assert!(
        out.status.success(),
        "remove must drop the offending anchor;\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    // The interior anchor is gone — doctor reports no interior violation now.
    let doctor = repo.run_mesh(["doctor"])?;
    let dout = String::from_utf8_lossy(&doctor.stdout);
    assert!(
        !dout.contains(".mesh/clean/flow"),
        "interior anchor must be gone after remove; doctor stdout:\n{dout}"
    );
    Ok(())
}

#[test]
fn delete_succeeds_on_poisoned_mesh() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_mesh()?;

    let out = repo.run_mesh(["delete", "poison"])?;
    assert!(
        out.status.success(),
        "delete must remove the whole poisoned mesh;\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    let list = repo.run_mesh(["list"])?;
    let lout = String::from_utf8_lossy(&list.stdout);
    assert!(
        list.status.success(),
        "list must operate after delete;\nstderr:\n{}",
        String::from_utf8_lossy(&list.stderr)
    );
    assert!(
        !lout.contains("poison"),
        "deleted poisoned mesh must not appear in list; stdout:\n{lout}"
    );
    Ok(())
}

#[test]
fn stale_fix_does_not_silently_noop_on_poisoned_mesh() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_mesh()?;

    let _ = repo.run_mesh(["stale", "--fix"])?;

    // --fix must ACT — never silently skip. The offending anchor line must
    // have been excised from the worktree mesh file.
    let contents = std::fs::read_to_string(repo.path().join(".mesh/poison"))?;
    assert!(
        !contents.contains(".mesh/clean/flow"),
        "stale --fix must excise the interior anchor (not silently no-op); mesh file now:\n{contents}"
    );
    Ok(())
}

#[test]
fn list_operates_with_poisoned_mesh_present() -> Result<()> {
    let repo = repo_with_poisoned_and_clean_mesh()?;

    let out = repo.run_mesh(["list"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success(),
        "list must operate despite a poisoned mesh;\nstderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // Both meshes still enumerated — one poison does not blank the corpus.
    assert!(
        stdout.contains("clean/flow") && stdout.contains("poison"),
        "list must enumerate both meshes; stdout:\n{stdout}"
    );
    Ok(())
}
