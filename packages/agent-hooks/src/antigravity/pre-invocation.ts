/**
 * Antigravity PreInvocation warm-up — spawn a detached, unref'd
 * `git span context --warm` so the scan cache is hot before the first tool
 * call needs it. The frame is the first workspace root; with no workspace
 * paths there is nothing to warm and the handler fails open.
 *
 * The hook fires on every invocation, not just the first: warming is
 * idempotent (`--warm` owns its own freshness check and takes a 1-second lock
 * wait), and PreInvocation has no cheap cross-invocation "already warmed"
 * signal worth building for a no-op re-run.
 */

import { type HookContext, type PreInvocationInput, preInvocationHook } from '@goodfoot/agent-hooks/antigravity';
import { startContextWarmup, type WarmupSpawner } from '../common/context-warmup.js';
import { disableUpdateCheck } from '../common/update-check-env.js';

export function createHandler(spawner?: WarmupSpawner) {
  return async (input: PreInvocationInput, ctx: HookContext) => {
    try {
      const cwd = input.workspacePaths[0];
      if (cwd === undefined || cwd.length === 0) return undefined;
      startContextWarmup(
        cwd,
        (error) => {
          ctx.logger.warn('git-span context warm-up spawn failed open', { err: error });
        },
        spawner
      );
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span context warm-up failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default preInvocationHook({ timeout: 10_000 }, createHandler());
