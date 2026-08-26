/** Claude SessionStart hook — warm the repository context service off-path. */

import { type HookContext, type SessionStartInput, sessionStartHook } from '@goodfoot/agent-hooks/claude-code';
import { startContextWarmup, type WarmupSpawner } from '../common/context-warmup.js';
import { disableUpdateCheck } from '../common/update-check-env.js';

export function createHandler(spawnProcess?: WarmupSpawner) {
  return async (input: SessionStartInput, ctx: HookContext) => {
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
