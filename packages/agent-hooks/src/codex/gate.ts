/**
 * Codex PreToolUse gate hook — hold `git commit`/`git push` on real span debt,
 * and advise (never hold) on a plain `git status`.
 *
 * The Codex twin of [claude/gate.ts](./packages/agent-hooks/src/claude/gate.ts):
 * same shared gate-core pipeline ({@link parseGitCommand} → {@link resolveChangeset}
 * → {@link evaluateGate}), translated into Codex's PreToolUse output shape. Codex
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
 * path per that README ({@link CODEX_GATE_HARD_DENY} = `true`), but keeps the
 * CARD.md-documented fallback — a loud `additionalContext` warning that allows
 * the command, with the CI recipe as Codex's enforcement backstop — as a clearly
 * separable branch behind that one constant. If a live session shows deny does
 * not fire, flip {@link CODEX_GATE_HARD_DENY} to `false`; nothing else changes.
 *
 * The shell tool's exact `tool_name` is likewise unconfirmed (the README's
 * example uses `"Bash"`; Codex CLI transcripts in the spike labeled the call
 * `exec`). The registration matcher is broadened to the plausible names so the
 * hook actually fires, and every fire logs the observed `tool_name` so the first
 * live run reveals the literal string to narrow the matcher to.
 *
 * Fail-open at every layer: gate-core resolves internal errors to allow, and this
 * adapter wraps the whole path in a try/catch that allows-and-logs — the gate
 * must never brick a commit. The timeout is milliseconds here (the Codex CLI
 * divides to seconds at emit).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/codex-hooks';
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

/**
 * Whether Codex's `permissionDecision: 'deny'` is trusted to block the shell tool
 * live. Ships `true` (hard deny) per the `@goodfoot/codex-hooks` README's worked
 * example. Flip to `false` to activate the CARD.md-documented fallback if a live
 * session shows deny does not fire — see notes/codex-deny-spike.md and this
 * file's header. This is the single switch that separates the two code paths.
 */
const CODEX_GATE_HARD_DENY = true;

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
  executors: GateExecutors = createDefaultGateExecutors(),
  memoFactory: (cwd: string) => GateMemoState = createDiskGateMemoState,
  // The hard-deny switch is a parameter (defaulting to the shipped constant) so
  // the documented fallback branch is directly exercisable in tests without
  // mutating a module-level const. Production wiring never passes this — the
  // default export below constructs the handler with the constant's value.
  hardDeny: boolean = CODEX_GATE_HARD_DENY
) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      // Log the observed shell tool_name so the first live run reveals the literal
      // string to narrow the matcher to (the spike never confirmed it empirically).
      ctx.logger.info('git-span gate observed shell tool', { tool_name: input.tool_name });

      const command = extractShellCommand(input.tool_input);
      if (command === null) return preToolUseOutput({});

      const parsed = parseGitCommand(command);
      if (parsed.kind === 'none') return preToolUseOutput({});

      const cwd = input.cwd ?? '';
      const all = parsed.kind === 'commit' ? commitStagesAll(command) : false;
      const changeset = await resolveChangeset(parsed.kind, all, cwd, git, parsed.paths);

      const mode = parsed.kind === 'status' ? 'inform' : 'enforce';
      const result = await evaluateGate(changeset, cwd, executors, memoFactory(cwd), mode);
      if (result.decision !== 'deny') {
        // Environmental staleness and a failed staleness scan both allow
        // (fail-open) but must not be swallowed: log and surface the reason as
        // additional context.
        if (result.kind === 'environmental' || result.kind === 'scan-failed') {
          ctx.logger.warn('git-span gate allowed with an unresolved condition', { reason: result.reason });
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        // `status`-only advisory kinds: span debt exists, but a status check
        // never holds the command — surface it as information, not a warning.
        if (result.kind === 'semantic-staleness-info' || result.kind === 'uncovered-writes-info') {
          return preToolUseOutput({ additionalContext: result.reason, systemMessage: result.reason });
        }
        return preToolUseOutput({});
      }

      if (hardDeny) {
        // Primary path (per the README): actually block the command.
        return preToolUseOutput({
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
          systemMessage: result.reason
        });
      }
      // Fallback path (CARD.md contingency): cannot block, so surface the same
      // checklist as a loud warning and allow — the CI recipe enforces for Codex.
      const warning = `Could not block this command — the issue below still needs resolving:\n${result.reason}`;
      return preToolUseOutput({ additionalContext: warning, systemMessage: warning });
    } catch (err) {
      ctx.logger.warn('git-span gate failed open on an uncaught error', { err });
      return preToolUseOutput({});
    }
  };
}

export default preToolUseHook({ matcher: 'Bash|shell|exec|local_shell', timeout: 10_000 }, createHandler());
