/**
 * Codex SubagentStop hook — per-subagent snapshot cleanup.
 *
 * Fires when a subagent stops. Removes this session's snapshot records
 * carrying the subagent's `agent_id` (the PreToolUse snapshot adapters record
 * `agent_id` when present) and their index entries — the plan's
 * subagent-stop trigger, keeping a completed subagent's records from
 * lingering to mis-attribute a later sibling's writes. Fail-open — cleanup
 * errors never abort the harness.
 */

import { type HookContext, type SubagentStopInput, subagentStopHook } from '@goodfoot/codex-hooks';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createSnapshotStore } from '../common/snapshot-store.js';

/**
 * The cleanup handler, extracted from the default export for the same reason
 * as the Stop hook's: a default export binds {@link DEFAULT_SESSION_LAYOUT} at
 * module load and can never be pointed at a test's scratch directory.
 */
export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: SubagentStopInput, ctx: HookContext) => {
    try {
      // removeSession with agentId removes only the records carrying
      // this subagent's agent_id (and their index entries); the main session's
      // records are left for the Stop hook.
      createSnapshotStore(ctx.logger, undefined, layout).removeSession(input.session_id, input.agent_id);
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span subagent-stop cleanup failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

export default subagentStopHook({ timeout: 10_000 }, createHandler());
