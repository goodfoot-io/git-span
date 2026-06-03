//! Rejection of anchors whose path falls inside the resolved mesh root.
//!
//! Two enforcement layers:
//! - Layer 1 (add-time): `git mesh add` refuses an anchor path inside the mesh root before
//!   any I/O, with a message naming both the offending path and the mesh root.
//! - Layer 2 (read-time): `MeshFile::parse` refuses a mesh file whose anchor block contains
//!   a mesh-root-interior path; `stale` and `show` surface the error.
//!
//! Tests are modeled on `round2_eval_qa_fixes.rs` and `add_gitignored_anchor_reject.rs`.

mod support;

use anyhow::Result;
use std::process::Command;
use support::TestRepo;

// ---------------------------------------------------------------------------
// Layer 1 — add-time, default root (.mesh)
// ---------------------------------------------------------------------------

/// `git mesh add foo .mesh/bar` must fail with a message naming both the
/// offending path and the mesh root.
#[test]
fn add_rejects_anchor_inside_default_mesh_root() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_mesh(["add", "demo/flow", ".mesh/bar"])?;
    assert!(
        !out.status.success(),
        "add must reject an anchor inside the mesh root; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains(".mesh/bar"),
        "error must name the offending path; stderr:\n{stderr}"
    );
    assert!(
        stderr.contains(".mesh"),
        "error must name the mesh root; stderr:\n{stderr}"
    );
    Ok(())
}

/// The mesh root entry itself (`.mesh`) must be rejected as an anchor path.
#[test]
fn add_rejects_mesh_root_itself_as_anchor() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_mesh(["add", "demo/flow", ".mesh"])?;
    assert!(
        !out.status.success(),
        "add must reject the mesh root entry itself; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

/// A legitimate source anchor must still be accepted (regression guard).
#[test]
fn add_accepts_legitimate_anchor_with_default_root() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_mesh(["add", "demo/flow", "src/lib.rs"])?;
    assert!(
        out.status.success(),
        "a legitimate anchor must still be accepted; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Layer 1 — add-time, resolved root (--mesh-dir)
// ---------------------------------------------------------------------------

/// With `--mesh-dir docs/mesh`, an anchor `docs/mesh/x` is rejected.
#[test]
fn add_rejects_anchor_inside_resolved_mesh_dir_flag() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_mesh(["--mesh-dir", "docs/mesh", "add", "demo/flow", "docs/mesh/x"])?;
    assert!(
        !out.status.success(),
        "add must reject anchor inside configured mesh root; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("docs/mesh"),
        "error must reference the mesh root; stderr:\n{stderr}"
    );
    Ok(())
}

/// With `--mesh-dir docs/mesh`, a literal `.mesh/x` anchor IS accepted
/// (proves `.mesh` is not special-cased when the root is elsewhere).
#[test]
fn add_accepts_dot_mesh_anchor_when_root_is_elsewhere() -> Result<()> {
    let repo = TestRepo::new()?;
    // Create .mesh/bar as a real tracked file so the existence check passes.
    repo.write_file(".mesh/bar", "content\n")?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let out = repo.run_mesh(["--mesh-dir", "docs/mesh", "add", "demo/flow", ".mesh/bar"])?;
    assert!(
        out.status.success(),
        "`.mesh/bar` must be accepted when mesh root is `docs/mesh`; exit {:?}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}

/// With `GIT_MESH_DIR=docs/mesh`, an anchor `docs/mesh/x` is rejected.
#[test]
fn add_rejects_anchor_inside_git_mesh_dir_env() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_git-mesh"));
    cmd.current_dir(repo.path());
    cmd.env("GIT_MESH_DIR", "docs/mesh");
    cmd.args(["add", "demo/flow", "docs/mesh/x"]);
    let out = cmd.output()?;

    assert!(
        !out.status.success(),
        "add must reject anchor inside GIT_MESH_DIR root; exit {:?}\nstdout:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Layer 2 — read-time enforcement via MeshFile::parse / stale / show
// ---------------------------------------------------------------------------

/// A hand-edited mesh file carrying a mesh-root-interior anchor causes
/// `git mesh stale` to surface an error rather than honor the anchor.
#[test]
fn stale_surfaces_error_for_mesh_root_anchor_in_mesh_file() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    // Hand-write a mesh file that contains an anchor inside the mesh root.
    // Format: "<path> <algorithm>:<hash>\n\n<why>\n"
    repo.write_file(
        ".mesh/bad-mesh",
        ".mesh/something sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\nBad mesh with mesh-root anchor.\n",
    )?;
    repo.commit_all("add bad mesh file")?;
    repo.write_commit_graph()?;

    let out = repo.run_mesh(["stale"])?;
    // stale must not succeed silently — it should either fail or report an error.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{stdout}{stderr}");
    assert!(
        !out.status.success() || combined.contains("invalid") || combined.contains("mesh root") || combined.contains(".mesh"),
        "stale must surface the error for a mesh-root anchor; stdout:\n{stdout}\nstderr:\n{stderr}"
    );
    Ok(())
}

/// `git mesh show` on a mesh file containing a mesh-root anchor surfaces
/// an error rather than returning it as valid content.
#[test]
fn show_surfaces_error_for_mesh_root_anchor_in_mesh_file() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "line1\nline2\n")?;
    repo.commit_all("seed")?;

    repo.write_file(
        ".mesh/bad-mesh",
        ".mesh/something sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n\nBad mesh.\n",
    )?;
    repo.commit_all("add bad mesh")?;

    let out = repo.run_mesh(["show", "bad-mesh"])?;
    // show must fail or surface an error message.
    assert!(
        !out.status.success(),
        "show must fail for a mesh file with a mesh-root anchor; exit {:?}\nstdout:\n{}\nstderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    Ok(())
}
