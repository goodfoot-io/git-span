/**
 * Codex Stop hook — per-session snapshot cleanup.
 *
 * Fires on every stop (Stop has no matcher). Removes this session's snapshot
 * records, tombstones, and activity entries, plus the per-repo index entries
 * (repos read from the records) — the plan's stop trigger, so a session's
 * snapshot state never outlives its session. Fail-open — cleanup errors never
 * abort the harness's shutdown.
 */

import { type HookContext, type StopInput, stopHook } from '@goodfoot/codex-hooks';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createSnapshotStore } from '../common/snapshot-store.js';

/**
 * The cleanup handler. Extracted from the default export so a test can
 * construct one over a scratch layout: a default export binds
 * {@link DEFAULT_SESSION_LAYOUT} at module load, so a test that awaited it
 * would sweep the developer's live session state no matter where its own
 * fixtures lived.
 */
export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: StopInput, ctx: HookContext) => {
    try {
      // removeSession removes the records, tombstones, and activity
      // entries for this session and the index entries for the repos read from
      // the records.
      createSnapshotStore(ctx.logger, undefined, layout).removeSession(input.session_id);
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span stop cleanup failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

export default stopHook({ timeout: 10_000 }, createHandler());
