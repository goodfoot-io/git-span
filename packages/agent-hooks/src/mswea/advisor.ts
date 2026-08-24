/**
 * mini-swe-agent PreToolUse advisor hook — the Claude adapter's handler with
 * the inline instruction and the skill-ref placeholder protocol.
 *
 * mini-swe-agent's agent loop is a single bash tool: every model action is a
 * command executed in the environment, and the model cannot dispatch
 * subagents. The Claude adapter's default closing — "Dispatch a forked
 * subagent…" — would be dead guidance there, so this adapter registers the
 * same shared advisor-core pipeline ({@link parseGitCommand} →
 * {@link resolveChangeset} → {@link evaluateAdvisor}) with the `'mswea'`
 * harness: the pre-harness inline action prose, which the agent can carry out
 * with the very `git span` commands it is already allowed to run, plus the
 * closing skill guidance emitted as a machine-readable `skillRef` placeholder
 * (never a Claude Code skill name) that the Python bridge substitutes with its
 * own environment-appropriate instruction. Everything else — the hold-once
 * deny, the consider-once memo, fail-open — is identical to Claude's adapter.
 */

import { preToolUseHook } from '@goodfoot/claude-code-hooks';
import { createHandler as createClaudeHandler } from '../claude/advisor.js';
import type { AdvisorExecutors, AdvisorMemoState, GitExecutor } from '../common/advisor-core.js';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore } from '../common/bash-attribution.js';

/**
 * The Claude adapter's handler with the harness fixed to `'mswea'`: the
 * inline closing instruction (this host's agent has only the bash tool — the
 * forked-subagent tasking of `'claude'` would be dead guidance there) and the
 * skill-guidance placeholder the bridge resolves. The parameter list mirrors
 * the Claude adapter's so tests can inject fakes identically.
 */
export const createHandler = (
  git?: GitExecutor,
  executors?: AdvisorExecutors,
  memoFactory?: (cwd: string) => AdvisorMemoState,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) => {
  const delegate = createClaudeHandler(git, executors, memoFactory, 'mswea');
  return async (...args: Parameters<typeof delegate>): Promise<Awaited<ReturnType<typeof delegate>>> => {
    const [input] = args;
    const result = await delegate(...args);
    const decision = (
      result as { stdout?: { hookSpecificOutput?: { permissionDecision?: unknown } } } | null | undefined
    )?.stdout?.hookSpecificOutput?.permissionDecision;
    if (decision === 'deny' && input.session_id && input.tool_use_id) {
      try {
        createDefaultPlannedTouchStore(layout).discard(input.session_id, input.tool_use_id);
      } catch (err) {
        args[1].logger.warn('git-span advisor could not discard a denied static plan', { err });
      }
    }
    return result;
  };
};

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
