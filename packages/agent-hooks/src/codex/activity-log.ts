/**
 * Codex PreToolUse activity-log hook — the interleaved-edit intent log.
 *
 * Fires before `apply_patch` tool calls — Codex's edit tool, and the one
 * write shape the snapshot path must distinguish from a Bash call's own
 * writes. Same role as the Claude activity-log hook: create the (session,
 * tool_use_id) entry with every target path's preHash before the patch
 * applies; the PostToolUse hook stamps `postHash`/`finishedAt` at the end of
 * the same patch's touch. Phase 1: thin handler — resolve the repo and call
 * the `Not Implemented` append stub; fail-open throughout (a missing entry
 * only degrades an entangled-path verdict to ambiguous, never to a wrong
 * attribution).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/codex-hooks';
import { resolveRepoRoot } from '../common/agent-hooks-common.js';
import { appendActivityEntry } from '../common/snapshot-store.js';

export default preToolUseHook(
  { matcher: 'apply_patch', timeout: 10_000 },
  async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return undefined;
      const repoRoot = resolveRepoRoot(input.cwd ?? '');
      if (!repoRoot) return undefined;
      // Phase 3: read and hash every target path (preHash), then create the
      // entry with startedAt and all preHashes together — intent logged
      // before the patch applies.
      appendActivityEntry(repoRoot, {
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        kind: input.tool_name,
        startedAt: Date.now(),
        finishedAt: null,
        paths: []
      });
      return undefined;
    } catch (err) {
      ctx.logger.warn('git-span activity-log pre-hook failed open on an uncaught error', { err });
      return undefined;
    }
  }
);
