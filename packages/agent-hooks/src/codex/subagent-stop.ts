/**
 * Codex SubagentStop hook — per-subagent snapshot cleanup.
 *
 * Fires when a subagent stops. Removes this session's snapshot records
 * carrying the subagent's `agent_id` (the PreToolUse snapshot adapters record
 * `agent_id` when present) and their index entries — the plan's
 * subagent-stop trigger, keeping a completed subagent's records from
 * lingering to mis-attribute a later sibling's writes. Phase 1: thin handler
 * driving the `Not Implemented` store stub; fail-open — cleanup errors never
 * abort the harness.
 */

import { type HookContext, type SubagentStopInput, subagentStopHook } from '@goodfoot/codex-hooks';
import { createSnapshotStore } from '../common/snapshot-store.js';

export default subagentStopHook({ timeout: 10_000 }, async (input: SubagentStopInput, ctx: HookContext) => {
  try {
    // Phase 3: removeSession with agentId removes only the records carrying
    // this subagent's agent_id (and their index entries); the main session's
    // records are left for the Stop hook.
    createSnapshotStore(ctx.logger).removeSession(input.session_id, input.agent_id);
    return undefined;
  } catch (err) {
    ctx.logger.warn('git-span subagent-stop cleanup failed open on an uncaught error', { err });
    return undefined;
  }
});
