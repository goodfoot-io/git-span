//! Delete / move / doctor handlers — file-backed model.

use crate::cli::{CliError, DeleteArgs, DoctorArgs, MoveArgs, NextStep};
use crate::cli::format::{DESTRUCTIVE_TAG, IDEMPOTENT_TAG};
use crate::mesh::read::list_mesh_names_in;
use crate::mesh::structural::{delete_mesh_in, rename_mesh_in};
use anyhow::Result;

/// Prune now-empty parent directories of a removed mesh file, walking up
/// from the deepest segment toward — but never including or past — the
/// mesh root. A hierarchical mesh name like `bulk/foo` leaves an empty
/// `<root>/bulk/` directory once its last mesh is removed; that empty
/// shell is noise in `git status` and the worktree, so collapse it.
///
/// Best-effort: a non-empty directory (another mesh still lives under it)
/// stops the walk, and any I/O error simply ends pruning without failing
/// the command — the mesh removal itself already succeeded.
fn prune_empty_parents(repo: &gix::Repository, mesh_root: &str, name: &str) {
    let Some(workdir) = repo.workdir() else {
        return;
    };
    let root = workdir.join(mesh_root);
    // The mesh file lived at `<root>/<name>`; start at its parent.
    let mut dir = root.join(name);
    while dir.pop() {
        // Stop before removing the mesh root itself or escaping above it.
        if dir == root || !dir.starts_with(&root) {
            break;
        }
        // `remove_dir` only succeeds on an empty directory; a populated
        // parent (sibling mesh present) ends the walk.
        if std::fs::remove_dir(&dir).is_err() {
            break;
        }
    }
}

pub fn run_delete(repo: &gix::Repository, args: DeleteArgs, mesh_root: &str) -> Result<i32> {
    delete_mesh_in(repo, &args.name, mesh_root).map_err(|e| CliError {
        subcommand: "delete",
        summary: format!("cannot delete `{}`.", args.name),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git mesh list".into())],
    })?;
    prune_empty_parents(repo, mesh_root, &args.name);
    println!("Deleted `{}`.{}", args.name, DESTRUCTIVE_TAG);
    println!();
    println!("Run `git mesh list` to confirm the mesh is gone, then commit the change.");
    Ok(0)
}

pub fn run_move(repo: &gix::Repository, args: MoveArgs, mesh_root: &str) -> Result<i32> {
    rename_mesh_in(repo, &args.old, &args.new, mesh_root).map_err(|e| CliError {
        subcommand: "move",
        summary: format!("cannot rename `{}` to `{}`.", args.old, args.new),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git mesh list".into())],
    })?;
    prune_empty_parents(repo, mesh_root, &args.old);
    println!("Renamed `{}` to `{}`.{}", args.old, args.new, DESTRUCTIVE_TAG);
    println!();
    println!("Run `git mesh {}` to verify the rename, then commit the change.", args.new);
    Ok(0)
}

pub fn run_doctor(repo: &gix::Repository, args: DoctorArgs, mesh_root: &str) -> Result<i32> {
    // File-backed model: meshes are ordinary tracked files. The only
    // health check that remains is that every visible mesh parses.
    let names = list_mesh_names_in(repo, mesh_root).unwrap_or_default();
    let n_meshes = names.len();
    let mut findings: Vec<String> = Vec::new();
    for name in &names {
        if let Err(e) = crate::mesh::read::read_mesh_in(repo, name, mesh_root) {
            findings.push(format!("mesh `{name}` failed to parse: {e}"));
        }
    }

    if findings.is_empty() {
        println!("mesh doctor: {n_meshes} meshes checked, no findings.{IDEMPOTENT_TAG}");
        return Ok(0);
    }

    println!("# mesh doctor");
    println!();
    println!("{n_meshes} meshes checked, {} findings.", findings.len());
    println!();
    println!("## Findings");
    println!();
    for f in &findings {
        println!("- ERROR — {f}");
    }

    if args.strict {
        return Err(CliError {
            subcommand: "doctor",
            summary: format!("{} finding(s) reported.", findings.len()),
            what_happened: "One or more mesh files could not be parsed.".into(),
            next_steps: vec![NextStep::Prose("Fix the malformed mesh files.".into())],
        }
        .into());
    }
    Ok(1)
}
