/** Codex PostToolUse adapter for shell and apply_patch static attribution. */

import { dirname, join, resolve as resolvePath } from 'node:path';
import {
  type HookContext,
  type PostToolUseInput,
  postToolUseHook,
  postToolUseOutput
} from '@goodfoot/agent-hooks/codex';
import {
  DEFAULT_SESSION_LAYOUT,
  resolveFrame,
  resolveRepoRoot,
  type SessionLayout,
  toPosix
} from '../common/agent-hooks-common.js';
import { type PatchCandidate, runApplyPatchTouches } from '../common/apply-patch-touch.js';
import {
  createDefaultPlannedTouchStore,
  normalizeBashResponse,
  runLayeredBashTouches
} from '../common/bash-attribution.js';
import { bashResponseExitCode } from '../common/bash-touch.js';
import type { CommitInspectionContextExecutor } from '../common/commit-inspection-context.js';
import { type CommitRuntimeOptions, terminalCommitInvocation } from '../common/commit-runtime.js';
import { firstWriteGuidance } from '../common/first-write-guidance.js';
import { isRecord } from '../common/guards.js';
import { createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import type { PlannedTouchRecord } from '../common/static-attribution.js';
import { createDefaultTouchExecutors, type TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import {
  completedExecution,
  findExecution,
  polledExecution,
  retainExecution,
  yieldedExecution
} from './commit-exec.js';
import { narrowShellExecutions } from './shell-input.js';

const APPLY_PATCH_SUCCESS_PREFIX = 'Success. Updated the following files:';

/** Narrow the SDK's unknown apply_patch input. */
export function narrowApplyPatchCommand(toolInput: unknown): string | null {
  return isRecord(toolInput) && typeof toolInput.command === 'string' ? toolInput.command : null;
}

export { narrowCodeModeExec, narrowExecCommand } from './shell-input.js';

/** Classify apply_patch output; only the explicit success summary authorizes attribution. */
export function classifyApplyPatchResponse(toolResponse: unknown): 'success' | 'failure' | 'unknown' {
  if (Array.isArray(toolResponse)) return 'unknown';
  const normalized = normalizeBashResponse(toolResponse);
  if (normalized === null) return 'unknown';
  return normalized.stdout.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? 'success' : 'failure';
}

/**
 * Translate a retrieved disk-store plan into touch-pipeline candidates: the
 * record only applies when it was planned against this cwd's repo root, its
 * repo-relative paths resolve against the record's own root, and a delete is
 * pre-tracked exactly when the planner recorded tracked evidence.
 */
function plannedPatchCandidates(record: PlannedTouchRecord | null, cwd: string): PatchCandidate[] {
  const repoRoot = resolveRepoRoot(cwd);
  if (record === null || repoRoot === null || toPosix(record.repoRoot) !== toPosix(repoRoot)) return [];
  return record.touches.map((touch) => ({
    absolutePath: resolvePath(record.repoRoot, touch.repoRelativePath),
    operation:
      touch.operation === 'delete' ? 'delete' : touch.operation === 'create-overwrite' ? 'create-overwrite' : 'modify',
    ranges: touch.ranges,
    preTrackedDelete: touch.operation === 'delete' && touch.evidence?.kind === 'tracked'
  }));
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
    let shellTool = ['Bash', 'shell', 'local_shell', 'exec_command', 'exec'].includes(input.tool_name);
    const poll = input.tool_name === 'write_stdin';
    let invocationToolId = input.tool_use_id;
    if ((shellTool || poll) && input.session_id && input.tool_use_id) {
      try {
        const executionId = poll ? polledExecution(input.tool_input) : null;
        const identity = poll
          ? executionId === null
            ? null
            : findExecution(input.session_id, executionId, options)
          : { host: 'codex' as const, sessionId: input.session_id, toolUseId: input.tool_use_id };
        if (identity !== null) {
          invocationToolId = identity.toolUseId;
          const running = yieldedExecution(input.tool_response);
          if (running !== null) {
            if (!poll && narrowShellExecutions(input.tool_input).executions.length > 1) {
              ctx.logger.warn(
                'Codex raw code-mode batch yielded without per-command completion identities; preserving active observations'
              );
              return undefined;
            }
            await retainExecution(identity, running, options);
            return undefined;
          }
          if (poll && !completedExecution(input.tool_response)) return undefined;
          original = (await terminalCommitInvocation(identity, options, ctx.logger)).original;
        }
      } catch (err) {
        ctx.logger.warn('git-span terminal commit attribution failed', { err });
      }
    }
    if (poll) {
      if (original === null) return undefined;
      shellTool = true;
    }
    if (
      original === null &&
      input.tool_name === 'Bash' &&
      isRecord(input.tool_input) &&
      typeof input.tool_input.command === 'string' &&
      typeof input.tool_input.workdir !== 'string' &&
      typeof input.tool_input.cwd !== 'string'
    ) {
      ctx.logger.warn('git-span canonical Bash execution directory unknown; suppressing session-directory attribution');
      return undefined;
    }
    const cwd = original?.cwd ?? input.cwd ?? '';
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger, layout);
    if (shellTool) {
      const recovered = narrowShellExecutions(original?.input ?? input.tool_input);
      if (recovered.executions.length === 0) {
        if (recovered.matched)
          ctx.logger.warn('Codex code-mode exec envelope matched but its command is not statically recoverable');
        return undefined;
      }
      const blocks: string[] = [];
      const executions =
        original?.executions ??
        recovered.executions.map((execution, index) => ({
          command: execution.command,
          cwd:
            index === 0 && original !== null
              ? original.cwd
              : resolveFrame(execution.workdir ?? undefined, input.cwd ?? '')
        }));
      for (const execution of executions) {
        const effectiveCwd = execution.cwd;
        blocks.push(
          ...(await runLayeredBashTouches(
            execution.command,
            effectiveCwd,
            sessionId,
            recovered.executions.length === 1 ? invocationToolId : undefined,
            input.tool_response,
            executors,
            memo,
            ctx.logger,
            createDefaultPlannedTouchStore(layout),
            {
              successful:
                recovered.executions.length === 1 &&
                recovered.executions[0]?.background === false &&
                bashResponseExitCode(input.tool_response) === 0,
              executor: inspectionExecutor,
              onWrite: () => firstWriteGuidance(sessionId, memo, true)
            }
          ))
        );
      }
      if (blocks.length === 0) return undefined;
      const shellCombined = blocks.join('');
      return postToolUseOutput({ additionalContext: shellCombined, systemMessage: shellCombined });
    }

    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return undefined;
    const store = createDefaultPlannedTouchStore(layout);
    const planned =
      input.tool_use_id === undefined ? { status: 'missing' as const } : store.take(sessionId, input.tool_use_id);
    if (planned.status === 'consumed') return undefined;
    const record = planned.status === 'record' ? planned.record : null;
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === 'failure') return undefined;
    if (classification === 'unknown') {
      ctx.logger.warn('Codex apply_patch tool_response shape unrecognized; suppressing attribution');
      return undefined;
    }
    const blocks = await runApplyPatchTouches(
      command,
      cwd,
      sessionId,
      plannedPatchCandidates(record, cwd),
      executors,
      memo,
      input.tool_use_id === undefined ? null : `${sessionId}:${input.tool_use_id}`,
      ctx.logger,
      () => firstWriteGuidance(sessionId, memo, true)
    );
    if (blocks.length === 0) return undefined;
    const combined = blocks.join('');
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}

export const STATIC_POST_MATCHER = 'apply_patch|exec_command|exec|shell|local_shell|Bash|write_stdin';

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postToolUseHook(
  { matcher: 'apply_patch|exec_command|exec|shell|local_shell|Bash|write_stdin', timeout: 40_000 },
  createHandler()
);
