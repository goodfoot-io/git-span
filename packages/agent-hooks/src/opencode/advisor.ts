/**
 * OpenCode before-hook advisor — the third twin of
 * [codex/advisor.ts](../codex/advisor.ts) and claude/advisor.ts, sharing the
 * same advisor-core pipeline ({@link parseGitCommand} → {@link resolveChangeset}
 * → {@link evaluateAdvisor}) with harness `'opencode'`.
 *
 * OpenCode has no deny decision and no separate system message (plan decision
 * 1): a hold **throws** `Error(wrapGitSpanContext(reason))` from the before
 * hook, which blocks the tool call live-verified — the thrown checklist is the
 * error text the model sees verbatim. The advisor memo records the debt state
 * on the hold, so an identical bare retry resolves to allow/already-presented
 * and passes silently: one interruption, never enforcement. There is no
 * fallback branch to translate.
 *
 * Report kinds that must not be swallowed but also do not block
 * (`environmental`, `scan-failed`, and the `'report-only'` status advisories)
 * are stashed keyed `${sessionID}:${callID}`; the paired after hook appends
 * them to the tool result after execution (decision 3's stash-and-forward),
 * because OpenCode's after hook is the only post-execution injection channel.
 *
 * Filter: exact tool id `bash` only — OpenCode has no matcher strings.
 * Frame: the bash args' `workdir` resolved against the plugin init directory,
 * else the init directory itself (decision 4). Whole-body fail-open: an
 * uncaught error logs and allows, except a hold, which rethrows (the host is
 * fail-closed around handler throws — an uncaught non-hold error would block
 * the tool call, which is exactly what must never happen by accident).
 */

import { resolve as resolvePath } from 'node:path';
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
import type { MemoLogger } from '../common/span-surface.js';
import { disableUpdateCheck } from '../common/update-check-env.js';
import type { OpencodeBeforeOutput, OpencodeToolInput } from './types.js';

/** Sentinel so the fail-open catch can rethrow holds without a flag parameter. */
export class GitSpanHoldError extends Error {}

/**
 * Resolve the advisor frame for a bash call: the args' `workdir` (absolute, or
 * relative against the plugin init directory — the host resolves it against
 * the instance directory, so an absolute value passes through unchanged)
 * falling back to the init directory. A template-literal workdir (containing
 * `$` or a backtick) is unresolvable static intent and falls back too.
 */
export function resolveFrame(workdir: string | undefined, directory: string): string {
  if (workdir === undefined || workdir.length === 0 || /[$`]/.test(workdir)) return directory;
  return resolvePath(directory, workdir);
}

export interface AdvisorHandlerDeps {
  /** Plugin init directory — the frame every relative workdir resolves against. */
  directory: string;
  git?: GitExecutor;
  executors?: AdvisorExecutors;
  memoFactory?: (cwd: string) => AdvisorMemoState;
  logger?: MemoLogger;
}

export function createAdvisorHandler(
  deps: AdvisorHandlerDeps & {
    /** Stash sink for report-kind blocks; structured as a minimal slice. */
    stashReport(sessionId: string, callId: string, block: string): void;
  }
) {
  const git = deps.git ?? createDefaultGitExecutor(5_000);
  const executors = deps.executors ?? createDefaultAdvisorExecutors(5_000);
  const memoFactory = deps.memoFactory ?? createDiskAdvisorMemoState;
  const logger = deps.logger ?? { warn: () => undefined };
  return async (input: OpencodeToolInput, output: OpencodeBeforeOutput): Promise<void> => {
    try {
      if (input?.tool !== 'bash') return;
      const args = (output?.args ?? {}) as Record<string, unknown>;
      const command = typeof args.command === 'string' && args.command.length > 0 ? args.command : null;
      if (command === null) return;
      const sessionId = typeof input.sessionID === 'string' ? input.sessionID : '';
      const callId = typeof input.callID === 'string' ? input.callID : '';
      // Symmetric with the shell.env guard and the call-state stash's ingress
      // refusal: ids outside the prunable keyspace cannot carry a stashed
      // report, so no report kind is computed for them. Holds still throw —
      // blocking enforcement never depends on call state.
      const stashable = sessionId.length > 0 && callId.length > 0;
      const workdir = typeof args.workdir === 'string' ? args.workdir : undefined;
      const cwd = resolveFrame(workdir, deps.directory);

      const parsed = parseGitCommand(command);
      if (parsed.kind === 'none') return;

      let held: GitSpanHoldError | null = null;
      try {
        const all = parsed.kind === 'commit' ? commitStagesAll(command) : false;
        const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);
        const mode = parsed.kind === 'status' ? 'report-only' : 'may-hold';
        // `'opencode'` renders the closing instruction with OpenCode's Task-tool
        // dispatch vocabulary and bare skill names; `'generic'` would keep the
        // pre-harness inline prose.
        const result = await evaluateAdvisor(
          changeset.paths,
          cwd,
          executors,
          memoFactory(cwd),
          mode,
          { git, range: changeset.range, logger },
          'opencode'
        );
        if (result.decision === 'hold') {
          // Decision 1: hold = throw. The memo recorded the debt state inside
          // evaluateAdvisor, so an identical bare retry passes silently.
          held = new GitSpanHoldError(wrapGitSpanContext(result.reason));
        } else if (
          result.kind === 'environmental' ||
          result.kind === 'scan-failed' ||
          result.kind === 'semantic-drift-report' ||
          result.kind === 'uncovered-writes-report'
        ) {
          // Allow-with-report kinds: stash the rendered checklist so the paired
          // after hook appends it once the command has run. Environmental and
          // scan-failed additionally log — the agent-facing output of those is
          // the appended block, but the warn leaves a hook-log trace too.
          if (result.kind === 'environmental' || result.kind === 'scan-failed') {
            logger.warn('git-span advisor allowed with an unresolved condition', { reason: result.reason });
          }
          if (stashable) deps.stashReport(sessionId, callId, wrapGitSpanContext(result.reason));
        }
      } catch (err) {
        if (err instanceof GitSpanHoldError) throw err;
        // Internal advisor errors already fail open inside evaluateAdvisor;
        // this net catches resolver-level throws so the command proceeds.
        logger.warn('git-span advisor failed open on an uncaught error', { err });
      }
      if (held !== null) throw held;
    } catch (err) {
      if (err instanceof GitSpanHoldError) throw err;
      logger.warn('git-span advisor failed open on an uncaught error', { err });
    }
  };
}

// Automated git-span caller: suppress the update check before any executor
// runs so every `git span` child inherits the env var.
disableUpdateCheck();
