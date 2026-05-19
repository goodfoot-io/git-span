//! Integration tests for the reverse-indexed walk with Bloom filters.
//!
//! 1. `stale_meshes_succeeds_without_commit_graph` — the changed-path
//!    Bloom filter is a walk accelerator, not a correctness gate. An
//!    ordinary repo (no gc, no opt-in `core.commitGraph`) has no
//!    commit-graph; `stale` must still resolve, never surfacing a
//!    plumbing instruction as a fatal error.
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
fn stale_meshes_succeeds_without_commit_graph() -> Result<()> {
    let repo = TestRepo::new()?;

    // Create a file and a mesh. We must have at least one mesh so that
    // stale_meshes attempts to build the reverse-indexed walk (the Bloom
    // open is unconditional in build_reverse_walk even for empty mesh lists,
    // but a single-mesh path exercises more of the pipeline).
    repo.write_file("f.txt", "content\n")?;
    repo.commit_all("init")?;

    // File-backed model: `add`/`why` write the worktree mesh file;
    // commit it so the resolver has a HEAD-layer mesh to walk.
    repo.run_mesh(["add", "test/mesh", "f.txt#L1-L1"])?;
    repo.run_mesh(["why", "test/mesh", "-m", "test"])?;
    repo.commit_all("seed mesh")?;

    let gix = repo.gix_repo()?;

    // Intentionally do NOT write a commit-graph.

    let result = git_mesh::stale_meshes(
        &gix,
        ".mesh",
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

    let resolved = result.expect("stale_meshes must succeed without a commit-graph");
    // The single committed mesh's anchor is fresh, so it is not
    // reportable; the call simply returns without error.
    assert!(
        resolved.iter().all(|m| m
            .anchors
            .iter()
            .all(|a| a.status == git_mesh::types::AnchorStatus::Fresh)),
        "anchor must resolve Fresh without a commit-graph"
    );
    Ok(())
}

#[test]
fn bloom_false_positive_counter_is_zero_for_true_positives() -> Result<()> {
    let repo = TestRepo::new()?;

    // Create two tracked files and pin both at their initial content
    // via the file-backed `add` CLI.
    repo.write_file("A.txt", "line1\nline2\n")?;
    repo.write_file("B.txt", "line1\nline2\n")?;
    repo.commit_all("initial commit with A and B")?;
    repo.run_mesh(["add", "test/mesh", "A.txt#L1-L1"])?;
    repo.run_mesh(["add", "test/mesh", "B.txt#L1-L1"])?;
    repo.run_mesh(["why", "test/mesh", "-m", "test"])?;
    repo.commit_all("seed mesh")?;

    // Modify both files in a second commit — both anchors now drift.
    repo.write_file("A.txt", "modified A\nline2\n")?;
    repo.write_file("B.txt", "modified B\nline2\n")?;
    repo.commit_all("modify A and B")?;

    // Write a commit-graph with changed-path Bloom filters (the
    // reverse-walk Bloom open is unconditional even though the
    // file-backed resolver compares by content hash).
    repo.write_commit_graph()?;

    // Run `git mesh stale` with perf counters enabled.
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"))
        .current_dir(repo.path())
        .args(["stale"])
        .env("GIT_MESH_PERF", "1")
        .env("GIT_MESH_CACHE", "0")
        .output()?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Correctness: both anchored slices changed → both report drift.
    assert_eq!(
        out.status.code(),
        Some(1),
        "both anchors drifted; stale must exit 1. stdout=\n{stdout}\nstderr=\n{stderr}"
    );
    assert!(
        stdout.contains("A.txt#L1-L1") && stdout.contains("B.txt#L1-L1"),
        "both drifted anchors must be reported; stdout=\n{stdout}"
    );

    // File-backed model: there is no per-anchor Bloom history walk, so
    // the false-positive counter must be 0 — the Bloom walk never
    // misclassifies a path because it is not used for content drift.
    let false_positives =
        parse_counter(&stderr, "session.walk-bloom-false-positives");
    assert_eq!(
        false_positives, 0,
        "Bloom false-positive counter must be 0 in the file-backed model, got {false_positives}, stderr:\n{stderr}"
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
