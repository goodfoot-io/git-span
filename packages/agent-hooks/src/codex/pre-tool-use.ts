/**
 * Codex PreToolUse hook — surface coupled spans before an `apply_patch` applies.
 *
 * Codex delivers every file mutation as a single `apply_patch` envelope in
 * `tool_input.command` (a `string`), not as structured `file_path`/`old_string`
 * inputs. This handler's only job is **surfacing**: it parses the envelope into
 * `AnchorSpec[]` via the shared [apply-patch parser](./apply-patch.ts), then feeds
 * each touched path + recovered range into the harness-agnostic span-surfacing
 * core (shared with the Claude adapter) to emit the `<git-span>…</git-span>`
 * block for overlapping spans as `additionalContext` (reaching the model loop)
 * and `systemMessage` (the user-facing line) before the patch lands.
 *
 * Journaling the write is the PostToolUse hook's job, per the event-mapping note:
 * PreToolUse surfaces, PostToolUse journals the confirmed edit. Anchors without a
 * recovered line range (whole-file writes, creates) have nothing to intersect and
 * are skipped here — matching the Claude handler, which does not surface on a
 * whole-file write. The session memo dedupes slugs already surfaced this session.
 *
 * `tool_input` is typed `unknown` by the SDK; we narrow it to `{ command }`.
 * The timeout is milliseconds in the handler config (the CLI emits `10` seconds).
 */

import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/codex-hooks';
import { abspathAgainst } from '../common/agent-hooks-common.js';
import { type HookIgnoreLoader, loadHookIgnore } from '../common/span-ignore.js';
import {
  createDefaultSpanExecutor,
  createDefaultStaleExecutor,
  diskMemoFactory,
  type MemoFactory,
  resolveTouchScope,
  type SpanExecutor,
  type StaleExecutor,
  surfaceOverlappingSpans
} from '../common/span-surface.js';
import { defaultReadPreEditFile, parseApplyPatch, type ReadPreEditFile } from './apply-patch.js';

/** Narrow the SDK's `unknown` tool_input to the `apply_patch` `{ command }` shape. */
export function narrowApplyPatchCommand(toolInput: unknown): string | null {
  if (toolInput !== null && typeof toolInput === 'object' && 'command' in toolInput) {
    const command = (toolInput as { command: unknown }).command;
    if (typeof command === 'string') return command;
  }
  return null;
}

export function createHandler(
  executor: SpanExecutor,
  memoFactory: MemoFactory,
  loadRules: HookIgnoreLoader = loadHookIgnore,
  staleExecutor: StaleExecutor = createDefaultStaleExecutor(),
  readPreEditFile: ReadPreEditFile = defaultReadPreEditFile
) {
  return (input: PreToolUseInput, ctx: HookContext) => {
    const command = narrowApplyPatchCommand(input.tool_input);
    if (command === null) return undefined;

    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const memo = memoFactory(ctx.logger);
    const deps = { executor, staleExecutor, memo, loadRules, logger: ctx.logger };

    // Parse the envelope into per-file anchors, then surface spans overlapping
    // each recovered range. One envelope may touch several files; the shared
    // memo dedupes across anchors within this call and across the session.
    const anchors = parseApplyPatch(command, readPreEditFile);
    const blocks: string[] = [];
    for (const anchor of anchors) {
      // Whole-file writes/creates carry no range — nothing to intersect on.
      if (!anchor.range) continue;
      const absPath = abspathAgainst(cwd, anchor.path);
      const scope = resolveTouchScope(cwd, absPath);
      if (!scope) continue;
      const block = surfaceOverlappingSpans(deps, scope.repoRoot, scope.repoRelPath, anchor.range, sessionId);
      if (block) blocks.push(block);
    }

    if (blocks.length === 0) return undefined;
    const combined = blocks.join('');
    return preToolUseOutput({ additionalContext: combined, systemMessage: combined });
  };
}

export default preToolUseHook(
  { matcher: 'apply_patch', timeout: 10_000 },
  createHandler(createDefaultSpanExecutor(), diskMemoFactory)
);
