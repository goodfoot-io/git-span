/**
 * Claude PreToolUse advisor hook — hold `git commit`/`git push` once on real
 * span debt so the report is read, and report without holding on a plain
 * `git status`. The hold never enforces: a bare retry proceeds.
 *
 * Fires before a `Bash` tool call. The Claude-specific job is translating the
 * `Bash` `tool_input.command` string plus `cwd`/`session_id` into the shared
 * advisor-core pipeline: {@link parseGitCommand} recognizes an inspected `git commit`/
 * `git push`/`git status` (word-boundary, conservative — anything else
 * allows), then {@link resolveChangeset} resolves the concrete changeset via a
 * real subprocess-backed {@link GitExecutor} and {@link evaluateAdvisor}
 * classifies its span debt — in `'may-hold'` mode for `commit`/`push`, in
 * `'report-only'` mode for `status`, which never holds. A `hold` result (only
 * reachable in `'may-hold'` mode) is translated here into Claude's own
 * vocabulary — `permissionDecision: 'deny'` with the checklist as
 * `permissionDecisionReason` (the model sees the reason). That `deny` is the
 * harness's word for "this one invocation stops", not enforcement: the memo
 * has recorded the debt state, so an identical retry allows. A `-report`
 * result surfaces the same checklist as `systemMessage` advisory context and
 * still allows; anything else allows silently.
 *
 * Fail-open is load-bearing at every layer: advisor-core already resolves any
 * internal error to allow, and this adapter wraps the whole path in a try/catch
 * that allows-and-logs on any uncaught exception — the advisor must never brick a
 * commit on its own failure. The timeout is milliseconds here (the Claude CLI
 * emits ms into `hooks.json`).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/claude-code-hooks';
import {
  type AdvisorExecutors,
  type AdvisorMemoState,
  commitStagesAll,
  createDefaultAdvisorExecutors,
  createDefaultGitExecutor,
  createDiskAdvisorMemoState,
  evaluateAdvisor,
  type GitExecutor,
  parseGitCommand,
  resolveChangeset
} from '../common/advisor-core.js';

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
  executors: AdvisorExecutors = createDefaultAdvisorExecutors(),
  memoFactory: (cwd: string) => AdvisorMemoState = createDiskAdvisorMemoState
) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;

      const parsed = parseGitCommand(command);
      if (parsed.kind === 'none') return null;

      const cwd = input.cwd ?? '';
      const all = parsed.kind === 'commit' ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);

      const mode = parsed.kind === 'status' ? 'report-only' : 'may-hold';
      const result = await evaluateAdvisor(changeset.paths, cwd, executors, memoFactory(cwd), mode, {
        git,
        range: changeset.range,
        // The hook logger is the only place a suppressed file leaves a trace —
        // the agent-facing output of a suppression is nothing at all.
        logger: ctx.logger
      });
      if (result.decision === 'hold') {
        // `hold` → the harness's own vocabulary. Claude has no "hold", so the
        // one-time interruption is expressed as `permissionDecision: 'deny'`.
        return preToolUseOutput({
          hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: result.reason },
          systemMessage: result.reason
        });
      }
      // Environmental staleness and a failed staleness scan both allow
      // (fail-open), but must not be swallowed: log and surface the reason so
      // the unresolvable anchor / unverified changeset is visible.
      if (result.kind === 'environmental' || result.kind === 'scan-failed') {
        ctx.logger.warn('git-span advisor allowed with an unresolved condition', { reason: result.reason });
        return preToolUseOutput({ systemMessage: result.reason });
      }
      // `status`-only advisory kinds: span debt exists, but a status check
      // never holds the command — surface it as information, not a warning.
      if (result.kind === 'semantic-staleness-report' || result.kind === 'uncovered-writes-report') {
        return preToolUseOutput({ systemMessage: result.reason });
      }
      return null;
    } catch (err) {
      // Adapter-level fail-open: never let an advisor error block the command.
      ctx.logger.warn('git-span advisor failed open on an uncaught error', { err });
      return null;
    }
  };
}

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
