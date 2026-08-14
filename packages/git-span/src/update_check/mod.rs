//! Daily update check for the git-span CLI and the bundled plugin caches.
//!
//! Once a day at most, on an interactive `git span` invocation, a user who
//! is behind the latest release sees a short informational note naming what
//! is out of date and the exact command that brings it current. The GitHub
//! API call and plugin-cache reads happen in a detached background child of
//! the invoking process; the foreground command's latency and exit code are
//! untouched; nothing blocks on any failure. Automated or scripted use never
//! triggers the check or the message (see [`suppress`]).
//!
//! Card main-246 implementation phases:
//!
//! * Phase 1 — this file's full contract surface, with stub bodies
//!   (`todo!()` / `None`); the signatures are final.
//! * Phase 2 — skipped (`#[ignore]`) checks against the stubs, unit checks
//!   in each submodule plus the integration cases in
//!   `tests/cases/update_check.rs`.
//! * Phase 3 — implement and unskip one concern at a time (store →
//!   releases → plugins → decide → message → suppress → orchestration →
//!   child handler).

pub mod decide;
pub mod message;
pub mod plugins;
pub mod releases;
pub mod store;
pub mod suppress;

use crate::cli::Cli;

/// Foreground seam, called from `dispatch` after span-root resolution and
/// the recovery-domain guard: read the suppression signals, decide whether
/// the 24h check cadence is due, and spawn the detached `__update-check`
/// child. Never waits on the child; a failure at any step is a silent no-op.
///
/// Phase 1 body: deliberate no-op, not `todo!()` — this seam runs on every
/// command's live dispatch path, and a panicking stub would break the whole
/// CLI (exit 101). Phase 3 replaces the body with suppress gate, cadence
/// read, and detached spawn.
pub fn maybe_engage(cli: &Cli) {
    let _ = cli;
}

/// Foreground seam, called on a command's `Ok` path: read the stored
/// findings and the reminder cadence, print the note when something is
/// behind, and stamp `last_reminded_at`. Never affects the command's output
/// beyond the note or its exit code.
///
/// Phase 1 body: deliberate no-op for the same reason as [`maybe_engage`] —
/// live dispatch path. Phase 3 replaces the body with the findings read,
/// render, print, and reminder stamp.
pub fn maybe_remind(cli: &Cli) {
    let _ = cli;
}

/// The `__update-check` child body: re-read `last_checked_at` at start
/// (another process may have refreshed it meanwhile), fetch the releases
/// payload, scan the plugin caches, stamp `last_checked_at` unconditionally
/// and the findings rows on success only.
pub fn run_update_check_child() {
    todo!("Phase 3: child-side re-check, fetch releases, scan plugins, write state")
}
