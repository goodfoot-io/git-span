//! CLI: `git mesh stale --fix` mid-merge — both drifted anchors on the same
//! file must be rewritten in a single pass, even when `.git/MERGE_HEAD` is
//! present.  Regression test for the bug where the second anchor's in-memory
//! record lookup silently misses (stale_fix.rs L664-L674), leaving the
//! `.mesh` file on disk inconsistent with the human-readable diagnostic.
//!
//! Reproduction scenario (from card main-136):
//! 1. Seed `f.js` with two functions (`parse` at L1-L3, `serialize` at
//!    L4-L6), mesh both, commit.
//! 2. Branch `feature`, insert a comment line at the top of `f.js`, commit.
//! 3. Back on `main`, insert a *different* comment line at the top, commit.
//! 4. `git merge feature` — conflicts in `f.js`.  `.mesh/parse/pair` is
//!    untouched (no conflict markers).
//! 5. Resolve `f.js` (keep both comment lines), `git add f.js` — but do
//!    **not** commit the merge (`.git/MERGE_HEAD` present).
//! 6. Run `git mesh stale --fix` and check the `.mesh` file on disk.
//! 7. Re-run `--fix` and verify byte-identical output (stuck).
//! 8. Commit the merge, run `--fix` again — both anchors fix now.

use crate::support;
use anyhow::Result;
use support::TestRepo;

fn read_mesh(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".mesh").join(name);
    Ok(std::fs::read_to_string(path)?)
}

/// Initial 6-line `f.js` content.
const ORIGINAL: &str = "\
function parse() {
  return 1;
}
function serialize() {
  return 2;
}
";

#[test]
fn fix_rewrites_both_anchors_mid_merge() -> Result<()> {
    let repo = TestRepo::new()?;

    // ---- set up ----
    repo.write_file("f.js", ORIGINAL)?;
    repo.commit_all("initial commit")?;

    // Mesh both anchors.
    repo.mesh_stdout(["add", "parse/pair", "f.js#L1-L3", "f.js#L4-L6"])?;
    repo.mesh_stdout(["why", "parse/pair", "-m", "parse/serialize inverse pair"])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;

    // ---- create divergent branches ----
    // Feature branch: insert a comment line at the top.
    let feature_content = "\
// feature change
function parse() {
  return 1;
}
function serialize() {
  return 2;
}
";
    repo.run_git(["checkout", "-b", "feature"])?;
    repo.write_file("f.js", feature_content)?;
    repo.commit_all("feature: add comment")?;

    // Back on main: insert a *different* comment line.
    let main_content = "\
// main change
function parse() {
  return 1;
}
function serialize() {
  return 2;
}
";
    repo.run_git(["checkout", "main"])?;
    repo.write_file("f.js", main_content)?;
    repo.commit_all("main: add comment")?;

    // ---- merge (expect conflict in f.js) ----
    let merge_out = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "--no-edit", "feature"])
        .output()?;
    assert!(
        !merge_out.status.success(),
        "git merge must produce conflicts in f.js"
    );

    // ---- resolve f.js: keep both comment lines ----
    let resolved = "\
// main change
// feature change
function parse() {
  return 1;
}
function serialize() {
  return 2;
}
";
    repo.write_file("f.js", resolved)?;
    repo.run_git(["add", "f.js"])?;

    // MERGE_HEAD is still present (merge not committed).

    // ---- run stale --fix mid-merge ----
    let out = repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    let mesh = read_mesh(&repo, "parse/pair")?;

    // Both anchors **must** be rewritten in one pass.
    //
    //   parse function:     f.js#L1-L3  -->  f.js#L3-L5
    //   serialize function: f.js#L4-L6  -->  f.js#L6-L8
    //
    // The second assertion (`f.js#L6-L8`) will **FAIL** against the current
    // unfixed code because the lookup at stale_fix.rs L664-L674 silently
    // misses the second anchor's record mid-merge, leaving the old stale
    // extent on disk while the diagnostic reports it as "moved to L6-L8".
    assert!(
        mesh.contains("f.js#L3-L5"),
        "first anchor must be updated to L3-L5;\nmesh:\n{mesh}\nstdout:\n{stdout}\nstderr:\n{stderr}",
    );
    assert!(
        mesh.contains("f.js#L6-L8"),
        "second anchor must be updated to L6-L8;\nmesh:\n{mesh}\nstdout:\n{stdout}\nstderr:\n{stderr}",
    );

    // Old stale extents must be gone.
    assert!(
        !mesh.contains("f.js#L1-L3 "),
        "old L1-L3 anchor must be removed;\nmesh:\n{mesh}",
    );
    assert!(
        !mesh.contains("f.js#L4-L6 "),
        "old L4-L6 anchor must be removed;\nmesh:\n{mesh}",
    );

    // ---- verify no stale anchors on re-run ----
    // After the first --fix corrected both anchors, a second --fix should
    // find zero stale anchors. Coalescing may normalize adjacent Fresh
    // line ranges into a single wider range, so the mesh file may not be
    // byte-identical — but it must not still be stale.
    let out2 = repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;
    let stdout2 = String::from_utf8_lossy(&out2.stdout);
    let mesh_after_rerun = read_mesh(&repo, "parse/pair")?;
    assert!(
        !mesh_after_rerun.contains("f.js#L4-L6 "),
        "stale L4-L6 must be gone after re-run;\nmesh:\n{mesh_after_rerun}\nstdout:\n{stdout2}",
    );
    assert!(
        !stdout2.contains("moved to"),
        "re-run must not report any moved anchors;\nstdout:\n{stdout2}",
    );

    // ---- finish the merge ----
    repo.run_git(["commit", "-m", "finish merge"])?;

    // ---- verify post-merge state is fully fresh ----
    let out3 = repo.run_mesh(["stale", "--fix"])?;
    let stdout3 = String::from_utf8_lossy(&out3.stdout);
    assert!(
        stdout3.contains("0 stale"),
        "post-merge must report 0 stale;\nstdout:\n{stdout3}",
    );

    Ok(())
}
