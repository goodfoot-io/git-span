/**
 * Codex PreToolUse advisor hook — hold `git commit`/`git push` once on real
 * span debt so the report is read, and report without holding on a plain
 * `git status`. The hold never enforces: a bare retry proceeds.
 *
 * The Codex twin of [claude/advisor.ts](./packages/agent-hooks/src/claude/advisor.ts):
 * same shared advisor-core pipeline ({@link parseGitCommand} → {@link resolveChangeset}
 * → {@link evaluateAdvisor}), translated into Codex's PreToolUse output shape. Codex
 * delivers a shell command as an SDK-typed `unknown` `tool_input`; this handler
 * narrows it (string, or a `["bash","-lc","<script>"]`/argv array) into the
 * command string the core parses.
 *
 * ── Unconfirmed deny (see notes/codex-deny-spike.md) ──────────────────────────
 * Whether Codex's `permissionDecision: 'deny'` actually *blocks* the shell tool
 * live was never confirmed in this repo: the Phase 0 spike could not get a
 * from-scratch plugin to load, so the deny path was never exercised end-to-end.
 * The only positive evidence is documentary — the `@goodfoot/codex-hooks` README
 * (the exact version this repo depends on) ships a worked `permissionDecision:
 * 'deny'` example matched on `"Bash"`. This adapter therefore ships the hard-deny
 * path per that README ({@link CODEX_ADVISOR_HARD_DENY} = `true`), but keeps the
 * CARD.md-documented fallback — a loud `additionalContext` warning that allows
 * the command, with the CI recipe as Codex's enforcement backstop — as a clearly
 * separable branch behind that one constant. If a live session shows deny does
 * not fire, flip {@link CODEX_ADVISOR_HARD_DENY} to `false`; nothing else changes.
 *
 * The shell tool's exact `tool_name` is likewise unconfirmed (the README's
 * example uses `"Bash"`; Codex CLI transcripts in the spike labeled the call
 * `exec`). The registration matcher is broadened to the plausible names so the
 * hook actually fires, and every fire logs the observed `tool_name` so the first
 * live run reveals the literal string to narrow the matcher to.
 *
 * Fail-open at every layer: advisor-core resolves internal errors to allow, and this
 * adapter wraps the whole path in a try/catch that allows-and-logs — the advisor
 * must never brick a commit. The timeout is milliseconds here (the Codex CLI
 * divides to seconds at emit).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/codex-hooks';
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

/**
 * Whether Codex's `permissionDecision: 'deny'` is trusted to block the shell tool
 * live. Ships `true` (hard deny) per the `@goodfoot/codex-hooks` README's worked
 * example. Flip to `false` to activate the CARD.md-documented fallback if a live
 * session shows deny does not fire — see notes/codex-deny-spike.md and this
 * file's header. This is the single switch that separates the two code paths.
 */
const CODEX_ADVISOR_HARD_DENY = true;

/**
 * Narrow Codex's `unknown` shell `tool_input` into the command string the core
 * parses. Handles a bare `command` string, a shell-wrapper argv
 * (`["bash","-lc","<script>"]` → the script after `-c`/`-lc`), and a direct argv
 * (`["git","commit",…]` → space-joined). Returns `null` when no command text is
 * recoverable.
 */
export function extractShellCommand(toolInput: unknown): string | null {
  if (toolInput === null || typeof toolInput !== 'object' || !('command' in toolInput)) return null;
  const command = (toolInput as { command: unknown }).command;
  if (typeof command === 'string') return command.length > 0 ? command : null;
  if (Array.isArray(command)) {
    const parts = command.filter((p): p is string => typeof p === 'string');
    if (parts.length === 0) return null;
    const flagIdx = parts.findIndex((p) => p === '-c' || p === '-lc' || p === '-ic');
    if (flagIdx >= 0 && parts[flagIdx + 1] !== undefined) return parts[flagIdx + 1];
    return parts.join(' ');
  }
  return null;
}

export function createHandler(
  git: GitExecutor = createDefaultGitExecutor(),
  executors: AdvisorExecutors = createDefaultAdvisorExecutors(),
  memoFactory: (cwd: string) => AdvisorMemoState = createDiskAdvisorMemoState,
  // The hard-deny switch is a parameter (defaulting to the shipped constant) so
  // the documented fallback branch is directly exercisable in tests without
  // mutating a module-level const. Production wiring never passes this — the
  // default export below constructs the handler with the constant's value.
  hardDeny: boolean = CODEX_ADVISOR_HARD_DENY
) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      // Log the observed shell tool_name so the first live run reveals the literal
      // string to narrow the matcher to (the spike never confirmed it empirically).
      ctx.logger.info('git-span advisor observed shell tool', { tool_name: input.tool_name });

      const command = extractShellCommand(input.tool_input);
      if (command === null) return undefined;

      const parsed = parseGitCommand(command);
      if (parsed.kind === 'none') return undefined;

      const cwd = input.cwd ?? '';
      const all = parsed.kind === 'commit' ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);

      const mode = parsed.kind === 'status' ? 'report-only' : 'may-hold';
      // `'codex'` makes the closing instruction name Codex's forked-subagent
      // vocabulary (`spawn_agent` with `fork_turns: "all"`); `'generic'` would
      // keep the pre-harness inline-instruction prose.
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
        'codex'
      );
      if (result.decision !== 'hold') {
        // Environmental drift and a failed drift scan both allow
        // (fail-open) but must not be swallowed: log and surface the reason as
        // additional context.
        if (result.kind === 'environmental' || result.kind === 'scan-failed') {
          ctx.logger.warn('git-span advisor allowed with an unresolved condition', { reason: result.reason });
          return preToolUseOutput({
            additionalContext: wrapGitSpanContext(result.reason),
            systemMessage: result.reason
          });
        }
        // `status`-only advisory kinds: span debt exists, but a status check
        // never holds the command — surface it as information, not a warning.
        if (result.kind === 'semantic-drift-report' || result.kind === 'uncovered-writes-report') {
          return preToolUseOutput({
            additionalContext: wrapGitSpanContext(result.reason),
            systemMessage: result.reason
          });
        }
        return undefined;
      }

      if (hardDeny) {
        // Primary path (per the README): translate our `hold` into Codex's own
        // vocabulary and stop this one invocation. The memo has recorded the
        // debt state, so an identical retry allows — this is a single
        // interruption, not enforcement.
        return preToolUseOutput({
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
          systemMessage: result.reason
        });
      }
      // Fallback path (CARD.md contingency): cannot hold, so surface the same
      // checklist as a loud warning and allow — the CI recipe enforces for Codex.
      const warning = `Could not block this command — the issue below still needs resolving:\n${result.reason}`;
      return preToolUseOutput({ additionalContext: wrapGitSpanContext(warning), systemMessage: warning });
    } catch (err) {
      ctx.logger.warn('git-span advisor failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

export default preToolUseHook({ matcher: 'Bash|shell|exec|local_shell', timeout: 10_000 }, createHandler());
