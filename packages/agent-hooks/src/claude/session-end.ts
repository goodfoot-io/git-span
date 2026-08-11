/**
 * Claude SessionEnd hook — per-session snapshot cleanup.
 *
 * Fires on every exit reason (SessionEnd has no tool to match, so no
 * matcher). Removes this session's snapshot records, tombstones, and activity
 * entries, plus the per-repo index entries (repos read from the records) —
 * the plan's session-end trigger, so a session's snapshot state never
 * outlives its session. Phase 1: thin handler driving the `Not Implemented`
 * store stub; fail-open — cleanup errors never abort the harness's shutdown.
 */

import { type HookContext, type SessionEndInput, sessionEndHook } from '@goodfoot/claude-code-hooks';
import { createSnapshotStore } from '../common/snapshot-store.js';

/** The cleanup handler, exported so the mswea adapter registers the same one. */
export const createHandler = () => async (input: SessionEndInput, ctx: HookContext) => {
  try {
    // Phase 3: removeSession removes the records, tombstones, and activity
    // entries for this session and the index entries for the repos read from
    // the records.
    createSnapshotStore(ctx.logger).removeSession(input.session_id);
    return null;
  } catch (err) {
    ctx.logger.warn('git-span session-end cleanup failed open on an uncaught error', { err });
    return null;
  }
};

export default sessionEndHook({ timeout: 10_000 }, createHandler());
