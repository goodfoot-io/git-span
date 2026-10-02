/** Codex Stop hook — eager cleanup of session memo and planned touches. */

import { dirname, join } from 'node:path';
import { type HookContext, type StopInput, stopHook } from '@goodfoot/agent-hooks/codex';
import { cleanupSessionState, DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { type CommitRuntimeOptions, cleanupCommitInvocations } from '../common/commit-runtime.js';
import { disableUpdateCheck } from '../common/update-check-env.js';

/**
 * The cleanup handler. Extracted from the default export so a test can
 * construct one over a scratch layout: a default export binds
 * {@link DEFAULT_SESSION_LAYOUT} at module load, so a test that awaited it
 * would sweep the developer's live session state no matter where its own
 * fixtures lived.
 */
export function createHandler(
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT,
  runtimeOptions: CommitRuntimeOptions = {}
) {
  return async (input: StopInput, ctx: HookContext) => {
    try {
      await cleanupCommitInvocations(
        'codex',
        input.session_id,
        { stateRoot: join(dirname(layout.base), 'commit-receipts'), ...runtimeOptions },
        ctx.logger
      );
    } catch (err) {
      ctx.logger.warn('git-span completed commit receipt cleanup failed', { err });
    }
    try {
      cleanupSessionState(layout, input.session_id);
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
