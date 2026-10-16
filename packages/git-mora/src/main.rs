#[macro_use]
mod error;
mod branch;
mod duration;
mod git;
mod glob;
mod hook;
mod names;
mod observe;
mod random;
mod tagcmd;
mod topics;
mod watch;

use std::process::ExitCode;

use clap::error::ErrorKind;
use clap::{CommandFactory, Parser, Subcommand};

use error::Result;

/// Small helpers for agent branches, workflow tags, and informational topics.
///
/// Names:
///   agent branch   agent/<agent-id>/<target>/<attempt-id>
///   workflow tags  pending|merge|discard/<target>/<attempt-id>
///   topic index    refs/topics/<topic-id>
///
/// Mora never moves an existing tag to different code, runs reviews, chooses
/// integrations, or publishes. Only requested branches/tags, topic blobs/refs,
/// and optional worktree-local topic context are persisted.
///
/// Exit status: 0 success (including no-op or empty list), 1 operation failed,
/// 2 invalid arguments, 3 wait timed out.
#[derive(Parser)]
#[command(name = "git-mora", bin_name = "git mora", version, subcommand_required = true)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a uniquely named agent branch and print its name
    Branch(branch::BranchArgs),
    /// Tag the current attempt as pending, merge, or discard
    Tag {
        #[command(subcommand)]
        action: tagcmd::TagAction,
    },
    /// List matching local branches and tags, then exit
    List(watch::ListArgs),
    /// Watch for matching tags and branches being created
    Listen(watch::ListenArgs),
    /// Wait for matching tags or branches to exist or disappear
    Wait(watch::WaitArgs),
    /// Run a topic-tracking adapter from an existing Git hook
    Hook {
        #[command(subcommand)]
        action: hook::HookAction,
    },
    /// Create, inspect, and update informational topic associations
    Topic {
        #[command(subcommand)]
        action: TopicAction,
    },
}

#[derive(Subcommand)]
enum TopicAction {
    /// Create an empty topic (an existing valid topic is unchanged)
    Create { topic_id: String },
    /// List topic ids
    List,
    /// Show the commits associated with a topic
    Show {
        topic_id: String,
        /// Print full object ids only
        #[arg(long)]
        oids: bool,
        /// Only entries whose objects are unavailable
        #[arg(long)]
        missing: bool,
    },
    /// List topics directly containing a commit
    Of { commit: String },
    /// Union commits into a topic, creating it if needed
    Add {
        topic_id: String,
        #[arg(required = true)]
        commits: Vec<String>,
    },
    /// Manage this worktree's future-commit topic context
    Context {
        #[command(subcommand)]
        action: ContextAction,
    },
    /// Run a command with command-scoped topic context
    Exec {
        #[arg(long = "topic", value_name = "id", conflicts_with = "no_topics")]
        topics: Vec<String>,
        /// Explicitly empty context
        #[arg(long = "no-topics")]
        no_topics: bool,
        #[arg(last = true, required = true, value_name = "command")]
        command: Vec<String>,
    },
}

#[derive(Subcommand)]
enum ContextAction {
    /// Show effective topics, their source, and any ignored binding
    Show,
    /// Replace this worktree's context and bind it to the current branch
    Set {
        #[arg(required = true)]
        topic_ids: Vec<String>,
    },
    /// Bind an explicitly empty context to the current branch
    Clear,
}

fn print(text: &str) -> Result<()> {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    out.write_all(text.as_bytes())?;
    out.flush()?;
    Ok(())
}

fn lines(items: &[String]) -> String {
    items.iter().map(|i| format!("{i}\n")).collect()
}

fn run(cli: Cli) -> Result<ExitCode> {
    match cli.command {
        Command::Branch(args) => branch::run(&args)?,
        Command::Tag { action } => tagcmd::run(action)?,
        Command::List(args) => watch::list(&args)?,
        Command::Listen(args) => watch::listen(&args)?,
        Command::Wait(args) => {
            if !watch::requires_filter(&args) {
                Cli::command()
                    .error(ErrorKind::MissingRequiredArgument, "wait requires at least one filter")
                    .exit();
            }
            return watch::wait(&args);
        }
        Command::Hook { action } => hook::run(&action)?,
        Command::Topic { action } => match action {
            TopicAction::Create { topic_id } => {
                topics::validate_id(&topic_id)?;
                topics::create(&topic_id)?;
            }
            TopicAction::List => print(&lines(&topics::list()?))?,
            TopicAction::Show { topic_id, oids, missing } => {
                print(&topics::show(&topic_id, oids, missing)?)?;
            }
            TopicAction::Of { commit } => print(&lines(&topics::of(&commit)?))?,
            TopicAction::Add { topic_id, commits } => {
                topics::add_commits(&[topic_id], &commits)?;
            }
            TopicAction::Context { action } => match action {
                ContextAction::Show => print(&topics::context_show()?)?,
                ContextAction::Set { topic_ids } => topics::context_set(&topic_ids)?,
                ContextAction::Clear => topics::context_clear()?,
            },
            TopicAction::Exec { topics: ids, no_topics, command } => {
                return topics::exec(&ids, no_topics, &command);
            }
        },
    }
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("git-mora: {err}");
            ExitCode::from(1)
        }
    }
}
