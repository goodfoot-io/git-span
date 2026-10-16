use clap::Args;

use crate::error::Result;
use crate::{git, names, observe, random};

#[derive(Args)]
pub struct BranchArgs {
    /// Agent/session identifier
    #[arg(long = "agent-id", value_name = "id", required = true)]
    agent_id: String,
    /// Intended publication target; defaults to the current branch's literal name
    #[arg(long, value_name = "branch")]
    target: Option<String>,
    /// Starting commit or branch; defaults to HEAD
    start_point: Option<String>,
}

const ATTEMPTS: usize = 16;

pub fn run(args: &BranchArgs) -> Result<()> {
    let target = match &args.target {
        Some(t) => t.clone(),
        None => match git::current_branch()? {
            Some(b) if !b.contains('/') => b,
            Some(b) => bail!("current branch '{b}' contains '/'; pass --target"),
            None => bail!("HEAD is detached; pass --target"),
        },
    };
    if git::query(&["rev-parse", "--verify", "--quiet", "--end-of-options", &format!("refs/heads/{target}")])?.is_none() {
        bail!("target '{target}' is not an existing local branch");
    }
    let start = git::query(&[
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        &format!("{}^{{commit}}", args.start_point.as_deref().unwrap_or("HEAD")),
    ])?;
    let Some(start) = start else {
        bail!("start point does not resolve to a commit");
    };
    let existing = observe::refs()?;
    for _ in 0..ATTEMPTS {
        let attempt = random::attempt_id()?;
        let name = format!("agent/{}/{target}/{attempt}", args.agent_id);
        names::component("agent id", &args.agent_id, &format!("refs/heads/{name}"))?;
        names::component("target", &target, &format!("refs/heads/{name}"))?;
        let taken = existing.iter().any(|r| match r.kind {
            observe::Kind::Branch => names::parse_branch(&r.name)
                .is_some_and(|b| b.target == target && b.attempt == attempt),
            observe::Kind::Tag => names::parse_tag(&r.name)
                .is_some_and(|(_, t, a)| t == target && a == attempt),
        });
        if taken {
            continue;
        }
        git::transaction(&[format!(
            "create refs/heads/{name} {start}"
        )])?;
        println!("{name}");
        return Ok(());
    }
    bail!("could not generate an unused attempt id after {ATTEMPTS} tries")
}
