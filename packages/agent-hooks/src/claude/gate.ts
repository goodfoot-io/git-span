/**
 * Claude PreToolUse gate hook — hold `git commit`/`git push` on real span debt.
 *
 * Fires before a `Bash` tool call. The Claude-specific job is translating the
 * `Bash` `tool_input.command` string plus `cwd`/`session_id` into the shared
 * gate-core pipeline: {@link parseGitCommand} recognizes a gated `git commit`/
 * `git push` (word-boundary, conservative — anything else allows), then
 * {@link resolveChangeset} resolves the concrete changeset via a real
 * subprocess-backed {@link GitExecutor} and {@link evaluateGate} classifies its
 * span debt. A `deny` result becomes `permissionDecision: 'deny'` with the
 * checklist as `permissionDecisionReason` (the model sees the reason); anything
 * else allows silently.
 *
 * Fail-open is load-bearing at every layer: gate-core already resolves any
 * internal error to allow, and this adapter wraps the whole path in a try/catch
 * that allows-and-logs on any uncaught exception — the gate must never brick a
 * commit on its own failure. The timeout is milliseconds here (the Claude CLI
 * emits ms into `hooks.json`).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/claude-code-hooks';
import {
  commitStagesAll,
  createDefaultGateExecutors,
  createDefaultGitExecutor,
  createDiskGateMemoState,
  evaluateGate,
  type GateExecutors,
  type GateMemoState,
  type GitExecutor,
  parseGitCommand,
  resolveChangeset
} from '../common/gate-core.js';

/** Narrow a `Bash` tool_input to its `command` string. */
function narrowCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string' && command.length > 0) return command;
  }
  return null;
}

export function createHandler(
  git: GitExecutor = createDefaultGitExecutor(),
  executors: GateExecutors = createDefaultGateExecutors(),
  memoFactory: (cwd: string) => GateMemoState = createDiskGateMemoState
) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      const command = narrowCommand(input.tool_input);
      if (command === null) return preToolUseOutput({});

      const parsed = parseGitCommand(command);
      if (parsed.kind === 'none') return preToolUseOutput({});

      const cwd = input.cwd ?? '';
      const all = parsed.kind === 'commit' ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);

      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd));
      if (result.decision === 'deny') {
        return preToolUseOutput({
          hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: result.reason },
          systemMessage: result.reason
        });
      }
      // Environmental staleness and a failed staleness scan both allow
      // (fail-open), but must not be swallowed: log and surface the reason so
      // the unresolvable anchor / unverified changeset is visible.
      if (result.kind === 'environmental' || result.kind === 'scan-failed') {
        ctx.logger.warn('git-span gate allowed with an unresolved condition', { reason: result.reason });
        return preToolUseOutput({ systemMessage: result.reason });
      }
      return preToolUseOutput({});
    } catch (err) {
      // Adapter-level fail-open: never let a gate error block the command.
      ctx.logger.warn('git-span gate failed open on an uncaught error', { err });
      return preToolUseOutput({});
    }
  };
}

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
