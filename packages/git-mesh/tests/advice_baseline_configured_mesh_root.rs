//! Regression test for R2-B: `git mesh advice` baseline snapshot must honour
//! the configured mesh root, not silently fall back to the hardcoded `.mesh`.
//!
//! When a repo uses a non-default mesh root (set via `--mesh-dir`), the
//! `ensure_mesh_baseline` call inside `run_advice_mark` / `run_advice_diff` /
//! `run_advice_flush` / `run_advice_touch` / `run_advice_read` must load meshes
//! from that root. Before the fix those functions called `load_all_meshes` (which
//! hardcodes `.mesh`), so the baseline was always empty under a configured root —
//! causing every subsequent diff to report "no changes" and every read to surface
//! spurious "new mesh" advice.

mod support;

use anyhow::Result;
use std::process::Output;
use support::TestRepo;
use uuid::Uuid;

fn sid(label: &str) -> String {
    format!("baseline-root-{label}-{}", Uuid::new_v4())
}

fn mesh_args(root: &str, session: &str, extra: &[&str]) -> Vec<String> {
    let mut v: Vec<String> = vec!["--mesh-dir".into(), root.into(), "advice".into(), session.into()];
    for a in extra {
        v.push((*a).into());
    }
    v
}

fn ok(out: &Output, ctx: &str) {
    assert!(
        out.status.success(),
        "{ctx} failed (code={:?}): {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr),
    );
}

/// Write a minimal mesh file under `<root>/<name>` in the repo's work-tree,
/// stage it, and commit.  No anchors are required for the baseline fingerprint
/// to be non-empty — the `why` field contributes.
fn write_commit_mesh_in_root(repo: &TestRepo, root: &str, name: &str, why: &str) -> Result<()> {
    use std::fs;
    let dir = repo.path().join(root);
    if let Some(p) = dir.join(name).parent() {
        fs::create_dir_all(p)?;
    }

    // Format: one anchor line, blank line, why text.
    // Anchor format: `<path>#L<start>-L<end> <algorithm>:<hex>`
    let content = format!(
        "file1.txt#L1-L5 sha256:aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899\n\n{why}\n"
    );
    fs::write(dir.join(name), &content)?;

    let rel = format!("{root}/{name}");
    let out = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["add", &rel])
        .output()?;
    assert!(out.status.success(), "git add failed: {}", String::from_utf8_lossy(&out.stderr));
    let out = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["commit", "-m", &format!("add mesh {name}")])
        .output()?;
    assert!(out.status.success(), "git commit failed: {}", String::from_utf8_lossy(&out.stderr));
    Ok(())
}

// ---------------------------------------------------------------------------
// Test: baseline under a non-default mesh root is non-empty after mark
// ---------------------------------------------------------------------------

/// With `--mesh-dir mymeshes`, after `advice mark` the baseline snapshot must
/// reflect the mesh that exists under `mymeshes/`, not the empty `.mesh` dir.
/// A subsequent `advice diff` must therefore report the mesh as *unchanged*
/// (baseline matches current state), not as *new* (baseline was empty).
#[test]
fn advice_baseline_captures_configured_root() -> Result<()> {
    let root = "mymeshes";
    let repo = TestRepo::seeded()?;

    // Commit a mesh under the configured root (not under .mesh).
    write_commit_mesh_in_root(&repo, root, "pair/alpha", "alpha pair")?;

    // Session 1: mark establishes baseline; diff immediately after should show
    // no newly-committed meshes (mesh existed before the session started).
    let s = sid("s1");
    let mark_out = repo.run_mesh(mesh_args(root, &s, &["mark", "t1"]))?;
    ok(&mark_out, "mark");

    let diff_out = repo.run_mesh(mesh_args(root, &s, &["diff", "t1"]))?;
    ok(&diff_out, "diff");
    let diff_stdout = String::from_utf8(diff_out.stdout)?;
    // The diff detects meshes whose fingerprint changed since the mark.
    // Since the mesh existed before the mark, the diff result should be empty
    // (the mesh is already in the baseline — not "new").
    assert!(
        diff_stdout.trim().is_empty(),
        "diff after mark must not report pre-existing mesh as new when using \
         configured root; got: {diff_stdout:?}"
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// Test: pre-session mesh under configured root is NOT treated as "new" in read
// ---------------------------------------------------------------------------

/// When a mesh exists under `custom-meshes/` before the session starts, a
/// `read` on a file in that mesh must be silent (the mesh is a prior-session
/// mesh, not a same-session commit).
///
/// Before the fix: `ensure_mesh_baseline` loaded from `.mesh` (empty) so the
/// mesh had no baseline entry → `discover_meshes_committed_this_session`
/// classified it as new → `read` emitted spurious advice.
///
/// After the fix: the baseline is populated from `custom-meshes/` → the mesh
/// fingerprint matches the baseline → it is NOT added to meshes-committed →
/// `read` is silent.
#[test]
fn pre_session_mesh_under_configured_root_is_silent_on_read() -> Result<()> {
    let custom_root = "custom-meshes";
    let repo = TestRepo::seeded()?;

    // Commit a mesh under the configured root before the session starts.
    write_commit_mesh_in_root(&repo, custom_root, "prior/beta", "beta prior")?;

    let s = sid("s2");

    // mark → establishes baseline (must include prior/beta from custom-meshes)
    let mark = repo.run_mesh(mesh_args(custom_root, &s, &["mark", "t1"]))?;
    ok(&mark, "mark");

    // diff → calls record_touches → discover_meshes_committed_this_session.
    // With a correct baseline, prior/beta must NOT appear in meshes-committed.
    let diff = repo.run_mesh(mesh_args(custom_root, &s, &["diff", "t1"]))?;
    ok(&diff, "diff");

    // read on file1.txt (anchored by prior/beta) must be silent because
    // prior/beta is not a same-session commit.
    let read = repo.run_mesh(mesh_args(custom_root, &s, &["read", "file1.txt#L1-L5"]))?;
    ok(&read, "read");
    let read_stdout = String::from_utf8(read.stdout)?;
    assert!(
        read_stdout.trim().is_empty(),
        "read on pre-session mesh under configured root must be silent; \
         got advice: {read_stdout:?}"
    );

    Ok(())
}
