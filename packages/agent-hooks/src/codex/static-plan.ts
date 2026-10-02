/** Codex PreToolUse planner for every supported shell envelope. */

import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/agent-hooks/codex';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import { type CommitRuntimeOptions, dispatchCommitShim, enrollCommitInvocation } from '../common/commit-runtime.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowCodeModeExec, narrowExecCommand } from './post-tool-use.js';
import { extractShellCommand } from './shell-command.js';

/** Extract a shell command and the workdir carried by classic/code-mode envelopes. */
export function narrowShellPlanInput(toolInput: unknown): { command: string; workdir: string | null } | null {
  const direct = extractShellCommand(toolInput);
  if (direct !== null) return { command: direct, workdir: null };
  const classic = narrowExecCommand(toolInput);
  if (classic !== null) return { command: classic.cmd, workdir: classic.workdir };
  const codeMode = narrowCodeModeExec(toolInput);
  return codeMode.cmd === null ? null : { command: codeMode.cmd, workdir: codeMode.workdir };
}

export function createHandler(
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT,
  runtimeOptions: CommitRuntimeOptions = {},
  bundlePath: string = fileURLToPath(import.meta.url)
) {
  const options = { stateRoot: join(dirname(layout.base), 'commit-receipts'), ...runtimeOptions };
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return undefined;
      const narrowed = narrowShellPlanInput(input.tool_input);
      if (narrowed === null) return undefined;
      const cwd = input.cwd ?? '';
      const effectiveCwd =
        narrowed.workdir !== null && !/[`$]/.test(narrowed.workdir) ? resolvePath(cwd, narrowed.workdir) : cwd;
      planBashTouches(
        narrowed.command,
        effectiveCwd,
        input.session_id,
        input.tool_use_id,
        ctx.logger,
        createDefaultPlannedTouchStore(layout)
      );
      // Only the actual host's normalized Bash envelope supports input replacement.
      if (input.tool_name !== 'Bash' || typeof (input.tool_input as Record<string, unknown>).command !== 'string')
        return undefined;
      const toolInput = input.tool_input as Record<string, unknown>;
      if (toolInput.run_in_background === true || toolInput.background === true || toolInput.delegate === true) {
        ctx.logger.warn('git-span commit attribution does not support visible background or delegated execution');
        return undefined;
      }
      const result = await enrollCommitInvocation(
        {
          host: 'codex',
          sessionId: input.session_id,
          toolUseId: input.tool_use_id,
          cwd: effectiveCwd,
          toolInput,
          ...(input.transcript_path ? { transcriptLocator: input.transcript_path } : {}),
          bundlePath
        },
        options,
        ctx.logger
      );
      if (result.kind !== 'enrolled') {
        ctx.logger.warn('git-span commit attribution enrollment unavailable', { reason: result.reason });
        return undefined;
      }
      // Codex requires native pre-allow to apply trusted replacement; host approval remains independent.
      return preToolUseOutput({ permissionDecision: 'allow', updatedInput: result.updatedInput });
    } catch (err) {
      ctx.logger.warn('git-span static Bash pre-plan failed closed for attribution', { err });
      return undefined;
    }
  };
}

export const STATIC_PLAN_PRE_MATCHER = 'Bash|shell|exec|local_shell|exec_command';

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
if (process.argv[2] === '--git-span-commit-shim') {
  await dispatchCommitShim();
  process.exit(0);
}

disableUpdateCheck();

export default preToolUseHook(
  { matcher: 'Bash|shell|exec|local_shell|exec_command', timeout: 10_000 },
  createHandler()
);
