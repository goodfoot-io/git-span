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
 * Two invariants keep the journal honest:
 *
 * 1. **Suppress only a confirmed non-success; default to journaling otherwise.**
 *    The parsed envelope describes the *intent*, not the *outcome*, so we
 *    classify `input.tool_response`. Codex core fires PostToolUse *only on tool
 *    success* (`codex-rs` `registry.rs`: `post_tool_use_payload = if success {…}
 *    else { None }`), so the outcome is already success by the time we run — the
 *    classification is a durability belt over that suspenders. apply_patch's
 *    `tool_response` today is a bare stdout string that, on a real apply, begins
 *    with `Success. Updated the following files:` (the apply-patch crate's
 *    `print_summary`, fixed across Add/Modify/Delete). But the SDK types that
 *    field as `unknown`; if Codex ever wraps it (`{output}`, `{stdout}`, …) an
 *    exact bare-string gate would silently drop **all** journaling — no
 *    `PreCommitRecord`, reconciler never runs, drift detection totally lost.
 *    That under-journaling is the severe failure; over-journaling is harmless
 *    (the dispatcher consumes only anchor *paths* and re-derives staleness from
 *    real bytes). So {@link classifyApplyPatchResponse} extracts the response
 *    text tolerantly (bare string or a common text field) and returns
 *    `'success'` | `'failure'` | `'unknown'`. We journal on `'success'` **and**
 *    `'unknown'` (warning on the latter), and suppress only on `'failure'` — a
 *    genuine rejection whose extracted text plainly lacks the success header.
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
 * verbatim as the PostToolUse `tool_response` (a bare string today). Fixed
 * across Add/Modify/Delete; the header is followed by `A/M/D <path>` lines.
 */
const APPLY_PATCH_SUCCESS_PREFIX = 'Success. Updated the following files:';

/**
 * The common fields an object-wrapped tool_response might carry the tool's text
 * output under, if Codex ever stops surfacing it as a bare string. Ordered by
 * likelihood; the first field whose value is a string wins.
 */
const RESPONSE_TEXT_FIELDS = ['output', 'stdout', 'content', 'text'] as const;

/**
 * Tolerantly pull the tool's textual output out of a `tool_response` of
 * uncertain shape (SDK-typed `unknown`): a bare string (today's Codex) is
 * returned as-is; an object is probed for the first {@link RESPONSE_TEXT_FIELDS}
 * entry that holds a string. Returns `null` when no text can be recovered
 * (unknown object shape, `null`, or a non-string/non-object), which the caller
 * treats as an *unrecognized* — not *failed* — response.
 */
function extractResponseText(toolResponse: unknown): string | null {
  if (typeof toolResponse === 'string') return toolResponse;
  if (toolResponse !== null && typeof toolResponse === 'object') {
    const record = toolResponse as Record<string, unknown>;
    for (const field of RESPONSE_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === 'string') return value;
    }
  }
  return null;
}

/**
 * Classify an `apply_patch` `tool_response` for the journaling gate:
 *
 * - `'success'` — text was recovered and carries {@link APPLY_PATCH_SUCCESS_PREFIX}.
 * - `'failure'` — text was recovered but lacks the header: a genuine rejection
 *   or error. The ONLY classification that suppresses journaling.
 * - `'unknown'` — no text could be recovered (unrecognized shape). We journal
 *   defensively here rather than risk the total-silent-loss failure of never
 *   journaling; Codex core fires PostToolUse only on success, so this cannot
 *   reintroduce a phantom-write-on-failure.
 */
export function classifyApplyPatchResponse(toolResponse: unknown): 'success' | 'failure' | 'unknown' {
  const text = extractResponseText(toolResponse);
  if (text === null) return 'unknown';
  return text.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? 'success' : 'failure';
}

/** A reader that always declines, forcing the parser to whole-file anchors. */
const noRangeRecovery = (): null => null;

export function createHandler() {
  return (input: PostToolUseInput, ctx: HookContext) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return postToolUseOutput({});

    // Invariant 1: suppress only a *confirmed* non-success. An unrecognized
    // response shape defaults to journaling (with a warning) rather than risk
    // silently dropping all Codex journaling — see the header note.
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === 'failure') return postToolUseOutput({});
    if (classification === 'unknown') {
      ctx.logger.warn('Codex apply_patch tool_response shape unrecognized; journaling defensively', {
        toolResponseType: typeof input.tool_response,
        toolResponseKeys:
          input.tool_response !== null && typeof input.tool_response === 'object'
            ? Object.keys(input.tool_response as Record<string, unknown>)
            : undefined
      });
    }

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
