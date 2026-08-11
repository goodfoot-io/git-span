/**
 * mini-swe-agent PreToolUse advisor hook — the Claude adapter's handler with
 * the inline instruction.
 *
 * mini-swe-agent's agent loop is a single bash tool: every model action is a
 * command executed in the environment, and the model cannot dispatch
 * subagents. The Claude adapter's default closing — "Dispatch a forked
 * subagent…" — would be dead guidance there, so this adapter registers the
 * same shared advisor-core pipeline ({@link parseGitCommand} →
 * {@link resolveChangeset} → {@link evaluateAdvisor}) with the `'generic'`
 * harness: the pre-harness inline instruction, which the agent can carry out
 * with the very `git span` commands it is already allowed to run. Everything
 * else — the hold-once deny, the consider-once memo, fail-open — is identical
 * to Claude's adapter.
 */

import { preToolUseHook } from '@goodfoot/claude-code-hooks';
import { createHandler as createClaudeHandler } from '../claude/advisor.js';
import type { AdvisorExecutors, AdvisorMemoState, GitExecutor } from '../common/advisor-core.js';

/**
 * The Claude adapter's handler with the harness fixed to `'generic'`: the
 * inline closing instruction, because this host's agent cannot dispatch the
 * forked subagent the `'claude'` default would task. The parameter list
 * mirrors the Claude adapter's so tests can inject fakes identically.
 */
export const createHandler = (
  git?: GitExecutor,
  executors?: AdvisorExecutors,
  memoFactory?: (cwd: string) => AdvisorMemoState
) => createClaudeHandler(git, executors, memoFactory, 'generic');

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
