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
//!   `replace` / `why` (write mode) / `resolve` / `tree` / `history` with
//!   `--format` other than human — `why` in read mode always prints prose,
//!   so an interactive read-mode invocation stays interactive; `context`
//!   always (its `ContextFormat` has only a `Json` variant);
//!   `merge-driver` always (git's own protocol).
//! * `stdout_is_tty` — false when stdout is not a terminal (extension,
//!   mini-swe-agent, scripts, git-hook invocations); the fail-closed
//!   backstop for anything the typed match misses.
//! * `internal` — hidden/internal subcommands (`__context-service`,
//!   `__update-check`, `merge-driver`) never engage or remind, so the
//!   detached child cannot recurse.

use crate::cli::{
    AddFormat, Cli, Commands, DriftFormat, HistoryFormat, ReplaceFormat, ResolveFormat, TreeFormat,
    WhyFormat,
};

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
        self.env_disable || self.machine_flags || !self.stdout_is_tty || self.internal
    }
}

/// Whether the parsed command's *effective output format* is machine-
/// readable. A typed match over the command's actual variant fields, kept
/// adjacent to `Commands` so a future machine-readable flag extends it here —
/// not a flag enumeration.
fn is_machine_output(command: &Commands) -> bool {
    match command {
        Commands::List(args) => args.porcelain || args.oneline,
        Commands::Drift(args) => args.format != DriftFormat::Human,
        Commands::Add(args) => args.format != AddFormat::Human,
        Commands::Replace(args) => args.format != ReplaceFormat::Human,
        // `--format` applies to the write mode only — read mode always
        // prints prose, so a read-mode `why --format json` is an
        // interactive human invocation and must not suppress the note.
        Commands::Why(args) => args.why_text.is_some() && args.format != WhyFormat::Human,
        Commands::Resolve(args) => args.format != ResolveFormat::Human,
        Commands::Tree(args) => args.format != TreeFormat::Human,
        Commands::History(args) => args.format != HistoryFormat::Human,
        // `ContextFormat` has only a `Json` variant — the command's output
        // is machine-readable by construction.
        Commands::Context(_) => true,
        // git's own merge-driver protocol is machine output.
        Commands::MergeDriver(_) => true,
        // Every remaining command has a single human output form (show,
        // remove, delete, doctor, the hidden internal pair).
        _ => false,
    }
}

/// Whether the command is a hidden/internal subcommand that must never
/// engage the update check (the detached child itself included — it would
/// otherwise recurse).
fn is_internal(command: &Commands) -> bool {
    matches!(
        command,
        Commands::ContextService(_) | Commands::UpdateCheck | Commands::MergeDriver(_)
    )
}

/// Compute the suppression signals for a parsed [`Cli`]. `stdout_is_tty` is
/// injected by the call site (`std::io::stdout().is_terminal()`), so the
/// unit matrix can exercise the TTY=true half without a PTY.
///
/// `machine_flags` is a typed match over the command's effective output
/// format, kept adjacent to `Commands` so future machine-readable flags
/// extend it — not a flag enumeration.
pub fn signals_for(cli: &Cli, stdout_is_tty: bool) -> SuppressionSignals {
    let env_disable = std::env::var_os("GIT_SPAN_DISABLE_UPDATE_CHECK").is_some();
    let machine_flags = cli
        .command
        .as_ref()
        .is_some_and(is_machine_output);
    let internal = cli.command.as_ref().is_some_and(is_internal);
    SuppressionSignals {
        env_disable,
        machine_flags,
        stdout_is_tty,
        internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    /// Serializes the env-mutating cases in this module: `set_var` /
    /// `remove_var` mutate process-global state, and the test harness runs
    /// cases in parallel — two cases racing on the same variables would
    /// flake nondeterministically. Env-touching cases take this lock.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Parse argv (with the leading binary name) and compute the signals.
    fn signals_for_argv(argv: &[&str], tty: bool) -> SuppressionSignals {
        let cli = Cli::try_parse_from(argv).expect("argv must parse");
        signals_for(&cli, tty)
    }

    #[test]
    fn env_disable_var_suppresses_interactive_use() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::set_var("GIT_SPAN_DISABLE_UPDATE_CHECK", "1");
        }
        let signals = signals_for_argv(&["git-span", "list"], true);
        assert!(signals.env_disable);
        assert!(signals.suppressed());
    }

    #[test]
    fn non_tty_stdout_suppresses() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::remove_var("GIT_SPAN_DISABLE_UPDATE_CHECK");
        }
        let signals = signals_for_argv(&["git-span", "list"], false);
        assert!(!signals.stdout_is_tty);
        assert!(signals.suppressed());
    }

    #[test]
    fn list_porcelain_is_machine_output() {
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::remove_var("GIT_SPAN_DISABLE_UPDATE_CHECK");
        }
        let signals = signals_for_argv(&["git-span", "list", "--porcelain"], true);
        assert!(signals.machine_flags);
        assert!(signals.suppressed());
    }

    #[test]
    fn list_oneline_is_machine_output() {
        let signals = signals_for_argv(&["git-span", "list", "--oneline"], true);
        assert!(signals.machine_flags);
        assert!(signals.suppressed());
    }

    #[test]
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
    fn context_is_always_machine_output() {
        // `ContextFormat` has only a `Json` variant — the command's output
        // is machine-readable by construction, whatever the flags say.
        let signals = signals_for_argv(&["git-span", "context", "f.txt"], true);
        assert!(signals.machine_flags);
        assert!(signals.suppressed());
    }

    #[test]
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
    fn human_formats_are_not_machine_output() {
        let _guard = ENV_LOCK.lock().unwrap();
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
            // Read-mode `why` always prints prose even with `--format json`
            // — the flag applies to the write mode only, so the invocation
            // stays interactive and must not suppress the note.
            &["git-span", "why", "s", "--format", "json"][..],
            &["git-span", "delete", "s"][..],
            &["git-span", "doctor"][..],
            &["git-span", "tree", "f.txt"][..],
            &["git-span", "history", "s"][..],
            &["git-span", "resolve", "s"][..],
            // `config` is human-only in both modes: a read prints the
            // effective configuration, and a write reports the transition —
            // neither has a machine format to suppress on.
            &["git-span", "config", "s"][..],
            &["git-span", "config", "s", "copy_detection", "off"][..],
        ] {
            let signals = signals_for_argv(argv, true);
            assert!(!signals.machine_flags, "{argv:?}");
            assert!(!signals.internal, "{argv:?}");
            assert!(!signals.suppressed(), "{argv:?}");
        }
    }

    #[test]
    fn interactive_happy_path_is_not_suppressed() {
        let _guard = ENV_LOCK.lock().unwrap();
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
