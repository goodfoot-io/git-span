/** Codex PreToolUse planner for every supported shell envelope. */

import { dirname, join, resolve as resolvePath } from 'node:path';
import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/agent-hooks/codex';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import { type CommitRuntimeOptions, enrollCommitInvocation } from '../common/commit-runtime.js';
import { isRecord } from '../common/guards.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import {
  EXECUTION_PLAN_FLAG,
  executionPlanCommand,
  isExecutionPlanCommand,
  runExecutionPlan
} from './execution-plan.js';
import { narrowShellExecutions } from './shell-input.js';

/** Extract a shell command and the workdir carried by classic/code-mode envelopes. */
export function narrowShellPlanInput(toolInput: unknown): { command: string; workdir: string | null } | null {
  const result = narrowShellExecutions(toolInput);
  const only = result.executions.length === 1 ? result.executions[0] : undefined;
  return only === undefined ? null : { command: only.command, workdir: only.workdir };
}

export function createHandler(
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT,
  runtimeOptions: CommitRuntimeOptions = {}
) {
  const options = { stateRoot: join(dirname(layout.base), 'commit-receipts'), ...runtimeOptions };
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return undefined;
      if (!['Bash', 'shell', 'exec', 'local_shell', 'exec_command'].includes(input.tool_name)) return undefined;
      const narrowed = narrowShellExecutions(input.tool_input);
      if (narrowed.executions.length === 0) {
        if (narrowed.matched) ctx.logger.warn('Codex code-mode exec envelope is not statically recoverable');
        return undefined;
      }
      const canonical = narrowed.executions[0];
      if (
        input.tool_name === 'Bash' &&
        narrowed.executions.length === 1 &&
        canonical?.workdir === null &&
        isRecord(input.tool_input) &&
        typeof input.tool_input.command === 'string'
      ) {
        if (isExecutionPlanCommand(input.tool_input.command)) return undefined;
        if (canonical.background) {
          ctx.logger.warn('git-span commit attribution does not support visible background or delegated execution');
          return undefined;
        }
        const command = executionPlanCommand(
          {
            version: 1,
            sessionId: input.session_id,
            toolUseId: input.tool_use_id,
            toolInput: { ...input.tool_input, command: input.tool_input.command },
            layoutBase: layout.base,
            options: {
              stateRoot: options.stateRoot,
              ...(options.notesExecutable ? { notesExecutable: options.notesExecutable } : {}),
              ...(options.lockExecutable ? { lockExecutable: options.lockExecutable } : {})
            },
            ...(input.transcript_path ? { transcriptLocator: input.transcript_path } : {})
          },
          import.meta.url
        );
        if (command === null) {
          ctx.logger.warn('git-span execution-directory plan exceeds the supported command payload limit');
          return undefined;
        }
        return preToolUseOutput({
          permissionDecision: 'allow',
          updatedInput: { ...input.tool_input, command }
        });
      }
      const cwd = input.cwd ?? '';
      const commands = narrowed.executions.map((item) => ({
        command: item.command,
        cwd: item.workdir === null ? cwd : resolvePath(cwd, item.workdir)
      }));
      const first = commands[0];
      if (first === undefined) return undefined;
      // The touch store owns one plan per tool ID. Batch touches are recovered per command post-execution.
      if (commands.length === 1) {
        planBashTouches(
          first.command,
          first.cwd,
          input.session_id,
          input.tool_use_id,
          ctx.logger,
          createDefaultPlannedTouchStore(layout)
        );
      }
      // Observe every literal execution context without replacing the original input.
      const toolInput = input.tool_input;
      if (!isRecord(toolInput)) return undefined;
      if (narrowed.executions.some((item) => item.background)) {
        ctx.logger.warn('git-span commit attribution does not support visible background or delegated execution');
        return undefined;
      }
      const result = await enrollCommitInvocation(
        {
          host: 'codex',
          sessionId: input.session_id,
          toolUseId: input.tool_use_id,
          cwd: first.cwd,
          toolInput,
          command: first.command,
          additionalCommands: commands.slice(1),
          ...(input.transcript_path ? { transcriptLocator: input.transcript_path } : {})
        },
        options,
        ctx.logger
      );
      if (result.kind !== 'enrolled') {
        ctx.logger.warn('git-span commit attribution enrollment unavailable', { reason: result.reason });
        return undefined;
      }
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span static Bash pre-plan failed closed for attribution', { err });
      return undefined;
    }
  };
}

export const STATIC_PLAN_PRE_MATCHER = 'Bash|shell|exec|local_shell|exec_command';

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

// The emitted SDK entry calls execute() after this module. Helper mode must finish first.
if (process.argv[2] === EXECUTION_PLAN_FLAG) {
  await runExecutionPlan(process.argv[3] ?? '');
  process.exit(0);
}

export default preToolUseHook(
  { matcher: 'Bash|shell|exec|local_shell|exec_command', timeout: 10_000 },
  createHandler()
);
