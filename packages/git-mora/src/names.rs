//! Workflow name construction, validation, and parsing.

use crate::error::Result;
use crate::git;

/// Checks a single name component and the complete ref it will become part of.
pub fn component(what: &str, value: &str, full_ref: &str) -> Result<()> {
    if value.is_empty() {
        bail!("{what} must not be empty");
    }
    if value.contains('/') {
        bail!("{what} '{value}' must not contain '/'");
    }
    if value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        bail!("{what} '{value}' must not contain whitespace or control characters");
    }
    if !git::output(&["check-ref-format", full_ref])?.status.success() {
        bail!("{what} '{value}' does not form a valid Git ref name");
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending,
    Merge,
    Discard,
}

impl Status {
    pub const ALL: [Status; 3] = [Status::Pending, Status::Merge, Status::Discard];

    pub fn prefix(self) -> &'static str {
        match self {
            Status::Pending => "pending",
            Status::Merge => "merge",
            Status::Discard => "discard",
        }
    }

    pub fn tag_name(self, target: &str, attempt: &str) -> String {
        format!("{}/{target}/{attempt}", self.prefix())
    }
}

pub struct AgentBranch {
    pub agent: String,
    pub target: String,
    pub attempt: String,
}

pub fn parse_branch(name: &str) -> Option<AgentBranch> {
    let parts: Vec<&str> = name.split('/').collect();
    match parts.as_slice() {
        ["agent", agent, target, attempt] if parts.iter().all(|p| !p.is_empty()) => {
            Some(AgentBranch {
                agent: (*agent).to_owned(),
                target: (*target).to_owned(),
                attempt: (*attempt).to_owned(),
            })
        }
        _ => None,
    }
}

pub fn parse_tag(name: &str) -> Option<(Status, String, String)> {
    let parts: Vec<&str> = name.split('/').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty()) {
        return None;
    }
    let status = Status::ALL.into_iter().find(|s| s.prefix() == parts[0])?;
    Some((status, parts[1].to_owned(), parts[2].to_owned()))
}
