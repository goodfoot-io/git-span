/**
 * Claude PreToolUse hook — thin SDK-bound entry point.
 *
 * The Claude-specific job of this file is parsing the structured `tool_input`
 * (`file_path`/`offset`/`limit`/`old_string`/`new_string`/`content`) into a
 * touched path, a `TouchKind`, and — where derivable — a line range. Everything
 * downstream of "given a path (+ optional range + kind)" is harness-agnostic and
 * lives in the shared cores: repo/gitignore/span-root scoping and the porcelain/
 * memo/stale surfacing pipeline in [common/span-surface.ts](../common/span-surface.ts),
 * and the touch journal in [common/stop-core.ts](../common/stop-core.ts). The
 * Codex adapter feeds those same cores from an `apply_patch` envelope instead.
 *
 * On every Read / Edit / Write whose input resolves to a partial line range on
 * one file, the hook surfaces spans overlapping that range as `additionalContext`
 * (reaching the model loop) and `systemMessage` (the user-facing UI line), and
 * appends the touch to the per-session journal for the Stop hook to drain.
 */

import * as fs from 'node:fs';
import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/claude-code-hooks';
import { derivePath, type LineRange, type TouchKind, toPosix } from '../common/agent-hooks-common.js';
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
import { appendTouchJournal } from '../common/stop-core.js';

// Re-export for backward-compat of test/helper imports (they import this from here)
export { toPosix };

// ---------------------------------------------------------------------------
// Range derivation helpers (PreToolUse-specific, not shared)
// ---------------------------------------------------------------------------

/** Count newlines before byteOffset in text, returning 1-based line number. */
function byteOffsetToLine(text: string, byteOffset: number): number {
  let line = 1;
  for (let i = 0; i < byteOffset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** Count lines in a string (at least 1). Trailing newline does not add an extra line. */
function countLines(s: string): number {
  const newlines = (s.match(/\n/g) ?? []).length;
  // A trailing newline ends the last line; it doesn't start an additional one.
  const trailingNewline = s.length > 0 && s[s.length - 1] === '\n';
  const n = newlines + (trailingNewline ? 0 : 1);
  return n < 1 ? 1 : n;
}

type ToolInput = Record<string, unknown>;

function deriveReadRange(toolInput: ToolInput): LineRange | null {
  const offset = toolInput.offset;
  const limit = toolInput.limit;
  if (typeof offset === 'number' && typeof limit === 'number' && limit > 0) {
    return { start: offset, end: offset + limit - 1 };
  }
  return null;
}

function deriveEditRange(toolInput: ToolInput): LineRange | null {
  const filePath = toolInput.file_path;
  const oldString = toolInput.old_string;
  if (typeof filePath !== 'string' || typeof oldString !== 'string') return null;
  // Empty old_string has no derivable range (indexOf('') === 0 would always hit line 1).
  if (oldString === '') return null;
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  if (toolInput.replace_all === true) {
    // Union all occurrence ranges when replace_all is set.
    let union: LineRange | null = null;
    let searchFrom = 0;
    while (true) {
      const idx = content.indexOf(oldString, searchFrom);
      if (idx === -1) break;
      const start = byteOffsetToLine(content, idx);
      const end = start + countLines(oldString) - 1;
      if (union === null) {
        union = { start, end };
      } else {
        union = { start: Math.min(union.start, start), end: Math.max(union.end, end) };
      }
      searchFrom = idx + oldString.length;
    }
    return union;
  }
  const idx = content.indexOf(oldString);
  if (idx === -1) return null;
  const start = byteOffsetToLine(content, idx);
  const end = start + countLines(oldString) - 1;
  return { start, end };
}

/** Strip trailing empty strings produced by a trailing newline in split("\n"). */
function stripTrailingEmpty(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end--;
  return lines.slice(0, end);
}

function deriveWriteRange(toolInput: ToolInput): LineRange | null {
  const filePath = toolInput.file_path;
  const newContent = toolInput.content;
  if (typeof filePath !== 'string' || typeof newContent !== 'string') return null;
  let existing: string;
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    // File doesn't exist — new file creation, emit nothing
    return null;
  }
  // Normalize: strip trailing empty entry from split so "a\n" and "a" are the
  // same for line-count purposes.
  const existingLines = stripTrailingEmpty(existing.split('\n'));
  const newLines = stripTrailingEmpty(newContent.split('\n'));

  if (existingLines.length === 0) return null;

  // Find first changed line (0-indexed)
  let first = 0;
  while (first < existingLines.length && first < newLines.length && existingLines[first] === newLines[first]) {
    first++;
  }
  if (first === existingLines.length) {
    // No changes in existing content
    return null;
  }
  // Find last changed existing line from the end
  let tailExisting = existingLines.length - 1;
  let tailNew = newLines.length - 1;
  while (tailExisting > first && tailNew >= 0 && existingLines[tailExisting] === newLines[tailNew]) {
    tailExisting--;
    tailNew--;
  }
  // If the window spans every existing line, emit nothing (full replacement)
  if (first === 0 && tailExisting === existingLines.length - 1) {
    return null;
  }
  return { start: first + 1, end: tailExisting + 1 };
}

/**
 * Derive touch kind and optional range for the journal.
 *
 * Unlike the overlap arm, this never returns early just because the range is
 * null — a whole-file Read or a create Write are still journal-relevant.
 *
 * Returns an array for uniformity with callers that iterate the result;
 * each tool currently emits at most one entry.
 */
function deriveTouchEntries(
  toolName: string,
  toolInput: ToolInput,
  absPath: string
): Array<{ kind: TouchKind; range?: LineRange }> {
  if (toolName === 'Read') {
    const range = deriveReadRange(toolInput);
    if (range) {
      return [{ kind: 'read', range }];
    }
    return [{ kind: 'whole-read' }];
  }

  if (toolName === 'Edit') {
    const range = deriveEditRange(toolInput);
    if (range) {
      return [{ kind: 'write', range }];
    }
    // old_string not found or empty — fall back to whole-write
    return [{ kind: 'whole-write' }];
  }

  if (toolName === 'Write') {
    // Detect create: file doesn't exist on disk at hook time
    if (!fs.existsSync(absPath)) {
      return [{ kind: 'create' }];
    }
    const range = deriveWriteRange(toolInput);
    if (range) {
      return [{ kind: 'write', range }];
    }
    // null from deriveWriteRange means full replacement (or no changes)
    return [{ kind: 'whole-write' }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createHandler(
  executor: SpanExecutor,
  memoFactory: MemoFactory,
  loadRules: HookIgnoreLoader = loadHookIgnore,
  staleExecutor: StaleExecutor = createDefaultStaleExecutor()
) {
  return (input: PreToolUseInput, ctx: HookContext) => {
    const memo = memoFactory(ctx.logger);
    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as ToolInput;

    // Derive the file path
    const absPath = derivePath(toolInput, cwd);
    if (!absPath) return null;

    // Bound the touch to the CWD repo (drops cross-repo, gitignored, and span
    // documents). Fail closed on an unresolvable CWD repo.
    const scope = resolveTouchScope(cwd, absPath);
    if (!scope) return null;
    const { repoRoot, repoRelPath } = scope;

    // Journal append — best-effort, runs even when the overlap arm returns early.
    const touchEntries = deriveTouchEntries(toolName, toolInput, absPath);
    appendTouchJournal(
      sessionId,
      toolName,
      touchEntries.map((e) => ({ path: repoRelPath, kind: e.kind, range: e.range })),
      ctx.logger
    );

    // Derive the line range for the overlap arm
    let range: LineRange | null = null;
    if (toolName === 'Read') {
      range = deriveReadRange(toolInput);
    } else if (toolName === 'Edit') {
      range = deriveEditRange(toolInput);
    } else if (toolName === 'Write') {
      range = deriveWriteRange(toolInput);
    }

    if (!range) return null;

    const block = surfaceOverlappingSpans(
      { executor, staleExecutor, memo, loadRules, logger: ctx.logger },
      repoRoot,
      repoRelPath,
      range,
      sessionId
    );
    if (!block) return null;

    // Surface the span block to the agent loop via `additionalContext` (the
    // channel that actually reaches the model) and keep `systemMessage` for the
    // user-facing UI line.
    return preToolUseOutput({
      hookSpecificOutput: {
        additionalContext: block
      },
      systemMessage: block
    });
  };
}

export default preToolUseHook(
  { matcher: 'Read|Edit|Write', timeout: 10_000 },
  createHandler(createDefaultSpanExecutor(), diskMemoFactory)
);
