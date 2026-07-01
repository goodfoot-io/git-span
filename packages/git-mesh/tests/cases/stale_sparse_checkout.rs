//! Reproduction test: `git mesh stale` must emit `ContentUnavailable(SparseExcluded)`
//! for anchors whose index entry has the skip-worktree flag (sparse-checkout
//! exclusion) rather than reporting them as `Changed` or `Deleted`.
//!
//! ## The bug
//!
//! `resolve_anchor_inner()` in `anchor.rs` reads the worktree file via
//! `read_worktree_normalized()` which returns empty bytes for missing files;
//! the empty-content check then classifies the anchor as `Deleted` (the
//! `current_lines.len() < anchored_start` branch at line 883).  The
//! skip-worktree bit is never inspected anywhere in the pipeline — not in
//! the diff collection, not in the engine, and not in `anchor.rs`.
//!
//! ## Expected fix locus
//!
//! In `anchor.rs`, after the deepest layer's content is resolved but before
//! the status classification, check the index entry's `skip-worktree` flag
//! and emit `ContentUnavailable(SparseExcluded)` when set.  The `diff.rs`
//! `collect_index_worktree_changes` function could also skip or annotate
//! skip-worktree entries so the engine never reaches the empty-content path.
//!
//! ## Test design
//!
//! 1. Create a git repo with a file in a subdirectory.
//! 2. Commit the file, anchor it with `git mesh add`, commit the mesh.
//! 3. Enable sparse-checkout (non-cone mode) to exclude the anchored file
//!    but keep `.mesh/` accessible.
//! 4. Run `git mesh stale --format=json`.
//! 5. Assert the finding status is `CONTENT_UNAVAILABLE` with reason
//!    `SPARSE_EXCLUDED`.
//!
//! This test MUST FAIL against the current unfixed code, which reports
//! `DELETED` (via the empty-content branch) because the skip-worktree flag
//! is never inspected anywhere in the read/diff/resolve pipeline.

use crate::support;
use anyhow::Result;
use serde_json::Value;
use support::TestRepo;

#[test]
fn sparse_checkout_excluded_reports_content_unavailable() -> Result<()> {
    let repo = TestRepo::new()?;

    // Create a file in a subdirectory so sparse-checkout can exclude it
    // while keeping the .mesh/ directory in the root.
    repo.write_file("src/data.txt", "line1\nline2\nline3\nline4\nline5\n")?;
    repo.commit_all("add data file")?;
    repo.write_commit_graph()?;

    // Anchor src/data.txt with git mesh add (line-range anchor).
    repo.mesh_stdout(["add", "m", "src/data.txt#L1-L3"])?;
    repo.mesh_stdout(["why", "m", "-m", "sparse test"])?;
    repo.commit_all("mesh commit")?;
    repo.write_commit_graph()?;

    // Enable sparse-checkout in non-cone mode, keeping only .mesh/.
    // This excludes src/data.txt from the worktree (sets skip-worktree
    // in the index, removes the file from disk).  Non-cone mode avoids
    // sparse-index conversion so gix can still iterate all entries.
    repo.run_git(["sparse-checkout", "set", "--no-cone", ".mesh"])?;

    // Sanity: the anchored file is gone from the worktree.
    assert!(
        !repo.path().join("src/data.txt").exists(),
        "sparse-checkout should have removed src/data.txt from the worktree"
    );

    // Sanity: the mesh file is still readable (it matches .mesh/).
    assert!(
        repo.path().join(".mesh/m").exists(),
        ".mesh/m must still be on disk after sparse-checkout"
    );

    // Run stale -- this SHOULD report SPARSE_EXCLUDED against the fixed code.
    // It MUST FAIL against the current unfixed code (which reports CHANGED).
    let out = repo.run_mesh(["stale", "m", "--format=json"])?;
    let v: Value = serde_json::from_slice(&out.stdout)?;

    let findings = v["findings"].as_array().expect("findings array");
    assert_eq!(
        findings.len(),
        1,
        "expected exactly one finding (src/data.txt), got: {v}"
    );

    let f = &findings[0];

    // === THIS BLOCK MUST FAIL against the current unfixed code ===
    // The bug: read_worktree_normalized() returns empty bytes for the
    // sparse-excluded file, and the empty-content check at line 883
    // classifies it as DELETED instead of CONTENT_UNAVAILABLE.
    assert_eq!(
        f["status"]["code"],
        "CONTENT_UNAVAILABLE",
        "sparse-excluded anchor should be CONTENT_UNAVAILABLE, got status.code={}",
        f["status"]["code"]
    );
    assert_eq!(
        f["status"]["reason"],
        "SPARSE_EXCLUDED",
        "reason should be SPARSE_EXCLUDED, got: {}",
        f["status"]["reason"]
    );

    // Sanity check: the status_code string also matches in porcelain form.
    // (JSON already verified the structured form above.)
    assert_eq!(
        f["anchored"]["path"], "src/data.txt",
        "finding should reference the anchored path"
    );

    Ok(())
}
