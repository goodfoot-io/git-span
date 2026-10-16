use std::path::Path;

use clap::Subcommand;

use crate::error::Result;
use crate::git;
use crate::names::{self, Status};

#[derive(Subcommand, Clone, Copy)]
pub enum TagAction {
    /// Create the pending tag at HEAD (requires a clean worktree)
    Pending,
    /// Turn the pending snapshot at HEAD into a merge tag
    Merge,
    /// Turn the pending or merge snapshot at HEAD into a discard tag
    Discard,
}

impl TagAction {
    fn status(self) -> Status {
        match self {
            TagAction::Pending => Status::Pending,
            TagAction::Merge => Status::Merge,
            TagAction::Discard => Status::Discard,
        }
    }
}

fn ensure_no_operation() -> Result<()> {
    for name in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
        "BISECT_LOG",
    ] {
        let path = git::run(&["rev-parse", "--path-format=absolute", "--git-path", name])?;
        if Path::new(&path).exists() {
            bail!("a Git operation is in progress ({name}); finish or abort it first");
        }
    }
    Ok(())
}

/// Existing workflow tags for this attempt, each required to be a lightweight tag on a commit.
fn existing(target: &str, attempt: &str) -> Result<Vec<(Status, String)>> {
    let refs: Vec<String> = Status::ALL
        .iter()
        .map(|s| format!("refs/tags/{}", s.tag_name(target, attempt)))
        .collect();
    let mut args = vec![
        "for-each-ref",
        "--format=%(refname)%09%(objectname)%09%(objecttype)%09%(symref)",
    ];
    args.extend(refs.iter().map(String::as_str));
    let out = git::run(&args)?;
    let mut found = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.splitn(4, '\t').collect();
        let [refname, oid, otype, symref] = f.as_slice() else {
            bail!("unexpected for-each-ref output: {line}");
        };
        let Some(status) = Status::ALL
            .into_iter()
            .find(|s| format!("refs/tags/{}", s.tag_name(target, attempt)) == *refname)
        else {
            continue;
        };
        if !symref.is_empty() || *otype != "commit" {
            bail!("{refname} is malformed workflow state: it must be a lightweight tag on a commit");
        }
        found.push((status, (*oid).to_owned()));
    }
    Ok(found)
}

fn ensure_clean() -> Result<()> {
    let status = git::run(&["status", "--porcelain=v1", "--untracked-files=all"])?;
    if !status.is_empty() {
        bail!("pending requires a clean worktree (staged, unstaged, and untracked changes are refused)");
    }
    Ok(())
}

pub fn run(action: TagAction) -> Result<()> {
    let Some(branch) = git::current_branch()? else {
        bail!("HEAD is detached; tag commands require a checked-out agent branch");
    };
    let Some(parsed) = names::parse_branch(&branch) else {
        bail!("'{branch}' is not an agent/<agent-id>/<target>/<attempt-id> branch");
    };
    let (target, attempt) = (parsed.target, parsed.attempt);
    ensure_no_operation()?;
    let Some(head) = git::query(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])? else {
        bail!("HEAD does not resolve to a commit");
    };
    let found = existing(&target, &attempt)?;
    if found.len() > 1 {
        bail!("contradictory workflow tags exist for this attempt; resolve them with ordinary Git");
    }
    if let Some((status, oid)) = found.first()
        && *oid != head
    {
        bail!(
            "{} points at {oid}, but HEAD is {head}; changed code requires a new attempt",
            status.tag_name(&target, &attempt)
        );
    }
    let want = action.status();
    let current = found.first().map(|(s, _)| *s);
    let name = want.tag_name(&target, &attempt);
    let consumed = match (action, current) {
        (TagAction::Pending, None) => None,
        (TagAction::Pending, Some(Status::Pending)) => {
            ensure_clean()?;
            println!("{name}");
            return Ok(());
        }
        (TagAction::Pending, Some(other)) => {
            bail!("{} exists; a {} attempt cannot return to pending", other.tag_name(&target, &attempt), other.prefix())
        }
        (TagAction::Merge, None) => bail!("no pending snapshot to merge"),
        (TagAction::Merge, Some(Status::Pending)) => Some(Status::Pending),
        (TagAction::Merge, Some(Status::Merge)) | (TagAction::Discard, Some(Status::Discard)) => {
            println!("{name}");
            return Ok(());
        }
        (TagAction::Merge, Some(Status::Discard)) => bail!("a discarded attempt cannot be approved"),
        (TagAction::Discard, None) => bail!("no saved snapshot to discard"),
        (TagAction::Discard, Some(prior)) => Some(prior),
    };
    if action.status() == Status::Pending {
        ensure_clean()?;
    }
    let zero = git::zero_oid(&head);
    let mut commands = vec![format!("verify refs/heads/{branch} {head}")];
    for other in Status::ALL {
        if other != want && Some(other) != consumed {
            commands.push(format!("verify refs/tags/{} {zero}", other.tag_name(&target, &attempt)));
        }
    }
    commands.push(format!("create refs/tags/{name} {head}"));
    if let Some(prior) = consumed {
        commands.push(format!("delete refs/tags/{} {head}", prior.tag_name(&target, &attempt)));
    }
    git::transaction(&commands)?;
    println!("{name}");
    Ok(())
}
