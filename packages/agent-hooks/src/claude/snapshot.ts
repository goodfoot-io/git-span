/**
 * Claude PreToolUse snapshot hook — the snapshot decision + write-only pre-walk.
 *
 * Fires before a `Bash` tool call, on the same matcher as the advisor; the
 * build CLI groups hook modules by (event, matcher), so this registers
 * alongside it with no hand-editing of hooks.json. The hook's only job is the
 * decision and the write: classify the command via
 * {@link classifyCommandForSnapshot} and, when it decides a snapshot, walk
 * the tier-1/tier-2 files under the budgets and persist the pre-walk record
 * for (session_id, tool_use_id) via the snapshot store — it never returns a
 * signal, and it must stay cheap (the pre-side wall budget is the guard).
 * Phase 1: thin handler — the classifier and store are `Not Implemented`
 * stubs, so every path returns null. Fail-open is load-bearing: any error
 * yields no record and never blocks the command — the Post side then falls
 * back to today's static-parse path.
 */

import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/claude-code-hooks';
import { classifyCommandForSnapshot } from '../common/snapshot-core.js';

/** Narrow a `Bash` tool_input to its `command` string. */
function narrowCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string' && command.length > 0) return command;
  }
  return null;
}

export function createHandler() {
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
      // Phase 3: write-only pre-walk — capture the tier-1 targets and the
      // tier-2 eligible walk under the budgets, persist the record and its
      // index entry via createSnapshotStore(ctx.logger).write(...), prune
      // stale state. The SAME classifier runs at PostToolUse, so both sides
      // always agree on whether a snapshot should exist; an absent record
      // then warns on the Post side.
      return null;
    } catch (err) {
      // Fail open: never let the snapshot pre-hook block the command. A
      // missing record degrades that call to the static path — visible only
      // via the Post classifier's missing-record warning (Phase 3).
      ctx.logger.warn('git-span snapshot pre-hook failed open on an uncaught error', { err });
      return null;
    }
  };
}

export default preToolUseHook({ matcher: 'Bash', timeout: 10_000 }, createHandler());
