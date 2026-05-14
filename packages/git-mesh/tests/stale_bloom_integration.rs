//! Integration tests for the reverse-indexed walk with Bloom filters.
//!
//! 1. `stale_meshes_fails_without_commit_graph` — verifies the fail-closed
//!    path when no commit-graph exists.
//! 2. `bloom_false_positive_counter_is_zero_for_true_positives` — verifies
//!    that the walk_bloom_false_positives counter is 0 when every tracked
//!    path was actually changed in the commit (deterministic assertion —
//!    the counter only increments for paths Bloom said "maybe" about that
//!    the tree-diff showed unchanged).

mod support;

use anyhow::Result;
use git_mesh::types::{EngineOptions, LayerSet};
use support::TestRepo;

#[test]
fn stale_meshes_fails_without_commit_graph() -> Result<()> {
    let repo = TestRepo::new()?;

    // Create a file and a mesh. We must have at least one mesh so that
    // stale_meshes attempts to build the reverse-indexed walk (the Bloom
    // open is unconditional in build_reverse_walk even for empty mesh lists,
    // but a single-mesh path exercises more of the pipeline).
    repo.write_file("f.txt", "content\n")?;
    repo.commit_all("init")?;
    let anchor_sha = repo.head_sha()?;

    let gix = repo.gix_repo()?;
    git_mesh::append_add(&gix, "test/mesh", "f.txt", 1, 1, Some(&anchor_sha))?;
    git_mesh::set_why(&gix, "test/mesh", "test")?;
    git_mesh::commit_mesh(&gix, "test/mesh")?;

    // Intentionally do NOT write a commit-graph.

    let result = git_mesh::stale_meshes(
        &gix,
        EngineOptions {
            layers: LayerSet {
                index: false,
                worktree: false,
                staged_mesh: false,
            },
            since: None,
            ignore_unavailable: false,
            needs_all_layers: false,
        },
    );

    assert!(result.is_err(), "stale_meshes should fail without commit-graph");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("commit-graph") || err_msg.contains("commit graph"),
        "error message should mention commit-graph, got: {err_msg}"
    );
    Ok(())
}

#[test]
fn bloom_false_positive_counter_is_zero_for_true_positives() -> Result<()> {
    let repo = TestRepo::new()?;

    // Create two tracked files.
    repo.write_file("A.txt", "line1\nline2\n")?;
    repo.write_file("B.txt", "line1\nline2\n")?;
    repo.commit_all("initial commit with A and B")?;
    let anchor_sha = repo.head_sha()?;

    // Modify both files in a second commit.
    repo.write_file("A.txt", "modified A\nline2\n")?;
    repo.write_file("B.txt", "modified B\nline2\n")?;
    repo.commit_all("modify A and B")?;

    // Set up a mesh anchoring A.txt and B.txt at their initial versions.
    let gix = repo.gix_repo()?;
    git_mesh::append_add(&gix, "test/mesh", "A.txt", 1, 1, Some(&anchor_sha))?;
    git_mesh::append_add(&gix, "test/mesh", "B.txt", 1, 1, Some(&anchor_sha))?;
    git_mesh::set_why(&gix, "test/mesh", "test")?;
    git_mesh::commit_mesh(&gix, "test/mesh")?;

    // Write a commit-graph with changed-path Bloom filters so the
    // reverse-indexed walk can use Bloom gating.
    repo.write_commit_graph()?;

    // Run `git mesh stale` with perf counters enabled.
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"))
        .current_dir(repo.path())
        .args(["stale"])
        .env("GIT_MESH_PERF", "1")
        .env("GIT_MESH_CACHE", "0")
        .output()?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    let false_positives = parse_counter(&stderr, "session.walk-bloom-false-positives");

    assert_eq!(
        false_positives, 0,
        "expected 0 false positives when all tracked paths changed, got {false_positives}, stderr:\n{stderr}"
    );

    // Also verify basic sanity: some commits were visited and Bloom skipped
    // at least one (the initial commit's paths are not in HEAD's Bloom).
    // HEAD's commit modified A.txt and B.txt, so its Bloom says "maybe"
    // for those and neither was skipped.
    let tree_diffs = parse_counter(&stderr, "session.walk-tree-diffs");
    assert!(
        tree_diffs >= 1,
        "expected at least 1 tree-diff (HEAD commit), got {tree_diffs}, stderr:\n{stderr}"
    );

    Ok(())
}

fn parse_counter(stderr: &str, label: &str) -> u64 {
    for line in stderr.lines() {
        if let Some(rest) = line.strip_prefix("git-mesh perf: ")
            && let Some(value_str) = rest.strip_prefix(&format!("{label} "))
            && let Ok(v) = value_str.trim().parse::<u64>()
        {
            return v;
        }
    }
    0
}
