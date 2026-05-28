//! Reproduction for main-81: `git mesh list --porcelain --batch` must
//! enumerate the mesh catalog once for the whole batch, not once per
//! input path.
//!
//! The batch loop in `run_list_batch_porcelain` calls
//! `collect_filtered_porcelain_listings_with_staging` per stdin path,
//! which calls `load_all_meshes_in` — a full catalog enumeration wrapped
//! in the `list.path-filter-scan` perf span. Reading the catalog once
//! and filtering the shared catalog per path makes total work scale as
//! O(meshes + paths) instead of O(meshes × paths).
//!
//! This test asserts the catalog-enumeration span is emitted exactly
//! once regardless of input-path count — the verbatim expected behavior
//! from the card ("`list.path-filter-scan` work is performed once for
//! the batch").

mod support;

use anyhow::Result;
use std::io::Write;
use std::process::{Command, Stdio};
use support::TestRepo;

/// Seed a repo with several meshes, each anchored to its own file, so the
/// catalog has multiple entries to enumerate.
fn seed_meshes(repo: &TestRepo, count: usize) -> Result<Vec<String>> {
    let mut paths = Vec::with_capacity(count);
    for i in 0..count {
        // Distinct names and content so each commit stages a real change —
        // `file1.txt`/`file2.txt` already exist from `seeded()`.
        let path = format!("anchored{i}.txt");
        repo.write_file(&path, &format!("anchor file {i}\nl2\nl3\nl4\nl5\n"))?;
        repo.commit_all(&format!("add {path}"))?;
        let mesh = format!("mesh{i}");
        repo.mesh_stdout(["add", &mesh, &format!("{path}#L1-L5")])?;
        repo.mesh_stdout(["why", &mesh, "-m", "seed"])?;
        repo.commit_all(&format!("mesh: {mesh}"))?;
        paths.push(path);
    }
    Ok(paths)
}

/// Run `git-mesh --perf list --porcelain --batch` with `paths` on stdin,
/// returning (stdout, stderr).
fn run_batch_perf(repo: &TestRepo, paths: &[String]) -> Result<(String, String)> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_git-mesh"))
        .current_dir(repo.path())
        .args(["--perf", "list", "--porcelain", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    {
        let stdin = child.stdin.as_mut().expect("stdin piped");
        for p in paths {
            writeln!(stdin, "{p}")?;
        }
    }

    let out = child.wait_with_output()?;
    Ok((
        String::from_utf8(out.stdout)?,
        String::from_utf8(out.stderr)?,
    ))
}

fn count_lines_containing(haystack: &str, needle: &str) -> usize {
    haystack.lines().filter(|l| l.contains(needle)).count()
}

/// The catalog-enumeration span (`list.path-filter-scan`) must be emitted
/// once for the whole batch, no matter how many input paths are fed.
#[test]
fn batch_porcelain_scans_catalog_once_regardless_of_path_count() -> Result<()> {
    let repo = TestRepo::seeded()?;
    let mesh_paths = seed_meshes(&repo, 5)?;

    // Feed many input paths — each existing mesh path repeated so every
    // query matches and exercises the per-path filter. Far more paths than
    // meshes, so a per-path catalog scan is loudly visible in the count.
    let mut input: Vec<String> = Vec::new();
    for _ in 0..4 {
        input.extend(mesh_paths.iter().cloned());
    }
    assert!(
        input.len() >= 20,
        "want many input paths, got {}",
        input.len()
    );

    let (_stdout, stderr) = run_batch_perf(&repo, &input)?;

    let scan_spans = count_lines_containing(&stderr, "list.path-filter-scan");
    assert_eq!(
        scan_spans,
        1,
        "catalog enumeration must be amortized across the batch: expected \
         exactly one `list.path-filter-scan` span for {} input paths, got \
         {scan_spans}.\n--- perf stderr ---\n{stderr}",
        input.len()
    );
    Ok(())
}
