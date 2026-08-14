//! Suppression layers for the daily update check (fail-closed).
//!
//! Any single trigger silences both the detached check child and the
//! reminder note:
//!
//! * `env_disable` — `GIT_SPAN_DISABLE_UPDATE_CHECK` present (presence
//!   convention, `var_os().is_some()`), set by automated callers such as
//!   the agent hooks.
//! * `machine_flags` — the parsed command's *effective output format* is
//!   machine-readable: `list --porcelain` / `--oneline`; `drift` / `add` /
//!   `replace` / `why` / `resolve` / `tree` / `history` with `--format`
//!   other than human; `context` always (its `ContextFormat` has only a
//!   `Json` variant); `merge-driver` always (git's own protocol).
//! * `stdout_is_tty` — false when stdout is not a terminal (extension,
//!   mini-swe-agent, scripts, git-hook invocations); the fail-closed
//!   backstop for anything the typed match misses.
//! * `internal` — hidden/internal subcommands (`__context-service`,
//!   `__update-check`, `merge-driver`) never engage or remind, so the
//!   detached child cannot recurse.

use crate::cli::Cli;

/// The four fail-closed suppression signals. [`signals_for`] computes them
/// from the parsed CLI and the observed stdout TTY-ness; [`Self::suppressed`]
/// ORs them.
pub struct SuppressionSignals {
    env_disable: bool,
    machine_flags: bool,
    stdout_is_tty: bool,
    internal: bool,
}

impl SuppressionSignals {
    /// Whether any suppression layer is active. True means no spawn and no
    /// note — the feature must never fire in an automated context.
    pub fn suppressed(&self) -> bool {
        let _ = (
            self.env_disable,
            self.machine_flags,
            self.stdout_is_tty,
            self.internal,
        );
        todo!("Phase 3: OR the four signals")
    }
}

/// Compute the suppression signals for a parsed [`Cli`]. `stdout_is_tty` is
/// injected by the call site (`std::io::stdout().is_terminal()`), so the
/// unit matrix can exercise the TTY=true half without a PTY.
///
/// `machine_flags` is a typed match over the command's effective output
/// format, kept adjacent to `Commands` so future machine-readable flags
/// extend it — not a flag enumeration.
pub fn signals_for(cli: &Cli, stdout_is_tty: bool) -> SuppressionSignals {
    let _ = (cli, stdout_is_tty);
    todo!("Phase 3: env presence + effective-format match + TTY + internal commands")
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    /// Parse argv (with the leading binary name) and compute the signals.
    fn signals_for_argv(argv: &[&str], tty: bool) -> SuppressionSignals {
        let cli = Cli::try_parse_from(argv).expect("argv must parse");
        signals_for(&cli, tty)
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn env_disable_var_suppresses_interactive_use() {
        unsafe {
            std::env::set_var("GIT_SPAN_DISABLE_UPDATE_CHECK", "1");
        }
        let signals = signals_for_argv(&["git-span", "list"], true);
        assert!(signals.env_disable);
        assert!(signals.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn non_tty_stdout_suppresses() {
        unsafe {
            std::env::remove_var("GIT_SPAN_DISABLE_UPDATE_CHECK");
        }
        let signals = signals_for_argv(&["git-span", "list"], false);
        assert!(!signals.stdout_is_tty);
        assert!(signals.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn list_porcelain_is_machine_output() {
        unsafe {
            std::env::remove_var("GIT_SPAN_DISABLE_UPDATE_CHECK");
        }
        let signals = signals_for_argv(&["git-span", "list", "--porcelain"], true);
        assert!(signals.machine_flags);
        assert!(signals.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn list_oneline_is_machine_output() {
        let signals = signals_for_argv(&["git-span", "list", "--oneline"], true);
        assert!(signals.machine_flags);
        assert!(signals.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn drift_json_and_porcelain_are_machine_output() {
        for argv in [
            &["git-span", "drift", "--format", "json"][..],
            &["git-span", "drift", "--format", "porcelain"][..],
        ] {
            let signals = signals_for_argv(argv, true);
            assert!(signals.machine_flags, "{argv:?}");
            assert!(signals.suppressed(), "{argv:?}");
        }
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn json_formatted_writes_are_machine_output() {
        for argv in [
            &["git-span", "add", "s", "f.txt", "--format", "json"][..],
            &["git-span", "replace", "s", "a.txt", "b.txt", "--format", "json"][..],
            &["git-span", "why", "s", "because", "--format", "json"][..],
            &["git-span", "resolve", "s", "--format", "json"][..],
            &["git-span", "tree", "f.txt", "--format", "json"][..],
            &["git-span", "history", "s", "--format", "json"][..],
        ] {
            let signals = signals_for_argv(argv, true);
            assert!(signals.machine_flags, "{argv:?}");
            assert!(signals.suppressed(), "{argv:?}");
        }
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn context_is_always_machine_output() {
        // `ContextFormat` has only a `Json` variant — the command's output
        // is machine-readable by construction, whatever the flags say.
        let signals = signals_for_argv(&["git-span", "context", "f.txt"], true);
        assert!(signals.machine_flags);
        assert!(signals.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn merge_driver_is_machine_output_and_internal() {
        let signals = signals_for_argv(
            &["git-span", "merge-driver", "base", "ours", "theirs", "7"],
            true,
        );
        assert!(signals.machine_flags, "git's own protocol is machine output");
        assert!(signals.internal, "merge-driver is a git-invoked internal");
        assert!(signals.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn internal_subcommands_never_engage() {
        let service = signals_for_argv(
            &[
                "git-span",
                "__context-service",
                "--service-key",
                "k",
                "--nonce",
                "n",
                "--span-root",
                "r",
            ],
            true,
        );
        assert!(service.internal);
        assert!(service.suppressed());

        let child = signals_for_argv(&["git-span", "__update-check"], true);
        assert!(child.internal, "the child must not recurse");
        assert!(child.suppressed());
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn human_formats_are_not_machine_output() {
        unsafe {
            std::env::remove_var("GIT_SPAN_DISABLE_UPDATE_CHECK");
        }
        for argv in [
            &["git-span", "show", "s"][..],
            &["git-span", "list"][..],
            &["git-span", "drift"][..],
            &["git-span", "add", "s", "f.txt"][..],
            &["git-span", "remove", "s", "f.txt"][..],
            &["git-span", "replace", "s", "a.txt", "b.txt"][..],
            &["git-span", "why", "s"][..],
            &["git-span", "delete", "s"][..],
            &["git-span", "doctor"][..],
            &["git-span", "tree", "f.txt"][..],
            &["git-span", "history", "s"][..],
            &["git-span", "resolve", "s"][..],
        ] {
            let signals = signals_for_argv(argv, true);
            assert!(!signals.machine_flags, "{argv:?}");
            assert!(!signals.internal, "{argv:?}");
            assert!(!signals.suppressed(), "{argv:?}");
        }
    }

    #[test]
    #[ignore = "Phase 3: suppression not implemented"]
    fn interactive_happy_path_is_not_suppressed() {
        unsafe {
            std::env::remove_var("GIT_SPAN_DISABLE_UPDATE_CHECK");
        }
        let signals = signals_for_argv(&["git-span", "list"], true);
        assert!(!signals.env_disable);
        assert!(!signals.machine_flags);
        assert!(signals.stdout_is_tty);
        assert!(!signals.internal);
        assert!(!signals.suppressed());
    }
}
