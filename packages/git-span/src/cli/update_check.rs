//! Handler for the hidden `__update-check` subcommand — the body of the
//! detached daily check child spawned by a foreground `git span` command.

use anyhow::Result;

/// Stub handler: always exits 0. The real child body
/// (`update_check::run_update_check_child`) is Phase 3 — nothing the update
/// check does may change a command's exit code, so the handler's success
/// path is pinned even before the body exists.
pub fn run_update_check() -> Result<i32> {
    Ok(0)
}
