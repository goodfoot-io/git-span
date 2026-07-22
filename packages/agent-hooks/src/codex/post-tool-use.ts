/**
 * Codex PostToolUse touch hook — heal + surface after a confirmed `apply_patch`.
 *
 * PostToolUse fires after `apply_patch` has run, so this is the accurate home for
 * the touch signal: the file is already written, so a scoped `git span stale
 * <file> --fix` heals positional drift against real bytes and the surfaced block
 * reflects the healed anchors. The handler narrows the `apply_patch` envelope
 * (`tool_input.command`, SDK-typed `unknown`) into per-file anchors via the
 * shared [apply-patch parser](./apply-patch.ts), scopes each touched file to the
 * CWD repo, and drives the harness-agnostic {@link runTouchHook} core — the same
 * core the Claude adapter uses.
 *
 * Two Codex-specific concerns are preserved from this file's journaling
 * predecessor:
 *
 * 1. **Success classification.** The parsed envelope describes *intent*, not
 *    *outcome*. Codex core fires PostToolUse only on tool success, but as a
 *    durability belt we classify `tool_response` via
 *    {@link classifyApplyPatchResponse}: a confirmed rejection (`'failure'`)
 *    suppresses the touch (no phantom heal/surface on a patch that never
 *    applied); a success or an unrecognized shape (`'unknown'`, warned) proceeds.
 * 2. **No post-edit range recovery from the envelope.** PostToolUse runs after
 *    the patch rewrote the file, so the hunk's pre-edit block no longer sits
 *    where the edit happened and could mis-anchor a duplicate. The touch is
 *    scoped file-wide (`written: ''` → whole-file), which is exactly the
 *    behavior {@link runTouchHook} takes for an empty write.
 *
 * The timeout is milliseconds in the handler config (the CLI emits `10` seconds)
 * — see the timeout-units spike note; the source value must stay in ms so the
 * Codex build's seconds conversion at emit remains correct.
 */

import { type HookContext, type PostToolUseInput, postToolUseHook, postToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst } from '../common/agent-hooks-common.js';
import { createDiskMemoStore, type MemoFactory, resolveTouchScope } from '../common/span-surface.js';
import { createDefaultTouchExecutors, runTouchHook, type TouchExecutors } from '../common/touch-core.js';
import { parseApplyPatch } from './apply-patch.js';

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

/** Narrow the SDK's `unknown` tool_input to the `apply_patch` `{ command }` shape. */
export function narrowApplyPatchCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string') return command;
  }
  return null;
}

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
 * Classify an `apply_patch` `tool_response` for the touch gate:
 *
 * - `'success'` — text was recovered and carries {@link APPLY_PATCH_SUCCESS_PREFIX}.
 * - `'failure'` — text was recovered but lacks the header: a genuine rejection
 *   or error. The ONLY classification that suppresses the touch.
 * - `'unknown'` — no text could be recovered (unrecognized shape). We proceed
 *   defensively here rather than risk missing a real edit's heal/surface; Codex
 *   core fires PostToolUse only on success, so this cannot heal/surface a patch
 *   that never applied.
 */
export function classifyApplyPatchResponse(toolResponse: unknown): 'success' | 'failure' | 'unknown' {
  const text = extractResponseText(toolResponse);
  if (text === null) return 'unknown';
  return text.startsWith(APPLY_PATCH_SUCCESS_PREFIX) ? 'success' : 'failure';
}

/** A reader that always declines, forcing the parser to whole-file anchors. */
const noRangeRecovery = (): null => null;

export function createHandler(
  executors: TouchExecutors = createDefaultTouchExecutors(),
  memoFactory: MemoFactory = createDiskMemoStore
) {
  return async (input: PostToolUseInput, ctx: HookContext) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return postToolUseOutput({});

    // Suppress only a *confirmed* non-success. An unrecognized response shape
    // proceeds (with a warning) rather than risk skipping a real edit's touch.
    const classification = classifyApplyPatchResponse(input.tool_response);
    if (classification === 'failure') return postToolUseOutput({});
    if (classification === 'unknown') {
      ctx.logger.warn('Codex apply_patch tool_response shape unrecognized; running touch defensively', {
        toolResponseType: typeof input.tool_response,
        toolResponseKeys:
          input.tool_response !== null && typeof input.tool_response === 'object'
            ? Object.keys(input.tool_response as Record<string, unknown>)
            : undefined
      });
    }

    const cwd = input.cwd ?? '';
    const sessionId = input.session_id;
    const memo = memoFactory(ctx.logger);

    // One envelope may touch several files; force whole-file anchors (Codex never
    // recovers a post-edit range) and run the shared touch core per touched file.
    // The shared memo dedupes span renders across anchors and the session.
    const anchors = parseApplyPatch(command, noRangeRecovery);
    const blocks: string[] = [];
    for (const anchor of anchors) {
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      const output = await runTouchHook(
        { kind: 'write', sessionId, cwd, filePath: absPath, written: '' },
        executors,
        memo
      );
      if (output.additionalContext) blocks.push(output.additionalContext);
    }

    if (blocks.length === 0) return postToolUseOutput({});
    const combined = blocks.join('');
    return postToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}

export default postToolUseHook({ matcher: 'apply_patch', timeout: 10_000 }, createHandler());
