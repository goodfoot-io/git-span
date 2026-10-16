//! Branch/tag observations and the filter contract shared by list, listen, and wait.

use std::collections::HashMap;

use clap::Args;

use crate::error::Result;
use crate::{git, glob, names, topics};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Kind {
    Branch,
    Tag,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Branch => "branch",
            Kind::Tag => "tag",
        }
    }
}

pub struct RawRef {
    pub kind: Kind,
    pub name: String,
    pub oid: String,
    pub commit: Option<String>,
    pub worktree: Option<String>,
}

/// Lists local branches and tags without topic enrichment.
pub fn refs() -> Result<Vec<RawRef>> {
    let format = "%(refname)%09%(objectname)%09%(objecttype)%09%(*objectname)%09%(*objecttype)%09%(worktreepath)";
    let out = git::run(&[
        "for-each-ref",
        &format!("--format={format}"),
        "refs/heads",
        "refs/tags",
    ])?;
    let mut refs = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.splitn(6, '\t').collect();
        let [refname, oid, otype, peeled, ptype, worktree] = f.as_slice() else {
            bail!("unexpected for-each-ref output: {line}");
        };
        let (kind, name) = if let Some(n) = refname.strip_prefix("refs/heads/") {
            (Kind::Branch, n)
        } else if let Some(n) = refname.strip_prefix("refs/tags/") {
            (Kind::Tag, n)
        } else {
            bail!("unexpected ref {refname}");
        };
        let commit = match (*otype, *ptype) {
            ("commit", _) => Some((*oid).to_owned()),
            ("tag", "commit") => Some((*peeled).to_owned()),
            ("tag", "tag") => git::query(&[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{oid}^{{commit}}"),
            ])?,
            _ => None,
        };
        refs.push(RawRef {
            kind,
            name: name.to_owned(),
            oid: (*oid).to_owned(),
            commit,
            worktree: (!worktree.is_empty()).then(|| (*worktree).to_owned()),
        });
    }
    refs.sort_by(|a, b| (a.kind, &a.name).cmp(&(b.kind, &b.name)));
    Ok(refs)
}

#[derive(Clone, Debug)]
pub struct Observation {
    pub kind: Kind,
    pub name: String,
    pub oid: String,
    pub commit: Option<String>,
    pub agent_id: Option<String>,
    pub target: Option<String>,
    pub attempt_id: Option<String>,
    pub topics: Vec<String>,
    pub agent_branch: Option<String>,
    pub worktree_path: Option<String>,
}

/// Observes every local branch and tag, sorted by `(kind, name)`.
pub fn scan() -> Result<Vec<Observation>> {
    let refs = refs()?;
    let index = topics::index()?;
    let mut by_commit: HashMap<&str, Vec<String>> = HashMap::new();
    for (topic, set) in &index {
        for commit in set {
            by_commit.entry(commit).or_default().push(topic.clone());
        }
    }
    let mut branches: HashMap<(String, String), Vec<&RawRef>> = HashMap::new();
    for r in refs.iter().filter(|r| r.kind == Kind::Branch) {
        if let Some(b) = names::parse_branch(&r.name) {
            branches.entry((b.target, b.attempt)).or_default().push(r);
        }
    }
    let mut observations = Vec::with_capacity(refs.len());
    for r in &refs {
        let mut o = Observation {
            kind: r.kind,
            name: r.name.clone(),
            oid: r.oid.clone(),
            commit: r.commit.clone(),
            agent_id: None,
            target: None,
            attempt_id: None,
            topics: r
                .commit
                .as_deref()
                .and_then(|c| by_commit.get(c).cloned())
                .unwrap_or_default(),
            agent_branch: None,
            worktree_path: r.worktree.clone(),
        };
        match r.kind {
            Kind::Branch => {
                if let Some(b) = names::parse_branch(&r.name) {
                    o.agent_id = Some(b.agent);
                    o.target = Some(b.target);
                    o.attempt_id = Some(b.attempt);
                    o.agent_branch = Some(r.name.clone());
                }
            }
            Kind::Tag => {
                if let Some((_, target, attempt)) = names::parse_tag(&r.name) {
                    if let Some([only]) = branches
                        .get(&(target.clone(), attempt.clone()))
                        .map(Vec::as_slice)
                        && let Some(b) = names::parse_branch(&only.name)
                    {
                        o.agent_id = Some(b.agent);
                        o.agent_branch = Some(only.name.clone());
                        o.worktree_path = only.worktree.clone();
                    }
                    o.target = Some(target);
                    o.attempt_id = Some(attempt);
                }
            }
        }
        observations.push(o);
    }
    Ok(observations)
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json_opt(value: &Option<String>) -> String {
    value.as_deref().map_or_else(|| "null".into(), json_string)
}

impl Observation {
    /// One-line JSON; `event` is set only by `listen`.
    pub fn to_json(&self, event: Option<&str>) -> String {
        let topics: Vec<String> = self.topics.iter().map(|t| json_string(t)).collect();
        let mut s = format!(
            "{{\"schema_version\":1,\"kind\":{},\"name\":{},\"oid\":{},\"commit\":{},\"agent_id\":{},\"target\":{},\"attempt_id\":{},\"topics\":[{}],\"agent_branch\":{},\"worktree_path\":{}",
            json_string(self.kind.as_str()),
            json_string(&self.name),
            json_string(&self.oid),
            json_opt(&self.commit),
            json_opt(&self.agent_id),
            json_opt(&self.target),
            json_opt(&self.attempt_id),
            topics.join(","),
            json_opt(&self.agent_branch),
            json_opt(&self.worktree_path),
        );
        if let Some(event) = event {
            s.push_str(&format!(",\"event\":{}", json_string(event)));
        }
        s.push('}');
        s
    }
}

/// The six filters shared by `list`, `listen`, and `wait`.
#[derive(Args, Clone, Debug, Default)]
pub struct Filters {
    /// Ordinary tag name pattern, e.g. 'pending/main/*'
    #[arg(long, value_name = "pattern")]
    pub tag: Vec<String>,
    /// Ordinary branch name pattern, e.g. 'agent/alice/*'
    #[arg(long, value_name = "pattern")]
    pub branch: Vec<String>,
    /// Parsed agent, or the current branch association for a tag
    #[arg(long = "agent-id", value_name = "id")]
    pub agent_id: Vec<String>,
    /// Target encoded in a workflow name
    #[arg(long, value_name = "name")]
    pub target: Vec<String>,
    /// Attempt encoded in a workflow name
    #[arg(long = "attempt-id", value_name = "id")]
    pub attempt_id: Vec<String>,
    /// Direct topic membership of the pointed-to commit
    #[arg(long, value_name = "id")]
    pub topic: Vec<String>,
}

fn any_eq(wanted: &[String], actual: Option<&str>) -> bool {
    wanted.is_empty() || actual.is_some_and(|a| wanted.iter().any(|w| w == a))
}

impl Filters {
    pub fn is_empty(&self) -> bool {
        self.tag.is_empty()
            && self.branch.is_empty()
            && self.agent_id.is_empty()
            && self.target.is_empty()
            && self.attempt_id.is_empty()
            && self.topic.is_empty()
    }

    pub fn matches(&self, o: &Observation) -> bool {
        let name_ok = if self.tag.is_empty() && self.branch.is_empty() {
            true
        } else {
            let patterns = match o.kind {
                Kind::Tag => &self.tag,
                Kind::Branch => &self.branch,
            };
            patterns.iter().any(|p| glob::matches(p, &o.name))
        };
        name_ok
            && any_eq(&self.agent_id, o.agent_id.as_deref())
            && any_eq(&self.target, o.target.as_deref())
            && any_eq(&self.attempt_id, o.attempt_id.as_deref())
            && (self.topic.is_empty() || self.topic.iter().any(|t| o.topics.contains(t)))
    }

    pub fn select(&self, all: Vec<Observation>) -> Vec<Observation> {
        all.into_iter().filter(|o| self.matches(o)).collect()
    }
}

pub fn print_table(rows: &[Observation]) -> String {
    let header = ["KIND", "NAME", "AGENT", "TARGET", "ATTEMPT", "COMMIT", "TOPICS", "WORKTREE"];
    let dash = |v: &Option<String>| v.clone().unwrap_or_else(|| "-".into());
    let mut table: Vec<[String; 8]> = vec![header.map(str::to_owned)];
    for o in rows {
        table.push([
            o.kind.as_str().to_owned(),
            o.name.clone(),
            dash(&o.agent_id),
            dash(&o.target),
            dash(&o.attempt_id),
            o.commit
                .as_deref()
                .map_or_else(|| "-".into(), |c| c.chars().take(12).collect()),
            if o.topics.is_empty() { "-".into() } else { o.topics.join(",") },
            dash(&o.worktree_path),
        ]);
    }
    let mut widths = [0usize; 8];
    for row in &table {
        for (w, cell) in widths.iter_mut().zip(row) {
            *w = (*w).max(cell.chars().count());
        }
    }
    let mut out = String::new();
    for row in &table {
        let mut line = String::new();
        for (i, cell) in row.iter().enumerate() {
            if i == 7 {
                line.push_str(cell);
            } else {
                line.push_str(&format!("{cell:<width$}  ", width = widths[i]));
            }
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out
}
