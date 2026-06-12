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

use crate::support;

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

/// `git mesh stale <filepath>` where the mesh anchoring `<filepath>` ALSO
/// carries an interior anchor must surface the violation and exit non-zero,
/// matching the behavior of bare `stale` and mesh-name-form `stale`.
///
/// Regression guard for the literal `p == &v.mesh_name` compare that silently
/// dropped in-scope interior violations when the arg was a file path rather than
/// a mesh name.
#[test]
fn scoped_stale_by_filepath_surfaces_interior_violation() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\nline3\n")?;
    repo.commit_all("seed source")?;

    // Create a legitimate mesh that anchors src/lib.rs.
    let out = repo.run_mesh(["add", "my/flow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "seeding mesh failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // Hand-inject an interior anchor into that same mesh file, simulating a
    // bypass of the add-time Layer-1 check. The mesh file format is:
    //   <anchor-line>+\n\n<why>\n
    // Read the file, split at the blank line, prepend the interior anchor to
    // the anchors section, then rejoin.
    let mesh_path = repo.path().join(".mesh/my/flow");
    let current = std::fs::read_to_string(&mesh_path)?;
    // Split on first blank line (anchors / why separator).
    let (anchors_section, why_section) = current
        .split_once("\n\n")
        .expect("mesh file must contain blank-line separator");
    let poisoned = format!(
        "{anchors_section}\n.mesh/my/flow {POISON_HASH}\n\n{why_section}"
    );
    std::fs::write(&mesh_path, &poisoned)?;
    repo.commit_all("inject interior anchor into my/flow")?;
    repo.write_commit_graph()?;

    // Scoped by file path — the mesh my/flow anchors src/lib.rs.
    let out = repo.run_mesh(["stale", "src/lib.rs"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    assert!(
        !out.status.success(),
        "`git mesh stale src/lib.rs` must exit non-zero when in-scope mesh carries interior anchor;\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        stderr.contains("interior-anchor"),
        "interior-anchor report header must appear; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(".mesh/my/flow") || stderr.contains("my/flow"),
        "report must identify the mesh with the interior anchor; stderr:\n{stderr}"
    );

    // Mesh-name-form must behave identically (regression guard: this already worked).
    let out2 = repo.run_mesh(["stale", "my/flow"])?;
    let stderr2 = String::from_utf8_lossy(&out2.stderr);
    assert!(
        !out2.status.success(),
        "`git mesh stale my/flow` must also exit non-zero; stderr:\n{stderr2}"
    );
    assert!(
        stderr2.contains("interior-anchor"),
        "mesh-name-form stale must report interior anchor; stderr:\n{stderr2}"
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
