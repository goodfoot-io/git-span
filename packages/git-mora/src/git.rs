//! Thin wrapper over the `git` executable. Every call uses a direct argument vector.

use std::io::Write;
use std::process::{Command, Output, Stdio};

use crate::error::{Error, Result};

pub fn output(args: &[&str]) -> Result<Output> {
    Command::new("git")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|err| Error(format!("failed to run git: {err}")))
}

fn failure(args: &[&str], out: &Output) -> Error {
    let stderr = String::from_utf8_lossy(&out.stderr);
    Error(format!(
        "git {} failed: {}",
        args.first().copied().unwrap_or(""),
        stderr.trim()
    ))
}

fn text(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| Error("git produced non-UTF-8 output".into()))
}

/// Runs git and returns stdout verbatim.
pub fn run_raw(args: &[&str]) -> Result<Vec<u8>> {
    let out = output(args)?;
    if !out.status.success() {
        return Err(failure(args, &out));
    }
    Ok(out.stdout)
}

/// Runs git and returns stdout without its final newline.
pub fn run(args: &[&str]) -> Result<String> {
    let mut s = text(run_raw(args)?)?;
    if s.ends_with('\n') {
        s.pop();
    }
    Ok(s)
}

/// Runs a query whose exit status 1 means "not found".
pub fn query(args: &[&str]) -> Result<Option<String>> {
    let out = output(args)?;
    match out.status.code() {
        Some(0) => {
            let mut s = text(out.stdout)?;
            if s.ends_with('\n') {
                s.pop();
            }
            Ok(Some(s))
        }
        Some(1) => Ok(None),
        _ => Err(failure(args, &out)),
    }
}

pub fn run_with_stdin(args: &[&str], input: &[u8]) -> Result<String> {
    let mut child = Command::new("git")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| Error(format!("failed to run git: {err}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| Error("git stdin unavailable".into()))?;
    let data = input.to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&data));
    let out = child.wait_with_output()?;
    // A write error means git exited early; its status below reports why.
    let _ = writer.join();
    if !out.status.success() {
        return Err(failure(args, &out));
    }
    let mut s = text(out.stdout)?;
    if s.ends_with('\n') {
        s.pop();
    }
    Ok(s)
}

/// Applies ref commands (`create`, `update`, `delete`, `verify`) in one checked transaction.
pub fn transaction(commands: &[String]) -> Result<()> {
    let mut input = String::from("start\n");
    for command in commands {
        input.push_str(command);
        input.push('\n');
    }
    input.push_str("prepare\ncommit\n");
    run_with_stdin(&["update-ref", "--stdin"], input.as_bytes()).map(|_| ())
}

pub fn zero_oid(like: &str) -> String {
    "0".repeat(like.len())
}

/// The checked-out branch's literal name, or `None` when HEAD is detached.
pub fn current_branch() -> Result<Option<String>> {
    Ok(query(&["symbolic-ref", "--quiet", "HEAD"])?
        .and_then(|name| name.strip_prefix("refs/heads/").map(str::to_owned)))
}

pub fn resolve_commit(spec: &str) -> Result<String> {
    let rev = format!("{spec}^{{commit}}");
    match query(&["rev-parse", "--verify", "--quiet", "--end-of-options", &rev])? {
        Some(oid) => Ok(oid),
        None => Err(Error(format!("'{spec}' does not resolve to a commit"))),
    }
}

pub fn is_oid(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
