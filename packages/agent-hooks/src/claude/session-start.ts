/** Claude SessionStart hook — warm the repository context service off-path. */

import { type HookContext, type SessionStartInput, sessionStartHook } from '@goodfoot/agent-hooks/claude-code';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { startContextWarmup, type WarmupSpawner } from '../common/context-warmup.js';
import { resetExposure } from '../common/span-surface.js';
import { disableUpdateCheck } from '../common/update-check-env.js';

export function createHandler(spawnProcess?: WarmupSpawner, layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: SessionStartInput, ctx: HookContext) => {
    // SessionStart source is a host lifecycle event (including compact/resume), not a guessed turn boundary.
    resetExposure(layout, input.session_id, ctx.logger);
    try {
      startContextWarmup(
        input.cwd,
        (err) => ctx.logger.warn('git-span context warm-up child failed', { err }),
        spawnProcess
      );
    } catch (err) {
      ctx.logger.warn('git-span context warm-up failed open', { err });
    }
    return null;
  };
}

disableUpdateCheck();

export default sessionStartHook({ timeout: 1_000 }, createHandler());
