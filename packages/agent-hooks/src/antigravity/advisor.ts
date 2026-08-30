/**
 * Antigravity PreToolUse advisor hook — hold `git commit`/`git push` once on
 * real span debt so the report is read, and report without holding on a plain
 * `git status`. The hold never enforces: a bare retry proceeds.
 *
 * The fourth twin of claude/codex/opencode `advisor.ts`, sharing the same
 * advisor-core pipeline ({@link parseGitCommand} → {@link resolveChangeset} →
 * {@link evaluateAdvisor}). A hold becomes `{"decision":"deny","reason":…}` —
 * live-verified (CONTRACT.md) to reach the model as
 * `tool call denied by pre-tool hook: <reason>`, making this the strongest
 * deny channel of the four platforms. The advisor memo records the debt state
 * on the hold, so an identical retry allows: one interruption, never
 * enforcement.
 *
 * Report-only kinds (`environmental`, `scan-failed`, and the `'report-only'`
 * status advisories) have no allow-with-message channel on PreToolUse — no
 * `additionalContext`/`systemMessage` analog exists — so they are stashed on
 * disk keyed by `conversationId` and delivered by the PostInvocation handler
 * as one `ephemeralMessage` (the OpenCode stash-and-forward pattern, one
 * event later and disk-backed).
 *
 * Harness is `'generic'` (inline closing prose): Antigravity's subagent
 * dispatch vocabulary is not pinned in the contract, and the skill doctrine
 * forbids inventing platform vocabulary — the inline closing names no
 * dispatch tool and stays honest.
 *
 * Fail-open at every layer: advisor-core resolves internal errors to allow,
 * and this adapter wraps the whole path in a try/catch that allows-and-logs —
 * the advisor must never brick a commit. The timeout is milliseconds here
 * (the Antigravity manifest emitter divides to seconds at emit).
 */

import {
  type HookContext,
  type PreToolUseInput,
  preToolUseHook,
  preToolUseOutput
} from '@goodfoot/agent-hooks/antigravity';
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
  resolveChangeset,
  wrapGitSpanContext
} from '../common/advisor-core.js';
import { DEFAULT_SESSION_LAYOUT, type SessionLayout } from '../common/agent-hooks-common.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import { narrowRunCommand, resolveCallCwd } from './run-command.js';
import { appendPendingInjection } from './stash.js';

export function createHandler(
  git: GitExecutor = createDefaultGitExecutor(),
  executors: AdvisorExecutors = createDefaultAdvisorExecutors(),
  memoFactory: (cwd: string) => AdvisorMemoState = createDiskAdvisorMemoState,
  layout: SessionLayout = DEFAULT_SESSION_LAYOUT
) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    // Every non-hold path replies an explicit allow: the live host treats a
    // `{}` PreToolUse reply as a deny with an empty reason (CONTRACT.md marks
    // `decision` as required), so silence here would block the tool call.
    try {
      const call = narrowRunCommand(input.toolCall);
      if (call === null) return preToolUseOutput({ decision: 'allow' });

      const parsed = parseGitCommand(call.command);
      if (parsed.kind === 'none') return preToolUseOutput({ decision: 'allow' });

      const cwd = resolveCallCwd(call, input.workspacePaths);
      const all = parsed.kind === 'commit' ? commitStagesAll(call.command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);

      const mode = parsed.kind === 'status' ? 'report-only' : 'may-hold';
      const result = await evaluateAdvisor(
        changeset.paths,
        cwd,
        executors,
        memoFactory(cwd),
        mode,
        {
          git,
          range: changeset.range,
          // The hook logger is the only place a suppressed file leaves a trace —
          // the agent-facing output of a suppression is nothing at all.
          logger: ctx.logger
        },
        'generic',
        undefined,
        // Core defects (non-advisor-error throws) warn here instead of vanishing
        // into evaluateAdvisor's fail-open catch.
        ctx.logger
      );
      if (result.decision === 'hold') {
        // The memo has recorded the debt state, so an identical retry allows —
        // this is a single interruption, not enforcement.
        return preToolUseOutput({ decision: 'deny', reason: result.reason });
      }
      if (
        result.kind === 'environmental' ||
        result.kind === 'scan-failed' ||
        result.kind === 'semantic-drift-report' ||
        result.kind === 'uncovered-writes-report'
      ) {
        // Allow-with-report kinds: PreToolUse-allow carries no message channel,
        // so stash the rendered checklist for the PostInvocation drain.
        // Environmental and scan-failed additionally log — the agent-facing
        // output is the injected block, but the warn leaves a hook-log trace.
        if (result.kind === 'environmental' || result.kind === 'scan-failed') {
          ctx.logger.warn('git-span advisor allowed with an unresolved condition', { reason: result.reason });
        }
        appendPendingInjection(layout, input.conversationId, wrapGitSpanContext(result.reason));
      }
      return preToolUseOutput({ decision: 'allow' });
    } catch (err) {
      ctx.logger.warn('git-span advisor failed open on an uncaught error', { err });
      return preToolUseOutput({ decision: 'allow' });
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();

export default preToolUseHook({ matcher: 'run_command', timeout: 10_000 }, createHandler());
