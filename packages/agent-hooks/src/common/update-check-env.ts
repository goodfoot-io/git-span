/**
 * The hook-side half of git-span's update-check suppression contract.
 *
 * git-span's daily update check must never fire during automated use, and
 * its suppression is two-layered: an explicit `GIT_SPAN_*` env var set by
 * automated callers, plus structural detection (non-TTY stdout,
 * machine-readable output flags) as the fail-closed backstop. This module is
 * the explicit layer for the agent-hooks package: every hook entry point
 * (the sources wired by `plugins-claude/git-span/hooks/hooks.json` and
 * `plugins-codex/git-span/hooks/hooks.json`) calls
 * {@link disableUpdateCheck} at module scope, before any executor runs, so
 * every `git span` child the hook process spawns inherits the var through
 * the process environment.
 */

/** Set the suppression var for this process and every child it spawns. */
export function disableUpdateCheck(): void {
  process.env.GIT_SPAN_DISABLE_UPDATE_CHECK = '1';
}
