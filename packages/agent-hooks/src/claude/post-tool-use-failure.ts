/** Claude failed Bash events routed through the static touch driver. */

import { dirname, join } from 'node:path';
import {
  type HookContext,
  type PostToolUseFailureInput,
  postToolUseFailureHook,
  postToolUseFailureOutput
} from '@goodfoot/agent-hooks/claude-code';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import {
  createDefaultPlannedTouchStore,
  failureBashResponse,
  runLayeredBashTouches
} from '../common/bash-attribution.js';
import { type CommitRuntimeOptions, terminalCommitInvocation } from '../common/commit-runtime.js';
import { createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import { createDefaultTouchExecutors, type TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowCommand } from './static-plan.js';

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT,
  runtimeOptions: CommitRuntimeOptions = {}
) {
  const options = { stateRoot: join(dirname(layout.base), 'commit-receipts'), ...runtimeOptions };
  return async (input: PostToolUseFailureInput, ctx: HookContext) => {
    let original: Awaited<ReturnType<typeof terminalCommitInvocation>>['original'] = null;
    if (input.tool_name === 'Bash' && input.session_id && input.tool_use_id) {
      try {
        original = (
          await terminalCommitInvocation(
            {
              host: 'claude',
              sessionId: input.session_id,
              toolUseId: input.tool_use_id
            },
            options,
            ctx.logger
          )
        ).original;
      } catch (err) {
        ctx.logger.warn('git-span terminal commit attribution failed', { err });
      }
    }
    try {
      const command = original?.command ?? narrowCommand(input.tool_input);
      if (command === null) return null;
      const blocks = await runLayeredBashTouches(
        command,
        original?.cwd ?? input.cwd ?? '',
        input.session_id,
        input.tool_use_id,
        failureBashResponse(input),
        executors,
        memoFactory(ctx.logger, layout),
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      if (blocks.length === 0) return null;
      return postToolUseFailureOutput({
        hookSpecificOutput: { additionalContext: blocks.join('') }
      });
    } catch (err) {
      ctx.logger.warn('git-span failed Bash attribution failed open', { err });
      return null;
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postToolUseFailureHook({ matcher: 'Bash', timeout: 15_000 }, createHandler());
