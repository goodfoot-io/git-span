/** Claude PreToolUse planner for bounded static Bash attribution. */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type HookContext,
  type PreToolUseInput,
  preToolUseHook,
  preToolUseOutput
} from '@goodfoot/agent-hooks/claude-code';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import { type CommitRuntimeOptions, dispatchCommitShim, enrollCommitInvocation } from '../common/commit-runtime.js';
import { isRecord } from '../common/guards.js';
import { disableUpdateCheck } from '../common/update-check-env.js';

/** Narrow the Claude Bash input to a non-empty command string. */
export function narrowCommand(toolInput: unknown): string | null {
  if (!isRecord(toolInput)) return null;
  const command = toolInput.command;
  return typeof command === 'string' && command.length > 0 ? command : null;
}

export function createHandler(
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT,
  runtimeOptions: CommitRuntimeOptions = {},
  bundlePath: string = fileURLToPath(import.meta.url)
) {
  const options = { stateRoot: join(dirname(layout.base), 'commit-receipts'), ...runtimeOptions };
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return null;
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      planBashTouches(
        command,
        input.cwd ?? '',
        input.session_id,
        input.tool_use_id,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      // Only the actual host's normalized Bash envelope supports input replacement.
      const toolInput = input.tool_input;
      if (input.tool_name !== 'Bash' || !isRecord(toolInput) || typeof toolInput.command !== 'string') return null;
      if (toolInput.run_in_background === true || toolInput.background === true || toolInput.delegate === true) {
        ctx.logger.warn('git-span commit attribution does not support visible background or delegated execution');
        return null;
      }
      const result = await enrollCommitInvocation(
        {
          host: 'claude',
          sessionId: input.session_id,
          toolUseId: input.tool_use_id,
          cwd: input.cwd ?? '',
          toolInput,
          ...(input.transcript_path ? { transcriptLocator: input.transcript_path } : {}),
          bundlePath
        },
        options,
        ctx.logger
      );
      if (result.kind !== 'enrolled') {
        ctx.logger.warn('git-span commit attribution enrollment unavailable', { reason: result.reason });
        return null;
      }
      return preToolUseOutput({ hookSpecificOutput: { updatedInput: result.updatedInput } });
    } catch (err) {
      ctx.logger.warn('git-span static Bash pre-plan failed closed for attribution', { err });
      return null;
    }
  };
}

export const STATIC_PLAN_PRE_MATCHER = 'Bash';

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
if (process.argv[2] === '--git-span-commit-shim') {
  await dispatchCommitShim();
  process.exit(0);
}

disableUpdateCheck();

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
