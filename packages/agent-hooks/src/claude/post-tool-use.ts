/**
 * Claude PostToolUse adapter for tracked static-intent attribution.
 *
 * Bash commands run through the shared layered parser/driver. Response-derived
 * reads remain a separate pass inside that pipeline, while structured
 * Read/Edit/Write calls keep their purpose-built translation and are filtered
 * against the post-command index before touching spans.
 */

import { dirname, join } from 'node:path';
import {
  type HookContext,
  type PostToolUseInput,
  postToolUseHook,
  postToolUseOutput
} from '@goodfoot/agent-hooks/claude-code';
import { DEFAULT_SESSION_LAYOUT, derivePath, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, postTrackedValue, runLayeredBashTouches } from '../common/bash-attribution.js';
import { bashResponseExitCode, bashResponseInterrupted } from '../common/bash-touch.js';
import type { CommitInspectionContextExecutor } from '../common/commit-inspection-context.js';
import { type CommitRuntimeOptions, terminalCommitInvocation } from '../common/commit-runtime.js';
import { firstWriteGuidance } from '../common/first-write-guidance.js';
import { isRecord } from '../common/guards.js';
import { claudeReadExposure } from '../common/read-exposure.js';
import { createDiskMemoStore, type MemoFactory, resolveTouchScope } from '../common/span-surface.js';
import {
  createDefaultTouchExecutors,
  DEFAULT_READ_LIMIT,
  fileExists,
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
  invocationId: string | undefined,
  response: unknown,
  recipientId: string
): TouchInput | null {
  if (toolName === 'Read') {
    return {
      kind: 'read',
      recipientResetSupported: true,
      recipientId,
      observedRange: claudeReadExposure(response),
      broadDiscovery: toolInput.offset === undefined && toolInput.limit === undefined,
      sessionId,
      cwd,
      filePath,
      ...(invocationId === undefined ? {} : { invocationId }),
      offset: positiveIntField(toolInput, 'offset'),
      limit:
        positiveIntField(toolInput, 'limit') ??
        (positiveIntField(toolInput, 'offset') === undefined ? undefined : DEFAULT_READ_LIMIT)
    };
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const raw = toolName === 'Edit' ? toolInput.new_string : toolInput.content;
    return {
      kind: 'write',
      recipientResetSupported: true,
      recipientId,
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
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT,
  runtimeOptions: CommitRuntimeOptions = {},
  inspectionExecutor?: CommitInspectionContextExecutor
) {
  const options = { stateRoot: join(dirname(layout.base), 'commit-receipts'), ...runtimeOptions };
  return async (input: PostToolUseInput, ctx: HookContext) => {
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
    const sessionId = input.session_id;
    const cwd = original?.cwd ?? input.cwd ?? '';
    const memo = memoFactory(ctx.logger, layout);
    if (input.tool_name === 'Bash') {
      const command = original?.command ?? narrowCommand(input.tool_input);
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
        createDefaultPlannedTouchStore(layout),
        {
          successful:
            !bashResponseInterrupted(input.tool_response) && (bashResponseExitCode(input.tool_response) ?? 0) === 0,
          executor: inspectionExecutor,
          onWrite: () => firstWriteGuidance(sessionId, memo, true)
        }
      );
      if (blocks.length === 0) return null;
      const combined = blocks.join('');
      return postToolUseOutput({
        hookSpecificOutput: { additionalContext: combined },
        systemMessage: combined
      });
    }

    const rawToolInput = input.tool_input;
    const toolInput: ToolInput = isRecord(rawToolInput) ? rawToolInput : {};
    const absolutePath = derivePath(toolInput, cwd);
    if (absolutePath === null) return null;
    const touch = toTouchInput(
      input.tool_name,
      toolInput,
      sessionId,
      cwd,
      absolutePath,
      input.tool_use_id === undefined ? undefined : `${sessionId}:${input.tool_use_id}`,
      input.tool_response,
      input.transcript_path
    );
    if (touch === null) return null;
    const rawWritten = input.tool_name === 'Edit' ? toolInput.new_string : toolInput.content;
    const guidance = firstWriteGuidance(
      sessionId,
      memo,
      touch.kind === 'write' &&
        typeof rawWritten === 'string' &&
        fileExists(absolutePath) &&
        resolveTouchScope(cwd, absolutePath) !== null &&
        !(
          isRecord(input.tool_response) &&
          (input.tool_response.is_error === true || input.tool_response.error !== undefined)
        )
    );
    if (postTrackedValue(absolutePath, touch, cwd) === null)
      return guidance === null
        ? null
        : postToolUseOutput({
            hookSpecificOutput: { additionalContext: guidance },
            systemMessage: guidance
          });
    // ctx.logger doubles as the core logger: render defects warn inside the
    // core, and a non-null diagnostics failure (the structured path's only
    // record of a degraded context query) is surfaced on the hook log.
    let context: string | null = null;
    try {
      context = (await runTouchHook(touch, executors, memo, undefined, ctx.logger)).additionalContext;
    } catch (err) {
      if (guidance === null) throw err;
      ctx.logger.warn('git-span structured context delivery failed after a successful write', { err });
    }
    const combined = [context, guidance].filter((part): part is string => part !== null).join('\n');
    if (!combined) return null;
    return postToolUseOutput({
      hookSpecificOutput: { additionalContext: combined },
      systemMessage: combined
    });
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postToolUseHook({ matcher: 'Read|Edit|Write|Bash', timeout: 40_000 }, createHandler());
