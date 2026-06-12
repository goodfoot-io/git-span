//! CLI: `git mesh stale --fix` content-equivalence gate.
//!
//! `--fix` must re-anchor only anchors whose change preserves the anchored
//! content — `Moved` (bytes identical, relocated) and whitespace/formatting
//! -equivalent `Changed` edits. A `Changed` anchor whose *meaningful*
//! (non-whitespace) bytes differ must be left drifting so the coupling
//! resurfaces for confirmation. Card main-90.

use crate::support;

use anyhow::Result;
use git_mesh_core::{cheap_fingerprint_with_extent, rk64_to_hex};
use support::TestRepo;

fn read_mesh(repo: &TestRepo, name: &str) -> Result<String> {
    let path = repo.path().join(".mesh").join(name);
    Ok(std::fs::read_to_string(path)?)
}

fn line_slice_hash(text: &str, start: u32, end: u32) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let lo = (start as usize).saturating_sub(1);
    let hi = (end as usize).min(lines.len());
    let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
    rk64_to_hex(cheap_fingerprint_with_extent(
        slice.join("\n").as_bytes(),
        &git_mesh_core::AnchorExtent::WholeFile,
    ))
}

fn seed_mesh(repo: &TestRepo, name: &str, anchor: &str, why: &str) -> Result<()> {
    repo.mesh_stdout(["add", name, anchor])?;
    repo.mesh_stdout(["why", name, "-m", why])?;
    repo.run_git(["add", ".mesh"])?;
    repo.run_git(["commit", "-m", "mesh commit"])?;
    Ok(())
}

const ORIGINAL: &str =
    "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";

/// Reproduction (must FAIL before the fix): a meaning-changing worktree edit
/// to one anchored line must leave the anchor drifting after `--fix`. Today
/// `--fix` re-hashes every `Changed` anchor, silently rewriting the recorded
/// hash to the broken content and reporting the mesh fresh.
#[test]
fn fix_leaves_meaning_changed_worktree_anchor_drifting() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    let original_hash = line_slice_hash(ORIGINAL, 1, 5);

    // Meaning-changing edit (non-whitespace): rename a token in line 1.
    let changed =
        "lineONE\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", changed)?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let changed_hash = line_slice_hash(changed, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{original_hash}")),
        "meaning-changed anchor must keep its original recorded hash; got:\n{mesh}"
    );
    assert!(
        !mesh.contains(&changed_hash),
        "meaning-changed anchor must NOT be re-anchored to the broken content; got:\n{mesh}"
    );

    // And the drift must still surface.
    let out = repo.run_mesh(["stale", "m"])?;
    assert_eq!(
        out.status.code(),
        Some(1),
        "mesh must still report stale after --fix; stdout=\n{}",
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}

/// Regression guard (must stay GREEN): a whitespace-only worktree edit at an
/// anchored line is content-equivalent and must still be re-anchored and
/// cleared by `--fix` — its original, legitimate purpose.
#[test]
fn fix_reanchors_whitespace_only_worktree_change() -> Result<()> {
    let repo = TestRepo::seeded()?;
    seed_mesh(&repo, "m", "file1.txt#L1-L5", "why")?;

    // Whitespace-only edit: reindent line 1. Equivalent under normalization.
    let reindented =
        "    line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n";
    repo.write_file("file1.txt", reindented)?;

    repo.run_mesh(["stale", "--fix", "--no-exit-code"])?;

    let mesh = read_mesh(&repo, "m")?;
    let new_hash = line_slice_hash(reindented, 1, 5);
    assert!(
        mesh.contains(&format!("file1.txt#L1-L5 rk64:{new_hash}")),
        "whitespace-only change must be re-anchored to the current content; got:\n{mesh}"
    );

    let out = repo.run_mesh(["stale", "m"])?;
    assert_eq!(
        out.status.code(),
        Some(0),
        "whitespace-only change must report fresh after --fix; stdout=\n{}",
        String::from_utf8_lossy(&out.stdout)
    );
    Ok(())
}
