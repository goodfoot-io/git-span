/** Claude SessionEnd hook — eager cleanup of session memo and planned touches. */

import { type HookContext, type SessionEndInput, sessionEndHook } from '@goodfoot/claude-code-hooks';
import { cleanupSessionState, DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';

/**
 * Exported so mini-swe registers the same lifecycle and tests can inject a
 * scratch layout instead of binding the production base at module load.
 */
export const createHandler =
  (layout: SessionLayout = DEFAULT_SESSION_LAYOUT) =>
  async (input: SessionEndInput, ctx: HookContext) => {
    try {
      cleanupSessionState(layout, input.session_id);
      return null;
    } catch (err) {
      ctx.logger.warn('git-span session state cleanup failed open on an uncaught error', { err });
      return null;
    }
  };

export default sessionEndHook({ timeout: 10_000 }, createHandler());
