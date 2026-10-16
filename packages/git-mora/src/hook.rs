use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;

use clap::Subcommand;

use crate::error::Result;
use crate::{git, topics};

#[derive(Subcommand)]
pub enum HookAction {
    /// Add the new HEAD to the effective topic context
    #[command(name = "post-commit")]
    Commit,
    /// Carry topic membership onto rewritten commits (reads old/new pairs on stdin)
    #[command(name = "post-rewrite")]
    Rewrite {
        #[arg(value_parser = ["amend", "rebase"])]
        mode: String,
    },
    /// Annotate a newly created merge commit
    #[command(name = "post-merge")]
    Merge {
        #[arg(value_parser = ["0", "1"])]
        squash: String,
    },
}

pub fn run(action: &HookAction) -> Result<()> {
    match action {
        HookAction::Commit => post_commit(),
        HookAction::Rewrite { .. } => post_rewrite(),
        HookAction::Merge { squash } => post_merge(squash == "1"),
    }
}

fn head() -> Result<String> {
    git::resolve_commit("HEAD")
}

fn parents(commit: &str) -> Result<Vec<String>> {
    let line = git::run(&["rev-list", "--parents", "-n", "1", commit])?;
    Ok(line.split_whitespace().skip(1).map(str::to_owned).collect())
}

/// Annotates a newly created commit: contextual topics, plus direct parent topics for merges.
fn annotate_new_commit(commit: &str) -> Result<()> {
    let mut targets: BTreeSet<String> = topics::context_topics()?.into_iter().collect();
    let parents = parents(commit)?;
    if parents.len() >= 2 {
        for (topic, set) in topics::index()? {
            if parents.iter().any(|p| set.contains(p)) {
                targets.insert(topic);
            }
        }
    }
    let oids = BTreeSet::from([commit.to_owned()]);
    topics::apply(targets.into_iter().map(|t| (t, oids.clone())).collect())
}

fn post_commit() -> Result<()> {
    annotate_new_commit(&head()?)
}

fn post_rewrite() -> Result<()> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let mut pairs = Vec::new();
    for line in input.lines().filter(|l| !l.trim().is_empty()) {
        let mut fields = line.split_whitespace();
        let (Some(old), Some(new)) = (fields.next(), fields.next()) else {
            bail!("malformed post-rewrite line: {line}");
        };
        if !git::is_oid(old) || !git::is_oid(new) {
            bail!("malformed post-rewrite line: {line}");
        }
        pairs.push((old.to_owned(), new.to_owned()));
    }
    if pairs.is_empty() {
        return Ok(());
    }
    let context = topics::context_topics()?;
    let index = topics::index()?;
    let mut additions: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (old, new) in &pairs {
        for (topic, set) in &index {
            if set.contains(old) {
                additions.entry(topic.clone()).or_default().insert(new.clone());
            }
        }
        for topic in &context {
            additions.entry(topic.clone()).or_default().insert(new.clone());
        }
    }
    topics::apply(additions)
}

/// True only when native evidence corroborates that HEAD is a merge commit this operation created.
fn made_new_merge(head: &str) -> Result<bool> {
    let parents = parents(head)?;
    if parents.len() < 2 {
        return Ok(false);
    }
    let orig = git::query(&["rev-parse", "--verify", "--quiet", "ORIG_HEAD^{commit}"])?;
    if orig.as_deref() != Some(parents[0].as_str()) {
        return Ok(false);
    }
    let Some(entry) = git::query(&["log", "-g", "-n", "1", "--format=%H%x09%gs", "HEAD"])? else {
        return Ok(false);
    };
    let Some((oid, subject)) = entry.split_once('\t') else {
        return Ok(false);
    };
    Ok(oid == head && subject.starts_with("merge ") && !subject.ends_with("Fast-forward"))
}

fn post_merge(squash: bool) -> Result<()> {
    if squash {
        return Ok(());
    }
    let head = head()?;
    if made_new_merge(&head)? {
        annotate_new_commit(&head)
    } else {
        eprintln!(
            "git-mora: post-merge made no topic annotation (no corroborated new merge commit); \
             use 'git mora topic add' for a known commit"
        );
        Ok(())
    }
}
