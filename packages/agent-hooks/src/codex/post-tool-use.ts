/**
 * Codex PostToolUse hook — journal the confirmed `apply_patch` write.
 *
 * PostToolUse fires after `apply_patch` has run, so this is the accurate home
 * for journaling the actual write — the recommendation in the event-mapping
 * note, since the reconciler runs post-commit anyway. This handler's only job is
 * **journaling**: it parses the same `apply_patch` envelope (`tool_input.command`,
 * narrowed from the SDK's `unknown`) into `AnchorSpec[]` via the shared
 * [apply-patch parser](./apply-patch.ts), scopes each touched file to the CWD
 * repo (dropping cross-repo, gitignored, and span-document paths via the shared
 * guard), and appends the write anchors to the per-session touch journal that
 * the Stop core later drains into a `PreCommitRecord`.
 *
 * Two invariants keep the journal honest, both fail-closed:
 *
 * 1. **Journal only on confirmed success.** PostToolUse can fire for an
 *    `apply_patch` that was rejected or failed; journaling then would record a
 *    phantom write and manufacture false drift in the reconciler. The parsed
 *    envelope describes the *intent*, not the *outcome*, so we gate on
 *    `input.tool_response` — apply_patch's stdout string, which begins with
 *    `Success. Updated the following files:` (the apply-patch crate's
 *    `print_summary`) only when the patch actually applied. Anything else
 *    journals nothing.
 * 2. **Never recover a line range here.** PostToolUse fires AFTER the patch
 *    rewrote the file, so reading the file for range recovery reads *post-edit*
 *    content — which either coarsens every Update to whole-file or, when the
 *    edited block is duplicated elsewhere, silently anchors the untouched copy
 *    (a mis-anchored touch, worse than a whole-file fallback). The Stop drain
 *    and dispatcher consume only anchor **paths**, never ranges, so we force
 *    whole-file kinds: Add→`create`, Update/Delete→`whole-write`.
 *
 * Span surfacing is the PreToolUse hook's job (before the patch applies, against
 * genuine pre-edit content); this hook never surfaces. The timeout is
 * milliseconds in the handler config (the CLI emits `10` seconds) — see the
 * timeout-units spike note.
 */

import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst } from '../common/agent-hooks-common.js';
import { resolveTouchScope } from '../common/span-surface.js';
import { appendTouchJournal } from '../common/stop-core.js';
import { parseApplyPatch } from './apply-patch.js';
import { narrowApplyPatchCommand } from './pre-tool-use.js';

/**
 * The prefix apply_patch's stdout carries when — and only when — the patch
 * applied (codex-rs/apply-patch `print_summary`). Codex surfaces that stdout
 * verbatim as the PostToolUse `tool_response` string.
 */
const APPLY_PATCH_SUCCESS_PREFIX = 'Success. Updated the following files:';

/**
 * Affirmative, fail-closed success signal: the `apply_patch` `tool_response` is
 * the tool's stdout string and starts with {@link APPLY_PATCH_SUCCESS_PREFIX}
 * exactly when the patch applied. Any other shape (rejection text, non-string,
 * absent) reads as "did not confirm" → do not journal.
 */
export function applyPatchSucceeded(toolResponse: unknown): boolean {
  return typeof toolResponse === 'string' && toolResponse.startsWith(APPLY_PATCH_SUCCESS_PREFIX);
}

/** A reader that always declines, forcing the parser to whole-file anchors. */
const noRangeRecovery = (): null => null;

export function createHandler() {
  return (input: PostToolUseInput, ctx: HookContext) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return postToolUseOutput({});

    // Invariant 1: journal only a confirmed-applied patch (fail-closed).
    if (!applyPatchSucceeded(input.tool_response)) return postToolUseOutput({});

    const cwd = input.cwd ?? '';
    const sessionId = input.session_id;

    // Invariant 2: force whole-file anchors — pass a reader that never recovers a
    // range, so Add→create and Update/Delete→whole-write. `resolveTouchScope`
    // drops cross-repo, gitignored, and span-document paths and yields the
    // repo-relative path the journal and the Stop drain expect.
    const anchors = parseApplyPatch(command, noRangeRecovery);
    const entries: Array<{ path: string; kind: (typeof anchors)[number]['kind'] }> = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      entries.push({ path: scope.repoRelPath, kind: anchor.kind });
    }

    appendTouchJournal(sessionId, 'apply_patch', entries, ctx.logger);

    return postToolUseOutput({});
  };
}

export default postToolUseHook({ matcher: 'apply_patch', timeout: 10_000 }, createHandler());
