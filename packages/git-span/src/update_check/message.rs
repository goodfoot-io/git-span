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

/// Render the reminder note: what is behind, the observed versions, and the
/// exact command that brings each tool current.
pub fn render(reminder: &Reminder, current: &Version) -> String {
    let _ = (reminder, current);
    todo!("Phase 3: doctor-style markdown with per-tool update commands")
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
    #[ignore = "Phase 3: message rendering not implemented"]
    fn cli_finding_names_the_install_command() {
        let note = render(&reminder(&[("cli", "1.1.4")]), &Version::new(1, 1, 5));
        assert!(note.contains("npm install -g git-span"), "{note}");
        assert!(
            note.contains("1.1.4") && note.contains("1.1.5"),
            "the note must name both the observed and the current version; {note}"
        );
    }

    #[test]
    #[ignore = "Phase 3: message rendering not implemented"]
    fn claude_finding_names_the_update_command() {
        let note = render(&reminder(&[("claude", "1.1.4")]), &Version::new(1, 1, 5));
        assert!(note.contains("claude plugin update git-span@git-span"), "{note}");
    }

    #[test]
    #[ignore = "Phase 3: message rendering not implemented"]
    fn codex_finding_names_the_readd_command() {
        // Codex has no update subcommand; the spiked refresh path is a
        // re-add, which installs/refreshes idempotently.
        let note = render(&reminder(&[("codex", "1.1.4")]), &Version::new(1, 1, 5));
        assert!(note.contains("codex plugin add git-span@git-span"), "{note}");
    }

    #[test]
    #[ignore = "Phase 3: message rendering not implemented"]
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
