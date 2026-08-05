/**
 * Claude PreToolUse activity-log hook — the interleaved-edit intent log.
 *
 * Fires before `Edit`/`Write` (and defensively `apply_patch`) tool calls. The
 * activity log is the concurrency rules' second evidence source: an entry
 * created here, before the edit's write lands, records the paths the edit is
 * about to touch and their pre-hash state — so an interleaved edit inside a
 * Bash snapshot window resolves via `finishedAt ≤ capturedAt(P)` instead of
 * being mis-attributed as the Bash call's own write. The PostToolUse hook
 * stamps each entry's `postHash`/`finishedAt` at the end of that same edit's
 * own touch. Phase 1: thin handler — resolve the repo and call the `Not
 * Implemented` append stub; fail-open throughout (a missing entry only
 * degrades an entangled-path verdict to ambiguous, never to a wrong
 * attribution).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/claude-code-hooks';
import { resolveRepoRoot } from '../common/agent-hooks-common.js';
import { appendActivityEntry } from '../common/snapshot-store.js';

export default preToolUseHook(
  { matcher: 'Edit|Write|apply_patch', timeout: 10_000 },
  async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return null;
      const repoRoot = resolveRepoRoot(input.cwd ?? '');
      if (!repoRoot) return null;
      // Phase 3: read and hash every target path (preHash), then create the
      // entry with startedAt and all preHashes together — intent logged
      // before the edit's write lands.
      appendActivityEntry(repoRoot, {
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        kind: input.tool_name,
        startedAt: Date.now(),
        finishedAt: null,
        paths: []
      });
      return null;
    } catch (err) {
      ctx.logger.warn('git-span activity-log pre-hook failed open on an uncaught error', { err });
      return null;
    }
  }
);
