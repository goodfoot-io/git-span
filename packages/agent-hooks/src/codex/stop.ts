/** Codex Stop hook — eager cleanup of session memo and planned touches. */

import { type HookContext, type StopInput, stopHook } from '@goodfoot/codex-hooks';
import { cleanupSessionState, DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';

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
      cleanupSessionState(layout, input.session_id);
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span stop cleanup failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

export default stopHook({ timeout: 10_000 }, createHandler());
