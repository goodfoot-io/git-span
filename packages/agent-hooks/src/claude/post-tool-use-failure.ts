/** Claude failed Bash events routed through the static touch driver. */

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
import { createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import { createDefaultTouchExecutors, type TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowCommand } from './static-plan.js';

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) {
  return async (input: PostToolUseFailureInput, ctx: HookContext) => {
    try {
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      const blocks = await runLayeredBashTouches(
        command,
        input.cwd ?? '',
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

export default postToolUseFailureHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
