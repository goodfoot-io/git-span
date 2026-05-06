//! `git mesh fetch` / `git mesh push` — §7.

use crate::cli::{CliError, NextStep};
use crate::cli::format;
use crate::sync::{default_remote, fetch_mesh_refs, push_mesh_refs};
use crate::cli::{FetchArgs, PushArgs};
use crate::types::Error;
use anyhow::Result;

pub fn run_fetch(repo: &gix::Repository, args: FetchArgs) -> Result<i32> {
    let remote = match args.remote {
        Some(r) => r,
        None => default_remote(repo)?,
    };
    match fetch_mesh_refs(repo, &remote) {
        Ok(()) => {
            println!("Fetched mesh refs from `{remote}`.{}", format::IDEMPOTENT_TAG);
            println!();
            println!("Run `git mesh list` to see updated meshes.");
            Ok(0)
        }
        Err(e) => Err(match e {
            Error::RemoteNotFound { remote: r } => anyhow::Error::from(CliError {
                subcommand: "fetch",
                summary: "no remote is configured.".into(),
                what_happened: format!(
                    "`mesh.defaultRemote` is unset and there is no remote named `{r}`."
                ),
                next_steps: vec![
                    NextStep::Prose("Set a default, or pass one explicitly:".into()),
                    NextStep::Bash(
                        "git config mesh.defaultRemote upstream\ngit mesh fetch upstream".into(),
                    ),
                ],
            }),
            other => anyhow::Error::from(crate::cli::error::from_lib_error(
                "fetch",
                format!("{other}"),
                &other,
                vec![NextStep::Prose(
                    "Check that the remote exists and is accessible.".into(),
                )],
            )),
        }),
    }
}

pub fn run_push(repo: &gix::Repository, args: PushArgs) -> Result<i32> {
    let remote = match args.remote {
        Some(r) => r,
        None => default_remote(repo)?,
    };
    match push_mesh_refs(repo, &remote) {
        Ok(()) => {
            println!(
                "Pushed mesh refs to `{remote}`.{}",
                format::IDEMPOTENT_TAG
            );
            Ok(0)
        }
        Err(e) => Err(match e {
            Error::RemoteNotFound { remote: r } => anyhow::Error::from(CliError {
                subcommand: "push",
                summary: "no remote is configured.".into(),
                what_happened: format!(
                    "`mesh.defaultRemote` is unset and there is no remote named `{r}`."
                ),
                next_steps: vec![
                    NextStep::Prose("Set a default, or pass one explicitly:".into()),
                    NextStep::Bash(
                        "git config mesh.defaultRemote upstream\ngit mesh push upstream".into(),
                    ),
                ],
            }),
            other => anyhow::Error::from(crate::cli::error::from_lib_error(
                "push",
                format!("{other}"),
                &other,
                vec![NextStep::Prose(
                    "Check that the remote exists and is accessible.".into(),
                )],
            )),
        }),
    }
}
