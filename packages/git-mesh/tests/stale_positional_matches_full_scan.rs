//! CLI: `git mesh stale <path>` must mirror the full-scan visibility
//! contract established by main-84 (`ac81e6c`).
//!
//! main-84 inverted the default Human renderer: a full workspace scan now
//! lists *every* committed mesh — including entirely-clean ones — so
//! operators see the shape of what they carry, while machine formats (JSON,
//! porcelain, …) continue to filter clean meshes down to drift findings.
//!
//! The positional `stale <path>` branch must match that contract: Human
//! shows every path-resolved mesh (clean and drifted alike), but machine
//! formats must not surface a clean mesh. The leak this suite reproduces is
//! the JSON envelope's top-level `mesh` field, which is `meshes.first()`:
//! when a clean path-resolved mesh sorts ahead of the drifted one, the
//! machine envelope names the clean mesh — a clean-mesh leak the full-scan
//! JSON path never produces.

mod support;

use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

/// Build a fixture where, for `file1.txt`, the path index resolves two
/// meshes:
///   * `clean-mesh` — anchors `aaa.txt#L1-L5` and `file1.txt#L6-L10`; both
///     stay Fresh under `drift`. The `aaa.txt` anchor makes its sorted path
///     tuple `[aaa.txt, file1.txt]`, which sorts ahead of `drifted-mesh`'s
///     `[file1.txt]`, so `clean-mesh` becomes `meshes.first()`.
///   * `drifted-mesh` — anchors `file1.txt#L1-L5`; drifts when line 1 is
///     edited.
fn seed_fixture(repo: &TestRepo) -> Result<()> {
    // A file that sorts before file1.txt, anchored only by the clean mesh.
    repo.write_file("aaa.txt", "a1\na2\na3\na4\na5\n")?;
    repo.run_git(["add", "aaa.txt"])?;
    repo.run_git(["commit", "-m", "add aaa.txt"])?;

    repo.mesh_stdout(["add", "clean-mesh", "aaa.txt#L1-L5", "file1.txt#L6-L10"])?;
    repo.mesh_stdout(["why", "clean-mesh", "-m", "clean across two files"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "clean-mesh commit"])?;

    repo.mesh_stdout(["add", "drifted-mesh", "file1.txt#L1-L5"])?;
    repo.mesh_stdout(["why", "drifted-mesh", "-m", "will drift"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "drifted-mesh commit"])?;
    Ok(())
}

/// File-backed drift: edit line 1 of file1.txt in the working tree. Only
/// `drifted-mesh`'s L1-L5 anchor drifts; `clean-mesh`'s L6-L10 and the
/// `aaa.txt` anchor stay Fresh.
fn drift(repo: &TestRepo) -> Result<()> {
    repo.write_file(
        "file1.txt",
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    )?;
    Ok(())
}

/// Precondition (main-84 contract): the full-scan Human view lists the clean
/// mesh alongside the drifted one.
#[test]
fn full_scan_human_lists_clean_and_drifted() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_mesh(["stale"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("drifted-mesh"),
        "full-scan Human must list the drifted mesh; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("clean-mesh"),
        "full-scan Human must list the clean mesh (main-84 contract); stdout=\n{stdout}"
    );
    Ok(())
}

/// Positional Human mirrors the full-scan Human view: every path-resolved
/// mesh appears, clean or drifted.
#[test]
fn positional_human_lists_clean_and_drifted() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_mesh(["stale", "file1.txt"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("drifted-mesh"),
        "positional Human must list the drifted mesh; stdout=\n{stdout}"
    );
    assert!(
        stdout.contains("clean-mesh"),
        "positional Human must list the clean mesh, matching full-scan; stdout=\n{stdout}"
    );
    Ok(())
}

/// Positional JSON filters clean meshes: the envelope must name the drifted
/// mesh, never the clean one. This is the leak the card targets — a clean
/// path-resolved mesh that sorts first surfaces as `meshes.first()` in the
/// JSON envelope.
#[test]
fn positional_json_drops_clean_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_mesh(["stale", "file1.txt", "--format=json"])?;
    assert_eq!(out.status.code(), Some(1), "drift present → exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let v: Value = serde_json::from_slice(&out.stdout).expect("valid json");
    assert_eq!(
        v["mesh"], "drifted-mesh",
        "JSON envelope must name the drifted mesh, not a clean one; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("clean-mesh"),
        "positional JSON must not mention the clean mesh; stdout=\n{stdout}"
    );
    Ok(())
}

/// Positional porcelain carries only drift findings — no clean mesh.
#[test]
fn positional_porcelain_drops_clean_mesh() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_mesh(["stale", "file1.txt", "--format=porcelain"])?;
    assert_eq!(out.status.code(), Some(1), "drift present → exit 1");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("file1.txt"),
        "porcelain must report the drifted anchor; stdout=\n{stdout}"
    );
    assert!(
        !stdout.contains("clean-mesh"),
        "positional porcelain must not mention the clean mesh; stdout=\n{stdout}"
    );
    Ok(())
}

/// A direct mesh-name request is always exempt: `stale clean-mesh` renders
/// the clean mesh's Human block even though it is fully Fresh. The
/// machine-format filter must not strip an explicitly-named mesh.
#[test]
fn direct_named_clean_mesh_renders_in_human() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_fixture(&repo)?;
    drift(&repo)?;
    let out = repo.run_mesh(["stale", "clean-mesh"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("## clean-mesh"),
        "explicitly-named clean mesh must render its block; stdout=\n{stdout}"
    );
    assert_eq!(out.status.code(), Some(0), "named clean mesh → exit 0");
    Ok(())
}
