//! Explicit, opt-in staged-only obligations. No review tracking or commit denial.
use clap::{Args, ValueEnum};
use std::io::Write as _;
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum PreflightFormat {
    Human,
    Json,
}
#[derive(Debug, Clone, Args)]
pub struct PreflightArgs {
    /// Output as a readable report or the versioned JSON envelope.
    #[arg(long, value_enum, default_value = "human")]
    pub format: PreflightFormat,
}
/// Read staged definitions and blobs without modifying the index or worktree.
pub fn run(repo: &gix::Repository, args: PreflightArgs) -> anyhow::Result<i32> {
    let document = crate::preflight::preflight(repo)?;
    let text = match args.format {
        PreflightFormat::Json => serde_json::to_string(&document)?,
        PreflightFormat::Human => serde_json::to_string_pretty(&document)?,
    };
    writeln!(std::io::stdout().lock(), "{text}")?;
    Ok(0)
}
