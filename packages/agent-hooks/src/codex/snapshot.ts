/**
 * Codex PreToolUse snapshot hook — the snapshot decision + write-only pre-walk.
 *
 * Fires before `Bash`/`shell`/`exec`/`local_shell` tool calls, on the same
 * matcher as the advisor. Mirrors the Claude snapshot hook: classify the
 * command via {@link classifyCommandForSnapshot} and, on a snapshot decision,
 * walk the tier-1/tier-2 files under the budgets and persist the pre-walk
 * record for (session_id, tool_use_id) via the snapshot store. Codex adds
 * `agent_id` to the record when present, so SubagentStop can remove only the
 * subagent's records. Phase 1: thin handler — the classifier and store are
 * `Not Implemented` stubs, so every path returns undefined. Fail-open is
 * load-bearing: any error yields no record and never blocks the command —
 * the Post side then falls back to today's static-parse path.
 */

import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/codex-hooks';
import { classifyCommandForSnapshot } from '../common/snapshot-core.js';
import { extractShellCommand } from './advisor.js';

export function createHandler() {
  return async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      // A PreToolUse event without session_id or tool_use_id can never be
      // correlated — fail open, no record (per the plan).
      if (!input.session_id || !input.tool_use_id) return undefined;
      const command = extractShellCommand(input.tool_input);
      if (command === null) return undefined;
      const plan = classifyCommandForSnapshot(command, input.cwd ?? '');
      if (plan.decision.kind !== 'snapshot') {
        // No snapshot: the command has no write-capable command, or every
        // write is statically covered and provably expansion-free — the Post
        // side's static-parse path stays authoritative.
        return undefined;
      }
      // Phase 3: write-only pre-walk — capture the tier-1 targets and the
      // tier-2 eligible walk under the budgets, persist the record (with
      // agent_id when present) and its index entry via
      // createSnapshotStore(ctx.logger).write(...). The SAME classifier runs
      // at PostToolUse, so both sides agree on whether a snapshot should
      // exist; an absent record then warns on the Post side.
      return undefined;
    } catch (err) {
      // Fail open: never let the snapshot pre-hook block the command. A
      // missing record degrades that call to the static path — visible only
      // via the Post classifier's missing-record warning (Phase 3).
      ctx.logger.warn('git-span snapshot pre-hook failed open on an uncaught error', { err });
      return undefined;
    }
  };
}

export default preToolUseHook({ matcher: 'Bash|shell|exec|local_shell', timeout: 10_000 }, createHandler());
