/** Codex PreToolUse planner for every supported shell envelope. */

import { resolve as resolvePath } from 'node:path';
import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/codex-hooks';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore, planBashTouches } from '../common/bash-attribution.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { extractShellCommand } from './advisor.js';
import { narrowCodeModeExec, narrowExecCommand } from './post-tool-use.js';

/** Extract a shell command and the workdir carried by classic/code-mode envelopes. */
export function narrowShellPlanInput(toolInput: unknown): { command: string; workdir: string | null } | null {
  const direct = extractShellCommand(toolInput);
  if (direct !== null) return { command: direct, workdir: null };
  const classic = narrowExecCommand(toolInput);
  if (classic !== null) return { command: classic.cmd, workdir: classic.workdir };
  const codeMode = narrowCodeModeExec(toolInput);
  return codeMode.cmd === null ? null : { command: codeMode.cmd, workdir: codeMode.workdir };
}

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
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

export default preToolUseHook(
  { matcher: 'Bash|shell|exec|local_shell|exec_command', timeout: 10_000 },
  createHandler()
);
