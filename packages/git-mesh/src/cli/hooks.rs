//! `git mesh hooks git ...` shortcut namespace.
//!
//! Each leaf chains the existing commit/rewrite/stale entry points in
//! sequence and short-circuits on the first non-zero exit.  The `stale
//! --compact --auto-follow --no-exit-code` step never propagates a non-zero
//! exit code by construction (flag semantics), so only the first step can
//! make the overall return code non-zero.

use crate::cli::{CommitArgs, RewriteArgs, StaleArgs, StaleFormat};
use anyhow::Result;
use clap::Subcommand;

/// Top-level args for `git mesh hooks`.
#[derive(Debug, clap::Args)]
pub struct HooksArgs {
    #[command(subcommand)]
    pub subcommand: HooksSubcommand,
}

/// Subcommands under `git mesh hooks`.
#[derive(Debug, Subcommand)]
pub enum HooksSubcommand {
    /// Git hook integrations.
    Git(GitArgs),
}

/// Args for `git mesh hooks git`.
#[derive(Debug, clap::Args)]
pub struct GitArgs {
    #[command(subcommand)]
    pub event: HookEvent,
}

/// The hook events that git-mesh shortcuts handle.
#[derive(Debug, Subcommand)]
pub enum HookEvent {
    /// Run after a successful git commit (post-commit hook).
    ///
    /// Chains: `git mesh commit` then
    /// `git mesh stale --compact --auto-follow --no-exit-code`.
    /// Short-circuits on commit failure.
    #[command(name = "post-commit")]
    PostCommit,

    /// Advance anchor SHAs after a history rewrite (post-rewrite hook).
    ///
    /// Reads `<old_sha> <new_sha>` pairs from stdin (git's post-rewrite
    /// protocol), chains: `git mesh rewrite` then
    /// `git mesh stale --compact --auto-follow --no-exit-code`.
    /// Short-circuits on rewrite failure.
    #[command(name = "post-rewrite")]
    PostRewrite,
}

/// Dispatch `git mesh hooks git <event>`.
pub fn run_hooks_git(repo: &gix::Repository, event: HookEvent) -> Result<i32> {
    match event {
        HookEvent::PostCommit => run_post_commit(repo),
        HookEvent::PostRewrite => run_post_rewrite(repo),
    }
}

fn stale_compact_args() -> StaleArgs {
    StaleArgs {
        paths: vec![],
        format: StaleFormat::Human,
        no_exit_code: true,
        no_worktree: false,
        no_index: false,
        no_staged_mesh: false,
        ignore_unavailable: false,
        oneline: false,
        stat: false,
        patch: false,
        since: None,
        compact: true,
        verbose: false,
        auto_follow: true,
    }
}

fn run_post_commit(repo: &gix::Repository) -> Result<i32> {
    let commit_code = crate::cli::commit::run_commit(repo, CommitArgs { name: None })?;
    if commit_code != 0 {
        return Ok(commit_code);
    }
    // --no-exit-code means this step never returns non-zero; ignore the code.
    let _ = crate::cli::stale_output::run_stale(repo, stale_compact_args())?;
    Ok(0)
}

fn run_post_rewrite(repo: &gix::Repository) -> Result<i32> {
    // stdin is inherited from the process — run_rewrite reads it directly.
    let rewrite_code =
        crate::cli::rewrite::run_rewrite(repo, RewriteArgs { format: crate::cli::RewriteFormat::Human })?;
    if rewrite_code != 0 {
        return Ok(rewrite_code);
    }
    // --no-exit-code means this step never returns non-zero.
    let _ = crate::cli::stale_output::run_stale(repo, stale_compact_args())?;
    Ok(0)
}
