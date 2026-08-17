//! Handler for the hidden `__update-check` subcommand — the body of the
//! detached daily check child spawned by a foreground `git span` command.
//!
//! Runs the child body synchronously — re-check the cadence, fetch the
//! releases payload, scan the plugin caches, stamp the store — and exits 0
//! whatever the body did. The update check must never change a command's
//! exit code, and the parent never waits on this child; the
//! `last_checked_at` re-check at the start of
//! [`run_update_check_child`](crate::update_check::run_update_check_child)
//! keeps parallel invocations from fetching twice.

use anyhow::Result;

/// Run the child body once and exit 0 — nothing the update check does may
/// change a command's exit code, so the success path is pinned regardless of
/// what the body accomplished.
pub fn run_update_check() -> Result<i32> {
    crate::update_check::run_update_check_child();
    Ok(0)
}
