/**
 * Antigravity Stop hook — retire the conversation's call-scoped state (the
 * planned-touch store, the tool-call stash, undrained pending injections)
 * when the execution loop ends.
 *
 * Deliberately narrower than the Claude/Codex Stop hooks' whole-session
 * {@link cleanupSessionState}: Antigravity's Stop marks an execution-loop
 * boundary closer to a turn than a session end, so the surfaced-span memo
 * survives to keep identical spans from re-injecting every turn (see
 * {@link cleanupCallScopedState} for the full rationale); the layout's TTL
 * sweep retires the memo with the rest of the session directory.
 *
 * Never returns `decision: "continue"` — that would block the stop and
 * re-enter the loop, which no cleanup failure could ever justify.
 */

import { type HookContext, type StopInput, stopHook } from '@goodfoot/agent-hooks/antigravity';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { cleanupCallScopedState } from './stash.js';

/**
 * Extracted from the default export so a test can construct one over a
 * scratch layout: a default export binds {@link DEFAULT_SESSION_LAYOUT} at
 * module load, so a test that awaited it would sweep the developer's live
 * session state no matter where its own fixtures lived.
 */
export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: StopInput, ctx: HookContext) => {
    try {
      cleanupCallScopedState(layout, input.conversationId);
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span stop cleanup failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default stopHook({ timeout: 10_000 }, createHandler());
