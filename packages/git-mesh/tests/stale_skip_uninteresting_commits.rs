//! Integration test for the file-backed resolver's commit-walk cost on
//! a repo with many noise commits where only a handful touch the
//! anchored path. The file-backed model identifies anchored content by
//! `stored_hash`, so resolution does *not* perform an `anchor..HEAD`
//! history walk at all — it compares the current content hash directly.
//! This is strictly cheaper than the old Bloom-filtered per-anchor walk.
//!
//! The test asserts:
//! 1. Correctness: the untouched anchor (lines 1-5) resolves `Fresh`.
//! 2. Cost: the resolve performs (near) zero tree-diffs — no history
//!    walk is needed in the file-backed model.

mod support;

use anyhow::Result;
use git_mesh::resolve_mesh;
use git_mesh::types::{AnchorStatus, EngineOptions, LayerSet};
use support::TestRepo;

#[test]
fn most_commits_skipped_when_path_untouched() -> Result<()> {
    let repo = TestRepo::new()?;
    // Anchor file with 20 lines.
    let mut content = String::new();
    for i in 1..=20 {
        content.push_str(&format!("anchored_{i}\n"));
    }
    repo.write_file("anchored.txt", &content)?;
    repo.commit_all("init anchored")?;

    // Pin lines 1-5 via the file-backed `add` CLI (hashes the current
    // slice). Commit the mesh file alongside the source.
    repo.run_mesh(["add", "demo/mesh", "anchored.txt#L1-L5"])?;
    repo.run_mesh(["why", "demo/mesh", "-m", "demo"])?;
    repo.commit_all("seed mesh")?;

    // 50 unrelated commits that don't touch anchored.txt.
    for i in 0..50 {
        repo.write_file(&format!("noise/{i}.txt"), &format!("n{i}\n"))?;
        repo.commit_all(&format!("noise {i}"))?;
    }

    // A commit that edits anchored.txt *outside* the anchored range
    // (line 15). The 1-5 anchor must remain Fresh.
    repo.write_file(
        "anchored.txt",
        &content.replace("anchored_15\n", "anchored_15_edited\n"),
    )?;
    repo.commit_all("edit anchored.txt outside anchor range")?;

    let gix = repo.gix_repo()?;

    // Write a commit-graph with changed-path Bloom filters so the
    // reverse-indexed walk can use Bloom gating. Must be done after
    // the mesh commit so the mesh ref is included in `--reachable`.
    repo.write_commit_graph()?;

    let resolved = resolve_mesh(
        &gix,
        "demo/mesh",
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
    )?;

    assert_eq!(resolved.anchors.len(), 1);
    let anchor = &resolved.anchors[0];
    // The lines we anchored (1-5) were untouched — still Fresh.
    assert_eq!(anchor.status, AnchorStatus::Fresh);

    // File-backed model: resolution compares the current content hash
    // against `stored_hash` — it does not walk `anchor..HEAD` history,
    // so the noise commits cost nothing. Confirm via the perf counters
    // that (near) zero tree-diffs ran across the 50+ commit history.
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_git-mesh"))
        .current_dir(repo.path())
        .args(["stale"])
        .env("GIT_MESH_PERF", "1")
        .env("GIT_MESH_CACHE", "0")
        .output()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let tree_diffs = parse_counter(&stderr, "session.walk-tree-diffs");
    assert!(
        tree_diffs <= 5,
        "file-backed resolution must not history-walk the noise commits, got tree_diffs={} stderr=\n{}",
        tree_diffs,
        stderr,
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
