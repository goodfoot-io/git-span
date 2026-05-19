//! Delete / move / doctor handlers — file-backed model.

use crate::cli::{CliError, DeleteArgs, DoctorArgs, MoveArgs, NextStep};
use crate::cli::format::{DESTRUCTIVE_TAG, IDEMPOTENT_TAG};
use crate::{delete_mesh, list_mesh_names, rename_mesh};
use anyhow::Result;

pub fn run_delete(repo: &gix::Repository, args: DeleteArgs) -> Result<i32> {
    delete_mesh(repo, &args.name).map_err(|e| CliError {
        subcommand: "delete",
        summary: format!("cannot delete `{}`.", args.name),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git mesh list".into())],
    })?;
    println!("Deleted `{}`.{}", args.name, DESTRUCTIVE_TAG);
    println!();
    println!("Run `git mesh list` to confirm the mesh is gone, then commit the change.");
    Ok(0)
}

pub fn run_move(repo: &gix::Repository, args: MoveArgs) -> Result<i32> {
    rename_mesh(repo, &args.old, &args.new).map_err(|e| CliError {
        subcommand: "move",
        summary: format!("cannot rename `{}` to `{}`.", args.old, args.new),
        what_happened: e.to_string(),
        next_steps: vec![NextStep::Bash("git mesh list".into())],
    })?;
    println!("Renamed `{}` to `{}`.{}", args.old, args.new, DESTRUCTIVE_TAG);
    println!();
    println!("Run `git mesh {}` to verify the rename, then commit the change.", args.new);
    Ok(0)
}

pub fn run_doctor(repo: &gix::Repository, args: DoctorArgs) -> Result<i32> {
    // File-backed model: meshes are ordinary tracked files. The only
    // health check that remains is that every visible mesh parses.
    let names = list_mesh_names(repo).unwrap_or_default();
    let n_meshes = names.len();
    let mut findings: Vec<String> = Vec::new();
    for name in &names {
        if let Err(e) = crate::read_mesh(repo, name) {
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
