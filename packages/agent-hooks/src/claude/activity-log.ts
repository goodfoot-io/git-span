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
 * own touch.
 *
 * One entry per (session, tool_use_id); a single `apply_patch` edits several
 * files, hence the per-path stamp array. A failed pre-hook read leaves that
 * path's `preHash` null — the never-flag rule then cannot resolve the
 * boundary as clean, which is the fail-safe direction. Fail-open throughout:
 * a missing entry only degrades an entangled-path verdict to ambiguous, never
 * to a wrong attribution.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type HookContext, type PreToolUseInput, preToolUseHook } from '@goodfoot/claude-code-hooks';
import { parseApplyPatch } from '../codex/apply-patch.js';
import { abspathAgainst, derivePath, resolveRepoRoot } from '../common/agent-hooks-common.js';
import { type ActivityPathStamp, appendActivityEntry } from '../common/snapshot-store.js';
import { resolveTouchScope } from '../common/span-surface.js';

/** A range recovery that always declines — apply_patch anchors are path-only here. */
const noRangeRecovery = (): null => null;

/** sha256 hex of a file's bytes, or null when the read fails (never-flag can't resolve). */
function preHashOf(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

/** The edit paths' scopes + pre-hashes; null when nothing is scoped to the repo. */
function editStamps(toolName: string, toolInput: unknown, cwd: string): ActivityPathStamp[] | null {
  const stamps: ActivityPathStamp[] = [];
  if (toolName === 'apply_patch') {
    // Defensive matcher: apply_patch is Codex's edit tool, but the matcher
    // guards against the shape arriving here — parse its anchors like the
    // Codex adapter does, sharing the pure apply-patch parser.
    const raw = (toolInput as Record<string, unknown> | null)?.command;
    if (typeof raw !== 'string') return null;
    for (const anchor of parseApplyPatch(raw, noRangeRecovery)) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      stamps.push({ path: scope.repoRelPath, preHash: preHashOf(absPath), postHash: null });
    }
  } else {
    const absPath = derivePath(toolInput as Record<string, unknown>, cwd);
    if (absPath === null) return null;
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) return null;
    stamps.push({ path: scope.repoRelPath, preHash: preHashOf(absPath), postHash: null });
  }
  return stamps.length > 0 ? stamps : null;
}

export default preToolUseHook(
  { matcher: 'Edit|Write|apply_patch', timeout: 10_000 },
  async (input: PreToolUseInput, ctx: HookContext) => {
    try {
      if (!input.session_id || !input.tool_use_id) return null;
      const repoRoot = resolveRepoRoot(input.cwd ?? '');
      if (!repoRoot) return null;
      const stamps = editStamps(input.tool_name, input.tool_input, input.cwd ?? '');
      if (stamps === null) return null;
      // Intent logged before the edit's write lands: startedAt plus every
      // target path's preHash together, so the PostToolUse stamp keys
      // identically through the store's finish contract.
      appendActivityEntry(repoRoot, {
        sessionId: input.session_id,
        toolUseId: input.tool_use_id,
        kind: input.tool_name,
        startedAt: Date.now(),
        finishedAt: null,
        paths: stamps
      });
      return null;
    } catch (err) {
      ctx.logger.warn('git-span activity-log pre-hook failed open on an uncaught error', { err });
      return null;
    }
  }
);
