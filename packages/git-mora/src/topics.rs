//! Topic sets stored as blobs under `refs/topics/`, plus worktree-local context.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::process::{Command, ExitCode};

use crate::error::{Error, Result};
use crate::{git, names};

const REF_PREFIX: &str = "refs/topics/";
const CONTEXT_BRANCH_KEY: &str = "mora.contextBranch";
const TOPICS_KEY: &str = "mora.topics";
/// Finite budget for re-reading and retrying after a competing writer.
const RETRIES: usize = 8;

pub type Index = BTreeMap<String, BTreeSet<String>>;

pub fn validate_id(id: &str) -> Result<()> {
    names::component("topic id", id, &format!("{REF_PREFIX}{id}"))
}

pub struct Stored {
    pub oid: String,
    pub commits: BTreeSet<String>,
}

fn parse_blob(id: &str, bytes: &[u8]) -> Result<BTreeSet<String>> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| Error(format!("topic '{id}' is not valid UTF-8")))?;
    let mut set = BTreeSet::new();
    if text.is_empty() {
        return Ok(set);
    }
    let Some(body) = text.strip_suffix('\n') else {
        bail!("topic '{id}' is malformed: missing final newline");
    };
    let mut previous: Option<&str> = None;
    for line in body.split('\n') {
        if !git::is_oid(line) {
            bail!("topic '{id}' is malformed: '{line}' is not a full object id");
        }
        if previous.is_some_and(|p| p >= line) {
            bail!("topic '{id}' is malformed: entries are not sorted and unique");
        }
        previous = Some(line);
        set.insert(line.to_owned());
    }
    Ok(set)
}

fn read_blob(id: &str, oid: &str) -> Result<BTreeSet<String>> {
    let kind = git::run(&["cat-file", "-t", oid])?;
    if kind != "blob" {
        bail!("topic '{id}' is corrupt: {REF_PREFIX}{id} points to a {kind}, not a blob");
    }
    parse_blob(id, &git::run_raw(&["cat-file", "blob", oid])?)
}

pub fn read(id: &str) -> Result<Option<Stored>> {
    validate_id(id)?;
    let refname = format!("{REF_PREFIX}{id}");
    let Some(oid) = git::query(&["rev-parse", "--verify", "--quiet", &refname])? else {
        return Ok(None);
    };
    let commits = read_blob(id, &oid)?;
    Ok(Some(Stored { oid, commits }))
}

pub fn list() -> Result<Vec<String>> {
    let out = git::run(&["for-each-ref", "--format=%(refname)", REF_PREFIX])?;
    let mut ids = Vec::new();
    for line in out.lines() {
        let id = line.strip_prefix(REF_PREFIX).unwrap_or(line);
        validate_id(id)?;
        ids.push(id.to_owned());
    }
    ids.sort();
    Ok(ids)
}

/// Loads every topic; malformed state is an error, never an empty set.
pub fn index() -> Result<Index> {
    let mut index = Index::new();
    for id in list()? {
        if let Some(stored) = read(&id)? {
            index.insert(id, stored.commits);
        }
    }
    Ok(index)
}

fn serialize(set: &BTreeSet<String>) -> String {
    set.iter().map(|oid| format!("{oid}\n")).collect()
}

fn store(id: &str, set: &BTreeSet<String>, old: Option<&str>) -> Result<()> {
    let blob = git::run_with_stdin(&["hash-object", "-w", "--stdin"], serialize(set).as_bytes())?;
    let zero = git::zero_oid(&blob);
    git::transaction(&[format!(
        "update {REF_PREFIX}{id} {blob} {}",
        old.unwrap_or(&zero)
    )])
}

/// Creates an empty topic; an existing valid topic is left unchanged.
pub fn create(id: &str) -> Result<()> {
    if read(id)?.is_some() {
        return Ok(());
    }
    match store(id, &BTreeSet::new(), None) {
        Ok(()) => Ok(()),
        Err(err) => {
            if read(id)?.is_some() { Ok(()) } else { Err(err) }
        }
    }
}

/// Unions `oids` into the topic (creating it) with expected-old checks and bounded retry.
pub fn add(id: &str, oids: &BTreeSet<String>) -> Result<()> {
    validate_id(id)?;
    let mut last = None;
    for _ in 0..RETRIES {
        let stored = read(id)?;
        let mut set = stored.as_ref().map(|s| s.commits.clone()).unwrap_or_default();
        let before = set.len();
        set.extend(oids.iter().cloned());
        if stored.is_some() && set.len() == before {
            return Ok(());
        }
        match store(id, &set, stored.as_ref().map(|s| s.oid.as_str())) {
            Ok(()) => return Ok(()),
            Err(err) => {
                let now = read(id)?;
                if now.as_ref().map(|s| &s.oid) == stored.as_ref().map(|s| &s.oid) {
                    return Err(err);
                }
                last = Some(err);
            }
        }
    }
    Err(Error(format!(
        "topic '{id}' kept changing; gave up after {RETRIES} attempts{}",
        last.map(|e| format!(": {e}")).unwrap_or_default()
    )))
}

/// Resolves every commit before changing anything, then adds to each topic.
pub fn add_commits(ids: &[String], commits: &[String]) -> Result<()> {
    for id in ids {
        validate_id(id)?;
    }
    let mut oids = BTreeSet::new();
    for commit in commits {
        oids.insert(git::resolve_commit(commit)?);
    }
    apply(ids.iter().map(|id| (id.clone(), oids.clone())).collect())
}

/// Applies per-topic additions, reporting every topic that failed.
pub fn apply(additions: BTreeMap<String, BTreeSet<String>>) -> Result<()> {
    let mut failures = Vec::new();
    for (id, oids) in &additions {
        if let Err(err) = add(id, oids) {
            failures.push(format!("{id}: {err}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        bail!(
            "failed to update topic(s); retry is idempotent:\n  {}",
            failures.join("\n  ")
        )
    }
}

pub fn of(commit: &str) -> Result<Vec<String>> {
    let oid = git::resolve_commit(commit)?;
    Ok(index()?
        .into_iter()
        .filter(|(_, set)| set.contains(&oid))
        .map(|(id, _)| id)
        .collect())
}

pub fn show(id: &str, oids_only: bool, missing_only: bool) -> Result<String> {
    let Some(stored) = read(id)? else {
        bail!("topic '{id}' does not exist");
    };
    let mut input = String::new();
    for oid in &stored.commits {
        input.push_str(oid);
        input.push('\n');
    }
    let checked = git::run_with_stdin(
        &["cat-file", "--batch-check=%(objectname) %(objecttype)"],
        input.as_bytes(),
    );
    let checked = if stored.commits.is_empty() { String::new() } else { checked? };
    let mut present = Vec::new();
    let mut absent = Vec::new();
    for line in checked.lines() {
        let (oid, kind) = line.split_once(' ').unwrap_or((line, ""));
        if kind == "missing" {
            absent.push(oid.to_owned());
        } else if kind == "commit" {
            present.push(oid.to_owned());
        } else {
            bail!("topic '{id}' is corrupt: {oid} is a {kind}, not a commit");
        }
    }
    let mut out = String::new();
    if oids_only {
        for oid in &stored.commits {
            if !missing_only || absent.contains(oid) {
                out.push_str(&format!("{oid}\n"));
            }
        }
        return Ok(out);
    }
    let mut subjects = BTreeMap::new();
    if !missing_only && !present.is_empty() {
        let log = git::run_with_stdin(
            &["log", "--no-walk=unsorted", "--stdin", "--format=%H%x09%s"],
            present.join("\n").as_bytes(),
        )?;
        for line in log.lines() {
            if let Some((oid, subject)) = line.split_once('\t') {
                subjects.insert(oid.to_owned(), subject.to_owned());
            }
        }
    }
    for oid in &stored.commits {
        if absent.contains(oid) {
            out.push_str(&format!("{oid}\tmissing\n"));
        } else if !missing_only {
            out.push_str(&format!("{oid}\t{}\n", subjects.get(oid).map_or("", String::as_str)));
        }
    }
    Ok(out)
}

// ---- context ----

pub struct Effective {
    pub topics: Vec<String>,
    pub source: String,
}

pub struct ContextState {
    pub effective: Option<Effective>,
    pub ignored: Option<String>,
}

fn parse_topics(value: &str) -> Result<Vec<String>> {
    let mut topics = Vec::new();
    for id in value.split_whitespace() {
        validate_id(id)?;
        if !topics.iter().any(|t| t == id) {
            topics.push(id.to_owned());
        }
    }
    Ok(topics)
}

fn worktree_config_enabled() -> Result<bool> {
    Ok(git::query(&["config", "--bool", "--get", "extensions.worktreeConfig"])?.as_deref()
        == Some("true"))
}

pub fn effective_context() -> Result<ContextState> {
    if let Some(listing) = git::query(&["config", "--show-scope", "--get-all", TOPICS_KEY])? {
        let command_value = listing
            .lines()
            .filter_map(|l| l.split_once('\t'))
            .rfind(|(scope, _)| *scope == "command")
            .map(|(_, v)| v.to_owned());
        if let Some(value) = command_value {
            return Ok(ContextState {
                effective: Some(Effective {
                    topics: parse_topics(&value)?,
                    source: "command".into(),
                }),
                ignored: None,
            });
        }
    }
    if !worktree_config_enabled()? {
        return Ok(ContextState { effective: None, ignored: None });
    }
    let Some(bound) = git::query(&["config", "--worktree", "--get", CONTEXT_BRANCH_KEY])? else {
        return Ok(ContextState { effective: None, ignored: None });
    };
    let Some(value) = git::query(&["config", "--worktree", "--get", TOPICS_KEY])? else {
        bail!("worktree context is malformed: {CONTEXT_BRANCH_KEY} is set without {TOPICS_KEY}");
    };
    let current = git::current_branch()?;
    if current.as_deref() == Some(bound.as_str()) {
        Ok(ContextState {
            effective: Some(Effective {
                topics: parse_topics(&value)?,
                source: format!("worktree (bound to {bound})"),
            }),
            ignored: None,
        })
    } else {
        let now = current.map_or_else(|| "detached HEAD".to_owned(), |b| format!("branch {b}"));
        Ok(ContextState {
            effective: None,
            ignored: Some(format!("worktree context is bound to {bound}, but the current checkout is {now}")),
        })
    }
}

pub fn context_topics() -> Result<Vec<String>> {
    Ok(effective_context()?.effective.map(|e| e.topics).unwrap_or_default())
}

pub fn context_show() -> Result<String> {
    let state = effective_context()?;
    let mut out = String::new();
    match state.effective {
        Some(e) => {
            out.push_str(&format!("topics: {}\n", e.topics.join(" ")));
            out.push_str(&format!("source: {}\n", e.source));
        }
        None => out.push_str("topics: (none)\nsource: none\n"),
    }
    if let Some(ignored) = state.ignored {
        out.push_str(&format!("ignored: {ignored}\n"));
    }
    Ok(out)
}

fn write_context(branch: &str, topics: &[String]) -> Result<()> {
    if !worktree_config_enabled()? {
        bail!(
            "extensions.worktreeConfig is not enabled; enable it deliberately (see git-config(1)) \
             before persisting topic context, or use 'git mora topic exec'"
        );
    }
    let path = git::run(&["rev-parse", "--path-format=absolute", "--git-path", "config.worktree"])?;
    let lock = format!("{path}.lock");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|err| Error(format!("cannot lock {path}: {err}")))?;
    let result = (|| -> Result<()> {
        if let Ok(existing) = fs::read(&path) {
            file.write_all(&existing)?;
        }
        file.flush()?;
        git::run(&["config", "--file", &lock, CONTEXT_BRANCH_KEY, branch])?;
        git::run(&["config", "--file", &lock, TOPICS_KEY, &topics.join(" ")])?;
        fs::rename(&lock, &path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&lock);
    }
    result
}

pub fn context_set(ids: &[String]) -> Result<()> {
    let Some(branch) = git::current_branch()? else {
        bail!("topic context requires a checked-out branch");
    };
    let mut topics = Vec::new();
    for id in ids {
        validate_id(id)?;
        if !topics.contains(id) {
            topics.push(id.clone());
        }
    }
    topics.sort();
    write_context(&branch, &topics)
}

pub fn context_clear() -> Result<()> {
    let Some(branch) = git::current_branch()? else {
        bail!("topic context requires a checked-out branch");
    };
    write_context(&branch, &[])
}

/// Runs a command with command-scoped context; returns the child's exit status.
pub fn exec(ids: &[String], no_topics: bool, command: &[String]) -> Result<ExitCode> {
    let value = if no_topics {
        Some(String::new())
    } else if !ids.is_empty() {
        for id in ids {
            validate_id(id)?;
        }
        Some(ids.join(" "))
    } else {
        effective_context()?.effective.map(|e| e.topics.join(" "))
    };
    let Some((program, args)) = command.split_first() else {
        bail!("exec needs a command");
    };
    let mut child = Command::new(program);
    child.args(args);
    if let Some(value) = value {
        let n: usize = match std::env::var("GIT_CONFIG_COUNT") {
            Ok(v) => v
                .parse()
                .map_err(|_| Error("GIT_CONFIG_COUNT is not a number".into()))?,
            Err(_) => 0,
        };
        child
            .env("GIT_CONFIG_COUNT", (n + 1).to_string())
            .env(format!("GIT_CONFIG_KEY_{n}"), TOPICS_KEY)
            .env(format!("GIT_CONFIG_VALUE_{n}"), value);
    }
    let status = child
        .status()
        .map_err(|err| Error(format!("cannot run '{program}': {err}")))?;
    Ok(match status.code() {
        Some(code) => ExitCode::from(u8::try_from(code & 0xff).unwrap_or(1)),
        None => ExitCode::from(1),
    })
}
