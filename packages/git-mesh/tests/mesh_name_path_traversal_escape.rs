//! Reproduction: path-traversal guard missing in `delete_mesh_in`.
//!
//! `delete_mesh_in` (structural.rs:27-38) joins the mesh name onto the mesh
//! root without verifying the resolved path stays within the mesh root.
//! A name containing `../` resolves outside `.mesh/`, allowing deletion of
//! files that happen to be parseable as mesh files.
//!
//! `validate_mesh_name` rejects `..` in names, but `delete_mesh_in` never
//! calls it, unlike `run_add` and `run_remove`.
//!
//! This test MUST FAIL against the current unfixed code. After a
//! path-containment guard is added to `delete_mesh_in`, the command will
//! reject traversal names and this test will pass.

mod support;

use anyhow::Result;
use support::TestRepo;

#[test]
fn delete_mesh_path_traversal_escapes_mesh_root() -> Result<()> {
    let repo = TestRepo::seeded()?;

    // A legitimate mesh to confirm the mesh root is active.
    repo.run_mesh(["add", "test-mesh", "file1.txt#L1-L5"])?;

    // Create a file outside .mesh/ that is mesh-parseable.
    //
    // delete_mesh_in calls read_effective(name) first (structural.rs:29),
    // which attempts to parse the target content as a MeshFile.  We choose
    // content that parses successfully so the read check does not mask the
    // deeper issue — the lack of path-containment verification.
    repo.write_file(
        "escape-file",
        "dummy rk64:0000000000000000\n\npath-traversal test\n",
    )?;

    // The delete command builds `workdir/.mesh/<name>` (structural.rs:32)
    // without checking whether the resolved path stays under `.mesh/`.
    // A name containing `../` resolves outside the mesh root.
    //
    // This MUST be rejected with a non-zero exit.  The current (unfixed)
    // code exits 0 and deletes the outside file — this assertion FAILS.
    let out = repo.run_mesh(["delete", "../escape-file"])?;
    assert!(
        !out.status.success(),
        "delete with `../escape-file` should be rejected (non-zero exit), \
         but got exit {:?}; stderr:\n{}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr),
    );

    Ok(())
}
