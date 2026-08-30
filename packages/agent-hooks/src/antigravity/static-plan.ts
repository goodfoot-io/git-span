/**
 * Antigravity PreToolUse planner — persist the bounded pre-state pieces of
 * Bash attribution (planned deletes, pre-edit ranges, pre-command EOF) that
 * cannot be reconstructed safely after execution.
 *
 * The fourth twin of claude/codex/opencode `static-plan.ts`, keyed
 * `conversationId` + `stepIdx` instead of `session_id` + `tool_use_id` — the
 * disk-backed planned-touch store fits as-is, since Antigravity hooks are
 * fresh subprocesses per event and the store was already cross-process.
 */

import {
  type HookContext,
  type PreToolUseInput,
  preToolUseHook,
  preToolUseOutput
} from '@goodfoot/agent-hooks/antigravity';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowRunCommand, resolveCallCwd } from './run-command.js';

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    // Every path replies an explicit allow: the live host treats a `{}`
    // PreToolUse reply as a deny with an empty reason (CONTRACT.md marks
    // `decision` as required), so silence here would block the tool call.
    try {
      const call = narrowRunCommand(input.toolCall);
      if (call === null) return preToolUseOutput({ decision: 'allow' });
      planBashTouches(
        call.command,
        resolveCallCwd(call, input.workspacePaths),
        input.conversationId,
        String(input.stepIdx),
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      return preToolUseOutput({ decision: 'allow' });
    } catch (err) {
      ctx.logger.warn('git-span static Bash pre-plan failed closed for attribution', { err });
      return preToolUseOutput({ decision: 'allow' });
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default preToolUseHook({ matcher: 'run_command', timeout: 10_000 }, createHandler());
