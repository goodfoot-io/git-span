//! Reproduction for main-106: `git mesh list` must load the full mesh
//! corpus exactly once per invocation regardless of target count.
//!
//! `run_list` currently loads the corpus twice via `load_all_meshes_in`:
//! once in `resolve_targets` (via `MeshPathIndex::load_in`) and once in
//! `collect_listings_for_names` (or `collect_listings` / its variant).
//! Additionally `conflicted_mesh_names_in` scans every mesh via
//! `read_effective`. On repos with many meshes or large mesh files this
//! is a multiplicative cost.
//!
//! After the fix, a single `load_all_meshes_in` at the top of `run_list`
//! feeds target resolution, conflict detection, and listing collection
//! from the same in-memory corpus — the `mesh.load-all-corpus` perf span
//! must be emitted exactly once even when targets are passed.

mod support;

use anyhow::Result;
use std::process::{Command, Stdio};
use support::TestRepo;

/// Seed a repo with several meshes, each anchored to its own file, so the
/// corpus has multiple entries to enumerate and the multi-load cost is
/// observable in the perf-span count.
fn seed_meshes(repo: &TestRepo, count: usize) -> Result<Vec<String>> {
    let mut names = Vec::with_capacity(count);
    for i in 0..count {
        let path = format!("f{i}.txt");
        repo.write_file(&path, &format!("file {i} content\nl2\nl3\nl4\nl5\n"))?;
        repo.commit_all(&format!("add {path}"))?;
        let mesh = format!("mesh{i}");
        repo.mesh_stdout(["add", &mesh, &format!("{path}#L1-L5")])?;
        repo.mesh_stdout(["why", &mesh, "-m", "seed"])?;
        repo.commit_all(&format!("mesh: {mesh}"))?;
        names.push(mesh);
    }
    Ok(names)
}

fn count_lines_containing(haystack: &str, needle: &str) -> usize {
    haystack.lines().filter(|l| l.contains(needle)).count()
}

/// The corpus-load span (`mesh.load-all-corpus`) must be emitted exactly
/// once for a `git mesh list <targets...>` invocation, regardless of how
/// many meshes exist or how many targets are passed.
#[test]
fn list_loads_corpus_once_with_targets() -> Result<()> {
    let repo = TestRepo::seeded()?;

    let names = seed_meshes(&repo, 5)?;

    // Pass every mesh name as a positional target so `resolve_targets`
    // runs and calls `MeshPathIndex::load_in` → `load_all_meshes_in`,
    // and `collect_listings_for_names` calls `load_all_meshes_in` again.
    let mut args: Vec<&str> = vec!["--perf", "list"];
    let name_strs: Vec<String> = names.iter().map(|n| n.to_string()).collect();
    for n in &name_strs {
        args.push(n.as_str());
    }

    let output = Command::new(env!("CARGO_BIN_EXE_git-mesh"))
        .current_dir(repo.path())
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()?;

    let stderr = String::from_utf8(output.stderr)?;
    assert!(
        output.status.success(),
        "git mesh list failed: {stderr}"
    );

    let load_spans = count_lines_containing(&stderr, "mesh.load-all-corpus");
    assert_eq!(
        load_spans,
        1,
        "corpus must be loaded exactly once per invocation: expected \
         one `mesh.load-all-corpus` span, got {load_spans}.\n\
         --- perf stderr ---\n\
         {stderr}"
    );
    Ok(())
}
