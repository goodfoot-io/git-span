//! Seeded, deterministic corpus generator for benchmarks.
//!
//! This module is gated behind the `bench-corpus` Cargo feature so it is
//! never included in the default or release build.  Both the
//! `bench-corpus-gen` binary and the `size_sweep` benchmark enable the
//! feature via `required-features`.
//!
//! # Determinism
//!
//! Given the same `seed` and `mesh_count`, `generate` always produces
//! byte-identical commits (same SHAs).  This requires:
//! - File contents derived purely from `seed` + per-mesh index (no rand/time).
//! - All six git identity/date env vars pinned on every commit.
//!
//! # Content hashes
//!
//! Hashes are computed via `git_mesh::types::sha256_hex` on the actual
//! anchored bytes — the same approach used by `tests/support/mod.rs`'s
//! `create_and_commit_mesh`.  No placeholder hashes.

#[cfg(feature = "bench-corpus")]
use std::path::Path;
#[cfg(feature = "bench-corpus")]
use std::process::Command;

/// Generate a deterministic git repository at `dir` containing `mesh_count`
/// meshes.
///
/// # Arguments
///
/// * `dir` — the directory (must already exist) that will become a git repo.
/// * `seed` — a 64-bit seed that drives all file content.  Same seed →
///   same content → same commit SHAs.
/// * `mesh_count` — how many meshes (and source files) to create.
/// * `with_commit_graph` — when `true`, runs
///   `git commit-graph write --reachable --changed-paths` after all commits.
///
/// # Errors
///
/// Returns an error if any git command fails or any file I/O fails.
#[cfg(feature = "bench-corpus")]
pub fn generate(
    dir: &Path,
    seed: u64,
    mesh_count: usize,
    with_commit_graph: bool,
) -> anyhow::Result<()> {
    // -----------------------------------------------------------------------
    // Helper: run a git command in `dir`, fail on non-zero exit.
    // -----------------------------------------------------------------------
    let git = |args: &[&str]| -> anyhow::Result<()> {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()?;
        anyhow::ensure!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(())
    };

    // Helper: run a git commit with all six identity/date env vars pinned so
    // the resulting commit SHA is fully reproducible regardless of machine
    // git config.
    let git_commit = |msg: &str| -> anyhow::Result<()> {
        let out = Command::new("git")
            .current_dir(dir)
            .args(["commit", "-m", msg])
            .env("GIT_AUTHOR_DATE", "2024-01-01T00:00:00+00:00")
            .env("GIT_COMMITTER_DATE", "2024-01-01T00:00:00+00:00")
            .env("GIT_AUTHOR_NAME", "Bench")
            .env("GIT_AUTHOR_EMAIL", "bench@example.com")
            .env("GIT_COMMITTER_NAME", "Bench")
            .env("GIT_COMMITTER_EMAIL", "bench@example.com")
            .output()?;
        anyhow::ensure!(
            out.status.success(),
            "git commit {:?} failed: {}",
            msg,
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(())
    };

    // -----------------------------------------------------------------------
    // Init repo with a stable identity so commits work without global config.
    // -----------------------------------------------------------------------
    git(&["init", "--initial-branch=main"])?;
    git(&["config", "user.name", "Bench"])?;
    git(&["config", "user.email", "bench@example.com"])?;
    git(&["config", "commit.gpgsign", "false"])?;

    // -----------------------------------------------------------------------
    // Create source files — content is derived from (seed XOR mesh_index).
    // Each file gets LINES_PER_FILE lines; each line is deterministic.
    // -----------------------------------------------------------------------
    const LINES_PER_FILE: u32 = 20;

    for i in 0..mesh_count {
        let file_seed = seed ^ (i as u64).wrapping_mul(0x9e3779b97f4a7c15);
        let filename = format!("file_{i}.txt");
        let mut buf = String::new();
        for ln in 0..LINES_PER_FILE {
            let val = file_seed
                .wrapping_add(ln as u64)
                .wrapping_mul(0x6364136223846793);
            buf.push_str(&format!("line{ln}_{val:016x}\n"));
        }
        std::fs::write(dir.join(&filename), &buf)?;
    }

    git(&["add", "-A"])?;
    git_commit("seed: source files")?;

    // -----------------------------------------------------------------------
    // Create .mesh/ directory and one mesh file per source file.
    // Each mesh anchors lines 1-5 of its source file with a real content hash.
    // -----------------------------------------------------------------------
    let mesh_dir = dir.join(".mesh");
    std::fs::create_dir_all(&mesh_dir)?;

    for i in 0..mesh_count {
        let filename = format!("file_{i}.txt");
        let bytes = std::fs::read(dir.join(&filename))?;

        // Hash lines 1-5 (indices 0-4): join with \n, no trailing newline.
        // This matches the exact approach in tests/support/mod.rs::create_and_commit_mesh.
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text.lines().collect();
        let lo = 0usize;
        let hi = 5usize.min(lines.len());
        let slice = if lo < hi { &lines[lo..hi] } else { &[][..] };
        let hashed: Vec<u8> = slice.join("\n").into_bytes();
        let hash = format!("sha256:{}", crate::types::sha256_hex(&hashed));

        let mf = crate::mesh_file::MeshFile {
            anchors: vec![crate::mesh_file::AnchorRecord {
                path: filename.clone(),
                start_line: 1,
                end_line: 5,
                algorithm: "rk64".into(),
                content_hash: hash,
            }],
            why: format!("bench mesh {i}"),
        };

        let mesh_name = format!("mesh-{i}");
        std::fs::write(mesh_dir.join(&mesh_name), mf.serialize())?;
    }

    git(&["add", ".mesh"])?;
    git_commit("seed: meshes")?;

    // -----------------------------------------------------------------------
    // Optionally build commit-graph with Bloom filters.
    // Without --changed-paths the graph-present variant still tree-diffs
    // every commit, making both variants identical under sweep.
    // -----------------------------------------------------------------------
    if with_commit_graph {
        git(&["commit-graph", "write", "--reachable", "--changed-paths"])?;
    }

    Ok(())
}
