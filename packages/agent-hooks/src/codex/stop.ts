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
import { createSnapshotStore } from '../common/snapshot-store.js';

export default stopHook({ timeout: 10_000 }, async (input: StopInput, ctx: HookContext) => {
  try {
    // removeSession removes the records, tombstones, and activity
    // entries for this session and the index entries for the repos read from
    // the records.
    createSnapshotStore(ctx.logger).removeSession(input.session_id);
    return undefined;
  } catch (err) {
    ctx.logger.warn('git-span stop cleanup failed open on an uncaught error', { err });
    return undefined;
  }
});
