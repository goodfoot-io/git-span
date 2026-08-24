/** Codex PostToolUse adapter for shell and apply_patch static attribution. */

import { resolve as resolvePath } from 'node:path';
import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
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
import { createDiskMemoStore, type MemoFactory } from '../common/span-surface.js';
import type { PlannedTouchRecord } from '../common/static-attribution.js';
import { createDefaultTouchExecutors, type TouchExecutors } from '../common/touch-core.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { extractShellCommand } from './advisor.js';

const APPLY_PATCH_SUCCESS_PREFIX = 'Success. Updated the following files:';

/** Narrow the SDK's unknown apply_patch input. */
export function narrowApplyPatchCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string') return command;
  }
  return null;
}

/** Narrow the classic exec_command JSON-string arguments envelope. */
export function narrowExecCommand(toolInput: unknown): { cmd: string; workdir: string | null } | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'arguments' in toolInput) {
    const args = (toolInput as { arguments: unknown }).arguments;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.cmd === 'string') {
          return { cmd: parsed.cmd, workdir: typeof parsed.workdir === 'string' ? parsed.workdir : null };
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface CodeModeExecNarrow {
  matched: boolean;
  cmd: string | null;
  workdir: string | null;
}

function quoteObjectKeys(literal: string): string {
  let out = '';
  let index = 0;
  while (index < literal.length) {
    const character = literal[index];
    if (character === '"' || character === "'") {
      const quote = character;
      const start = index;
      index += 1;
      while (index < literal.length) {
        if (literal[index] === '\\' && index + 1 < literal.length) index += 2;
        else if (literal[index] === quote) {
          index += 1;
          break;
        } else index += 1;
      }
      out += literal.slice(start, index);
      continue;
    }
    const key = literal.slice(index).match(/^(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (key !== null) {
      out += `${key[1]}"${key[2]}":`;
      index += key[0].length;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

/** Narrow a literal tools.exec_command call from the Codex code-mode envelope. */
export function narrowCodeModeExec(toolInput: unknown): CodeModeExecNarrow {
  if (toolInput !== null && typeof toolInput === 'object' && 'input' in toolInput) {
    const input = (toolInput as { input: unknown }).input;
    if (typeof input === 'string') {
      const match = input.match(/tools\.exec_command\(\s*(\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*\)/);
      if (match !== null) {
        try {
          const parsed = JSON.parse(quoteObjectKeys(match[1]));
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.cmd === 'string') {
            return {
              matched: true,
              cmd: parsed.cmd,
              workdir: typeof parsed.workdir === 'string' ? parsed.workdir : null
            };
          }
        } catch {
          return { matched: true, cmd: null, workdir: null };
        }
        return { matched: true, cmd: null, workdir: null };
      }
    }
  }
  return { matched: false, cmd: null, workdir: null };
}

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
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const cwd = input.cwd ?? '';
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger, layout);
    if (['Bash', 'shell', 'local_shell', 'exec_command', 'exec'].includes(input.tool_name)) {
      let command = extractShellCommand(input.tool_input);
      let workdir: string | null = null;
      if (command === null) {
        const classic = narrowExecCommand(input.tool_input);
        command = classic?.cmd ?? null;
        workdir = classic?.workdir ?? null;
      }
      if (command === null && input.tool_name === 'exec') {
        const codeMode = narrowCodeModeExec(input.tool_input);
        if (codeMode.matched && codeMode.cmd === null) {
          ctx.logger.warn('Codex code-mode exec envelope matched but its command is not statically recoverable');
        }
        command = codeMode.cmd;
        workdir = codeMode.workdir;
      }
      if (command === null || command.length === 0) return undefined;
      const effectiveCwd = resolveFrame(workdir ?? undefined, cwd);
      const blocks = await runLayeredBashTouches(
        command,
        effectiveCwd,
        sessionId,
        input.tool_use_id,
        input.tool_response,
        executors,
        memo,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
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
      ctx.logger
    );
    if (blocks.length === 0) return undefined;
    const combined = blocks.join('');
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}

export const STATIC_POST_MATCHER = 'apply_patch|exec_command|exec|shell|local_shell|Bash';
export const SNAPSHOT_POST_MATCHER = STATIC_POST_MATCHER;

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default postToolUseHook(
  { matcher: 'apply_patch|exec_command|exec|shell|local_shell|Bash', timeout: 10_000 },
  createHandler()
);
