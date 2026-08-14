//! Rendering of the update-check reminder note.
//!
//! Doctor-style plain markdown on stdout — no ANSI, no width wrapping. The
//! note only informs; it never updates anything itself, and it must never
//! change a command's exit code. Update commands are the spiked host
//! commands:
//!
//! * CLI — `npm install -g git-span`
//! * Claude Code — `claude plugin update git-span@git-span` (restart to
//!   apply)
//! * Codex — no update subcommand; the refresh path is
//!   `codex plugin add git-span@git-span`

use semver::Version;

use crate::update_check::decide::Reminder;

/// The exact host command that brings each tool current — spiked against the
/// real host CLIs (see the module docs). `None` for a tool the CLI does not
/// know: the note never prints an update command it cannot vouch for.
fn update_command(tool: &str) -> Option<&'static str> {
    match tool {
        "cli" => Some("npm install -g git-span"),
        "claude" => Some("claude plugin update git-span@git-span"),
        "codex" => Some("codex plugin add git-span@git-span"),
        _ => None,
    }
}

/// Render the reminder note: what is behind, the version each tool is on,
/// and the exact command that brings it current. Doctor-style plain
/// markdown (see `cli/doctor.rs`): a `#` heading, a `## Findings` section,
/// one `- ERROR —`-shaped bullet per finding, no ANSI, no width wrapping.
/// `latest` is the latest release — the version the bullet names as the
/// update target.
pub fn render(reminder: &Reminder, latest: &Version) -> String {
    let mut note = String::new();
    note.push_str("# Update available\n\n");
    note.push_str(
        "The git-span CLI or one of its bundled integrations is behind the \
         latest release.\n\n",
    );
    note.push_str("## Findings\n\n");
    for (tool, observed) in &reminder.findings {
        let Some(command) = update_command(tool) else {
            continue;
        };
        note.push_str(&format!(
            "- ERROR — `{tool}` is on `{observed}`; the latest release is `{latest}`. \
             Update with `{command}`.\n"
        ));
    }
    note
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update_check::decide::Reminder;

    fn reminder(tools: &[(&str, &str)]) -> Reminder {
        Reminder {
            findings: tools
                .iter()
                .map(|(tool, version)| (tool.to_string(), Version::parse(version).unwrap()))
                .collect(),
        }
    }

    #[test]
    fn cli_finding_names_the_install_command() {
        // The finding names the version the CLI is on (1.1.4); the second
        // argument is the latest release (1.1.5) — the note names both.
        let note = render(&reminder(&[("cli", "1.1.4")]), &Version::new(1, 1, 5));
        assert!(note.contains("npm install -g git-span"), "{note}");
        assert!(
            note.contains("1.1.4") && note.contains("1.1.5"),
            "the note must name both the version the CLI is on and the latest release; {note}"
        );
    }

    #[test]
    fn claude_finding_names_the_update_command() {
        let note = render(&reminder(&[("claude", "1.1.4")]), &Version::new(1, 1, 5));
        assert!(note.contains("claude plugin update git-span@git-span"), "{note}");
    }

    #[test]
    fn codex_finding_names_the_readd_command() {
        // Codex has no update subcommand; the spiked refresh path is a
        // re-add, which installs/refreshes idempotently.
        let note = render(&reminder(&[("codex", "1.1.4")]), &Version::new(1, 1, 5));
        assert!(note.contains("codex plugin add git-span@git-span"), "{note}");
    }

    #[test]
    fn multiple_findings_render_all_commands() {
        let note = render(
            &reminder(&[("cli", "1.1.4"), ("claude", "1.1.4"), ("codex", "1.1.4")]),
            &Version::new(1, 1, 5),
        );
        assert!(note.contains("npm install -g git-span"), "{note}");
        assert!(note.contains("claude plugin update git-span@git-span"), "{note}");
        assert!(note.contains("codex plugin add git-span@git-span"), "{note}");
    }
}
