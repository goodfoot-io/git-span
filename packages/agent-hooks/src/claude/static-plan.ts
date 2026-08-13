/** Claude PreToolUse planner for bounded static Bash attribution. */

import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/claude-code-hooks';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';

/** Narrow the Claude/mini-swe Bash input to a non-empty command string. */
export function narrowCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string' && command.length > 0) return command;
  }
  return null;
}

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
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
      return null;
    } catch (err) {
      ctx.logger.warn('git-span static Bash pre-plan failed closed for attribution', { err });
      return null;
    }
  };
}

export const STATIC_PLAN_PRE_MATCHER = 'Bash';

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
