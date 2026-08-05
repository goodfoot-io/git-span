/**
 * Shared Bash span → touch translation and the join-gating driver (plan §2,
 * §3 step 2). Both adapters consume this module once their duplicate Bash
 * span loops collapse (Phase 3). Phase 1 ships the translation table and the
 * interrupted classifier functional; the per-command verdict driver is a
 * stub.
 */

import type { ResolvedSpan, SpanMatch } from './parse-command.js';
import { type MemoStore, resolveTouchScope } from './span-surface.js';
import type { TouchExecutors, TouchInput } from './touch-core.js';

/**
 * Translate one resolved span into a fully-typed {@link TouchInput} per the
 * plan §2 table, or `null` when the path fails `resolveTouchScope` — cross-
 * repo, gitignored, and span-document paths fail closed.
 *
 * The post-state gate fields the span can determine (`targetState`, and
 * `postState` for appends and deletes) are set here; the content-verification
 * cases (exact/empty/size) arrive with the family grammars (Phase 3).
 */
export function bashSpanToTouch(span: ResolvedSpan, sessionId: string, cwd: string): TouchInput | null {
  if (!resolveTouchScope(cwd, span.absolutePath)) return null;
  switch (span.operation) {
    case 'read':
      return {
        kind: 'read',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        offset: span.lineStart,
        limit:
          span.lineStart !== undefined && span.lineEnd !== undefined ? span.lineEnd - span.lineStart + 1 : undefined
      };
    case 'create-overwrite':
    case 'rename-copy':
    case 'truncate':
      // Whole-file writes: `written: ''` scopes the touch to every covering
      // span — truncating writes destroy anchors beyond the new EOF (the
      // main-200 F2 lesson).
      return { kind: 'write', sessionId, cwd, filePath: span.absolutePath, written: '', targetState: 'exists' };
    case 'append':
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: span.written ?? '',
        targetState: 'exists',
        postState: span.written !== undefined ? { content: { suffix: span.written } } : undefined
      };
    case 'modify':
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: '',
        targetState: 'exists',
        range: span.lineStart !== undefined ? { start: span.lineStart, end: span.lineEnd ?? span.lineStart } : undefined
      };
    case 'delete':
      return {
        kind: 'write',
        sessionId,
        cwd,
        filePath: span.absolutePath,
        written: '',
        targetState: 'absent',
        postState: { realDelete: true }
      };
  }
}

/**
 * Whether the Bash `tool_response` signals that the command was interrupted
 * (plan §4). The SDK types the response `unknown` on both adapters, so this
 * is a defensive runtime shape-probe: an object carrying a truthy
 * `interrupted` field classifies as interrupted; any other shape (string,
 * null, object without the field) proceeds fail-open, matching today's
 * behavior.
 */
export function bashResponseInterrupted(toolResponse: unknown): boolean {
  if (toolResponse !== null && typeof toolResponse === 'object') {
    return Boolean((toolResponse as Record<string, unknown>).interrupted);
  }
  return false;
}

/**
 * Shared Bash driver (plan §3 step 2): owns the per-command verdict thread —
 * pass A `evaluateWriteGate` sweep, the explanation map, the join filter, and
 * pass B per-surviving-span `runTouchHook` — plus the whole-command
 * `interrupted` gate (plan §4). Returns the non-null `additionalContext`
 * blocks for the adapter to join.
 *
 * Phase 1 stub: the verdict machinery (per-command verdicts, explanations,
 * join filter) is Phase 3 work; only the interrupted gate runs, and it fails
 * closed.
 */
export async function runBashTouches(
  matches: SpanMatch[],
  sessionId: string,
  cwd: string,
  toolResponse: unknown,
  executors: TouchExecutors,
  memo: MemoStore
): Promise<string[]> {
  void matches;
  void sessionId;
  void cwd;
  void executors;
  void memo;
  // A command that did not complete produces no touches, whatever its spans.
  if (bashResponseInterrupted(toolResponse)) return [];
  // Phase 1 stub: per-command verdicts and the join filter are Phase 3.
  return [];
}
