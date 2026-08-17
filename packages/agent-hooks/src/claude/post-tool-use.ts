/**
 * Claude PostToolUse adapter for tracked static-intent attribution.
 *
 * Bash commands run through the shared layered parser/driver. Response-derived
 * reads remain a separate pass inside that pipeline, while structured
 * Read/Edit/Write calls keep their purpose-built translation and are filtered
 * against the post-command index before touching spans.
 */

import {
  type HookContext,
  type PostToolUseInput,
  postToolUseHook,
  postToolUseOutput
} from '@goodfoot/claude-code-hooks';
import { DEFAULT_SESSION_LAYOUT, derivePath, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, postTrackedValue, runLayeredBashTouches } from '../common/bash-attribution.js';
import { createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  runTouchHook,
  type TouchExecutors,
  type TouchInput
} from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowCommand } from './static-plan.js';

type ToolInput = Record<string, unknown>;

function positiveIntField(toolInput: ToolInput, field: string): number | undefined {
  const raw = toolInput[field];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
}

function toTouchInput(
  toolName: string,
  toolInput: ToolInput,
  sessionId: string,
  cwd: string,
  filePath: string,
  invocationId: string | undefined
): TouchInput | null {
  if (toolName === 'Read') {
    return {
      kind: 'read',
      sessionId,
      cwd,
      filePath,
      ...(invocationId === undefined ? {} : { invocationId }),
      offset: positiveIntField(toolInput, 'offset'),
      limit: positiveIntField(toolInput, 'limit')
    };
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const raw = toolName === 'Edit' ? toolInput.new_string : toolInput.content;
    return {
      kind: 'write',
      sessionId,
      cwd,
      filePath,
      ...(invocationId === undefined ? {} : { invocationId }),
      written: typeof raw === 'string' ? raw : '',
      targetState: 'exists'
    };
  }
  return null;
}

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const memo = memoFactory(ctx.logger, layout);
    if (input.tool_name === 'Bash') {
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      const blocks = await runLayeredBashTouches(
        command,
        cwd,
        sessionId,
        input.tool_use_id,
        input.tool_response,
        executors,
        memo,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      if (blocks.length === 0) return null;
      const combined = blocks.join('');
      return postToolUseOutput({
        hookSpecificOutput: { additionalContext: combined },
        systemMessage: combined
      });
    }

    const toolInput = (input.tool_input ?? {}) as ToolInput;
    const absolutePath = derivePath(toolInput, cwd);
    if (absolutePath === null) return null;
    const touch = toTouchInput(
      input.tool_name,
      toolInput,
      sessionId,
      cwd,
      absolutePath,
      input.tool_use_id === undefined ? undefined : `${sessionId}:${input.tool_use_id}`
    );
    if (touch === null || postTrackedValue(absolutePath, touch, cwd) === null) return null;
    const output = await runTouchHook(touch, executors, memo);
    if (!output.additionalContext) return null;
    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: output.additionalContext },
      systemMessage: output.additionalContext
    });
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postToolUseHook({ matcher: 'Read|Edit|Write|Bash', timeout: 10_000 }, createHandler());
