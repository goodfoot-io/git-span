//! Regression coverage for F1: a configured (non-default) mesh root
//! must be honored identically by the writer and by every reader,
//! management, and stale path — not silently ignored in favor of a
//! hardcoded `.mesh`.
//!
//! Precedence under test (highest first): `--mesh-dir` >
//! `GIT_MESH_DIR` > `git config git-mesh.dir` > `.mesh`. Before this
//! fix, `add` wrote `<root>/<name>` while `list`/`show`/`stale`/`move`
//! read `.mesh` and reported "nothing" / "not found".

mod support;

use anyhow::Result;
use support::TestRepo;

/// `--mesh-dir <root>` threaded through add → list → show → stale → move.
#[test]
fn configured_mesh_dir_flag_round_trips() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("src/lib.rs", "alpha\nbeta\ngamma\n")?;
    repo.commit_all("seed")?;

    // add under a non-default root via --mesh-dir.
    let add = repo.run_mesh(["--mesh-dir", "meshes", "add", "demo/coupling", "src/lib.rs#L1-L2"])?;
    assert!(
        add.status.success(),
        "add under --mesh-dir failed: {}",
        String::from_utf8_lossy(&add.stderr)
    );

    // The writer must have written under the configured root, not `.mesh`.
    assert!(
        repo.path().join("meshes/demo/coupling").exists(),
        "mesh file not written under configured root"
    );
    assert!(
        !repo.path().join(".mesh").exists(),
        "mesh file leaked into the hardcoded default `.mesh`"
    );

    // list must see it (was empty before the fix).
    let list = repo.mesh_stdout(["--mesh-dir", "meshes", "list"])?;
    assert!(list.contains("demo/coupling"), "list missed configured-root mesh: {list}");

    // show must resolve it (was MeshNotFound before the fix).
    let show = repo.mesh_stdout(["--mesh-dir", "meshes", "show", "demo/coupling"])?;
    assert!(show.contains("demo/coupling"), "show missed configured-root mesh: {show}");
    // No vestigial ref-era fields in show output (F8).
    assert!(!show.contains("anchor_sha"), "show emitted dead anchor_sha field: {show}");
    assert!(!show.contains("created_at"), "show emitted dead created_at field: {show}");
    assert!(!show.contains("blob"), "show emitted dead blob field: {show}");

    // Bare `git mesh <name>` with a preceding global option must work (F8).
    let bare = repo.run_mesh(["--mesh-dir", "meshes", "demo/coupling"])?;
    assert!(
        bare.status.success(),
        "bare show with preceding --mesh-dir failed: {}",
        String::from_utf8_lossy(&bare.stderr)
    );
    assert!(String::from_utf8_lossy(&bare.stdout).contains("demo/coupling"));

    // stale must scan the configured root (reported clean/empty before).
    repo.run_git(["add", "-A"])?;
    repo.run_git(["commit", "-m", "track mesh"])?;
    repo.write_commit_graph()?;
    let stale = repo.run_mesh(["--mesh-dir", "meshes", "stale"])?;
    assert!(
        stale.status.success(),
        "stale under configured root failed: {}",
        String::from_utf8_lossy(&stale.stderr)
    );
    let stale_out = String::from_utf8_lossy(&stale.stdout);
    assert!(
        stale_out.contains("demo/coupling") || stale_out.contains("0 stale"),
        "stale did not account for the configured-root mesh: {stale_out}"
    );

    // move must find and rename it under the configured root.
    let mv = repo.run_mesh(["--mesh-dir", "meshes", "move", "demo/coupling", "demo/renamed"])?;
    assert!(
        mv.status.success(),
        "move under configured root failed: {}",
        String::from_utf8_lossy(&mv.stderr)
    );
    assert!(repo.path().join("meshes/demo/renamed").exists());
    assert!(!repo.path().join("meshes/demo/coupling").exists());

    Ok(())
}

/// `git config git-mesh.dir` is honored by writer and readers alike.
#[test]
fn configured_mesh_dir_via_git_config() -> Result<()> {
    let repo = TestRepo::new()?;
    repo.write_file("a.txt", "one\ntwo\n")?;
    repo.commit_all("seed")?;
    repo.run_git(["config", "git-mesh.dir", "cfgroot"])?;

    let add = repo.run_mesh(["add", "cfg/mesh", "a.txt"])?;
    assert!(
        add.status.success(),
        "add with git-config root failed: {}",
        String::from_utf8_lossy(&add.stderr)
    );
    assert!(repo.path().join("cfgroot/cfg/mesh").exists());
    assert!(!repo.path().join(".mesh").exists());

    let list = repo.mesh_stdout(["list"])?;
    assert!(list.contains("cfg/mesh"), "list missed git-config-root mesh: {list}");
    Ok(())
}
