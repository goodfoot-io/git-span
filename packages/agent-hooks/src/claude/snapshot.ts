/**
 * Claude PreToolUse snapshot hook — the snapshot decision + write-tree capture.
 *
 * Fires before a `Bash` tool call, on the same matcher as the advisor; the
 * build CLI groups hook modules by (event, matcher), so this registers
 * alongside it with no hand-editing of hooks.json. The hook's only job is the
 * decision and the write: classify the command via
 * {@link classifyCommandForSnapshot} and, when it decides a snapshot, take
 * the private write-tree capture and persist the tree-SHA record for
 * (session_id, tool_use_id) via {@link capturePreSnapshot} — it never returns
 * a signal, and it must stay cheap (the pre-side wall budget is the guard;
 * exhaustion degrades the capture to a stat-only sweep inside the core).
 *
 * Fail-open is load-bearing: any error yields no record and never blocks the
 * command — the Post side then falls back to today's static-parse path.
 */

import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/claude-code-hooks';
import { DEFAULT_SESSION_LAYOUT, resolveRepoRoot, type SessionLayout } from '../common/agent-hooks-common.js';
import { classifyCommandForSnapshot } from '../common/snapshot-core.js';
import { capturePreSnapshot, resolveSnapshotBudgets } from '../common/snapshot-harness.js';
import { createSnapshotStore } from '../common/snapshot-store.js';

/** Narrow a `Bash` tool_input to its `command` string. */
export function narrowCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string' && command.length > 0) return command;
  }
  return null;
}

export function createHandler(layout: SessionLayout = DEFAULT_SESSION_LAYOUT) {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      // A PreToolUse event without session_id or tool_use_id can never be
      // correlated — fail open, no record (per the plan).
      if (!input.session_id || !input.tool_use_id) return null;
      const command = narrowCommand(input.tool_input);
      if (command === null) return null;
      const plan = classifyCommandForSnapshot(command, input.cwd ?? '');
      if (plan.decision.kind !== 'snapshot') {
        // No snapshot: the command has no write-capable command, or every
        // write is statically covered and provably expansion-free — the Post
        // side's static-parse path stays authoritative.
        return null;
      }
      const repoRoot = resolveRepoRoot(input.cwd ?? '');
      if (repoRoot === null) return null; // no repo, no record — fail open
      const budgets = resolveSnapshotBudgets(repoRoot);
      const result = capturePreSnapshot({
        store: createSnapshotStore(ctx.logger, budgets, layout),
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        repoRoot,
        budgets,
        logger: ctx.logger
      });
      if (result === null) return null; // total capture failure — fail open
      ctx.logger.info('git-span snapshot pre-capture', {
        toolUseId: input.tool_use_id,
        decision: plan.decision.reason,
        treeSha: result.treeSha,
        gaps: result.gaps,
        refused: !result.wrote
      });
      return null;
    } catch (err) {
      // Fail open: never let the snapshot pre-hook block the command. A
      // missing record degrades that call to the static path — visible only
      // via the Post classifier's missing-record warning.
      ctx.logger.warn('git-span snapshot pre-hook failed open on an uncaught error', { err });
      return null;
    }
  };
}

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
