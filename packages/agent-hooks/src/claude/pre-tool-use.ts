/**
 * PreToolUse: surface overlapping span anchors inline when an agent reads or
 * edits a line range that intersects an existing span anchor on the same file.
 *
 * On every Read / Edit / Write whose tool input resolves to a partial line
 * range on one file, the hook calls `git span list <path> --porcelain`, keeps
 * only spans that have a line-ranged anchor intersecting the tool's range,
 * drops slugs already surfaced in this Claude Code session (on-disk
 * per-session memo), and — if anything remains — emits the human-readable
 * `git span list <names…>` block wrapped in `<git-span>…</git-span>` on both
 * channels: `hookSpecificOutput.additionalContext` (the channel that reaches
 * the model loop) and `systemMessage` (the user-facing UI line).
 *
 * Any surfaced span that is already stale (the touched lines have drifted from
 * its anchored state) additionally carries a `git span history <name>` pointer,
 * so the agent can review how that subsystem evolved before working on it.
 * Staleness is read as-of-now: PreToolUse fires before the edit applies, so the
 * hint flags pre-existing drift; drift the session itself causes is handled by
 * the Stop hook.
 *
 * Additionally, every Read / Edit / Write call is appended to a per-session
 * JSONL journal at
 * ~/.cache/git-span/session/<sanitizedSessionId>/touches.jsonl.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/claude-code-hooks';
import {
  derivePath,
  isGitIgnored,
  isInsideSpanRoot,
  type LineRange,
  type PorcelainRow,
  parsePorcelain,
  parseStalePorcelain,
  rangesIntersect,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot,
  sanitizeSessionId,
  type TouchKind,
  toPosix
} from '../common/agent-hooks-common.js';
import { type HookIgnoreLoader, isSpanSuppressed, loadHookIgnore } from '../common/span-ignore.js';

// Re-export for backward-compat of test imports (tests import these from here)
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

// ---------------------------------------------------------------------------
// Span executor abstraction
// ---------------------------------------------------------------------------

/**
 * Executes `git span list` with given args in a given cwd.
 * Returns stdout string. Throws on non-zero exit.
 */
export type SpanExecutor = (args: string[], cwd: string) => string;

export function createDefaultSpanExecutor(timeoutMs = 10_000): SpanExecutor {
  return (args, cwd) => {
    return execFileSync('git', ['span', 'list', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
  };
}

/**
 * Runs `git span stale --format porcelain <slugs>` and returns its porcelain stdout —
 * one row per *drifted* anchor among the given spans, empty when all are clean.
 * `git span stale` exits 0 in porcelain mode whether or not drift exists, but we
 * still capture stdout from a thrown error so a drift signal is never lost to a
 * non-zero exit. Throws only when no stdout is available (genuine failure).
 */
export type StaleExecutor = (slugs: string[], cwd: string) => string;

export function createDefaultStaleExecutor(timeoutMs = 10_000): StaleExecutor {
  return (slugs, cwd) => {
    try {
      return execFileSync('git', ['span', 'stale', '--format', 'porcelain', ...slugs], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs
      });
    } catch (err) {
      const out = (err as { stdout?: string }).stdout;
      if (typeof out === 'string') return out;
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Session memo abstraction
// ---------------------------------------------------------------------------

export interface MemoStore {
  getSurfaced(sessionId: string): Set<string>;
  addSurfaced(sessionId: string, names: string[]): void;
}

const MEMO_DIR = nodePath.join(os.tmpdir(), 'agent-hooks-git-span');

function memoFilePath(sessionId: string): string {
  return nodePath.join(MEMO_DIR, `${sanitizeSessionId(sessionId)}.json`);
}

export type MemoLogger = Pick<HookContext['logger'], 'warn'>;

export function createDiskMemoStore(logger: MemoLogger): MemoStore {
  return {
    getSurfaced(sessionId) {
      try {
        const raw = fs.readFileSync(memoFilePath(sessionId), 'utf8');
        const parsed = JSON.parse(raw) as { surfaced?: unknown };
        if (Array.isArray(parsed.surfaced)) {
          return new Set(parsed.surfaced as string[]);
        }
      } catch (err) {
        logger.warn('memo read failed (treating as empty)', { err });
      }
      return new Set();
    },
    addSurfaced(sessionId, names) {
      const existing = this.getSurfaced(sessionId);
      for (const n of names) existing.add(n);
      const memoPath = memoFilePath(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        fs.mkdirSync(MEMO_DIR, { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), 'utf8');
        fs.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger.warn('memo write failed', { err });
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Journal append
// ---------------------------------------------------------------------------

/** Base path for per-session touch journals. */
const JOURNAL_BASE_DIR = nodePath.join(os.homedir(), '.cache', 'git-span', 'session');

interface TouchEntry {
  tool: string;
  path: string;
  kind: TouchKind;
  seen: false;
  start?: number;
  end?: number;
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

function appendJournalEntries(
  sessionId: string,
  toolName: string,
  repoRelPath: string,
  entries: Array<{ kind: TouchKind; range?: LineRange }>,
  logger: MemoLogger
): void {
  try {
    const sessionDir = nodePath.join(JOURNAL_BASE_DIR, sanitizeSessionId(sessionId));
    fs.mkdirSync(sessionDir, { recursive: true });
    const journalPath = nodePath.join(sessionDir, 'touches.jsonl');
    const lines = entries.map((e) => {
      const row: TouchEntry = { tool: toolName, path: repoRelPath, kind: e.kind, seen: false };
      if ((e.kind === 'read' || e.kind === 'write') && e.range) {
        row.start = e.range.start;
        row.end = e.range.end;
      }
      return JSON.stringify(row);
    });
    fs.appendFileSync(journalPath, `${lines.join('\n')}\n`, 'utf8');
  } catch (err) {
    logger.warn('journal append failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Factory function that creates a MemoStore given a logger. */
export type MemoFactory = (logger: MemoLogger) => MemoStore;

/** Default disk-backed memo factory used in production. */
export function diskMemoFactory(logger: MemoLogger): MemoStore {
  return createDiskMemoStore(logger);
}

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

    // Bound everything to the CWD repo. Resolve the repo root of the current
    // working directory and require the touched file to resolve to the SAME
    // repo root. A file in a different repository — or a different worktree —
    // is out of scope: we neither journal it nor surface its spans, so the
    // Stop hook's status doc can never report foreign paths. Comparing resolved
    // `git --show-toplevel` toplevels (not path prefixes) distinguishes separate
    // repos and worktrees and is robust to symlinks. Fail closed: if the CWD
    // repo can't be resolved, record nothing rather than falling back to the
    // file's own repo.
    const cwdRepoRoot = cwd ? resolveRepoRoot(cwd) : null;
    if (!cwdRepoRoot) return null;

    const absDir = toPosix(nodePath.dirname(absPath));
    const fileRepoRoot = resolveRepoRoot(absDir);
    if (fileRepoRoot !== cwdRepoRoot) return null;

    const repoRoot = cwdRepoRoot;
    const repoRelPath = relativeToRepo(repoRoot, absPath);

    // Skip gitignored files entirely. Build output, caches, and logs are not
    // span-relevant: they must never enter the touch journal, so the Stop hook
    // can never surface them as reads, writes, or uncovered writes — nor offer
    // span overlaps on them. This sits with the repo-scoping guard above: both
    // bound what the journal may ever contain.
    if (isGitIgnored(repoRoot, repoRelPath)) return null;

    // Skip span documents entirely. Files under the resolved span root are
    // managed by git span itself and must never enter the touch journal — they
    // are not application sources that need span coverage. Dropping here is
    // strictly better than filtering only in the uncovered-writes pass: it
    // uniformly prevents reads, writes, and uncovered-writes surfacing,
    // matching the gitignore precedent.
    const spanRoot = resolveSpanRoot(repoRoot);
    if (isInsideSpanRoot(repoRelPath, spanRoot)) return null;

    // Journal append — best-effort, runs even when overlap arm returns early
    const touchEntries = deriveTouchEntries(toolName, toolInput, absPath);
    if (touchEntries.length > 0) {
      appendJournalEntries(sessionId, toolName, repoRelPath, touchEntries, ctx.logger);
    }

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

    // Filter pass: git span list <path> --porcelain
    let porcelainStdout: string;
    try {
      porcelainStdout = executor(['--porcelain', repoRelPath], repoRoot);
    } catch (err) {
      ctx.logger.warn('git span list --porcelain failed', { err });
      return null;
    }

    // Path-scoped suppression: a repo's .span/.hookignore can hold back span
    // slug prefixes (e.g. wiki, marketing) for anchors under given paths. A
    // suppressed span is dropped here so it is never surfaced inline.
    const ignoreRules = loadRules(repoRoot);

    const rows: PorcelainRow[] = parsePorcelain(porcelainStdout);
    const candidateNames = new Set<string>();
    for (const row of rows) {
      if (row.path !== repoRelPath) continue;
      if (row.start === 0 && row.end === 0) continue; // whole-file anchor
      if (!rangesIntersect(range, { start: row.start, end: row.end })) continue;
      if (isSpanSuppressed(ignoreRules, row.path, row.name)) continue;
      candidateNames.add(row.name);
    }

    if (candidateNames.size === 0) return null;

    // Subtract already-surfaced names
    const surfaced = memo.getSurfaced(sessionId);
    const toSurface = [...candidateNames].filter((n) => !surfaced.has(n)).sort();
    if (toSurface.length === 0) return null;

    // Render pass: git span list <name1> <name2> ...
    let renderStdout: string;
    try {
      renderStdout = executor(toSurface, repoRoot);
    } catch (err) {
      ctx.logger.warn('git span list (render) failed', { err });
      return null;
    }

    // Of the spans being surfaced, flag any already stale — the touched lines
    // have drifted from their anchored state — with a `git span history <name>`
    // pointer so the agent can see how the subsystem evolved before working on
    // it. Detection is as-of-now (PreToolUse runs before the edit applies), so
    // this catches pre-existing drift; drift this session causes is the Stop
    // hook's job. Failure to compute staleness is non-fatal: fall back to the
    // plain block rather than dropping it.
    let staleHint = '';
    try {
      const staleNames = new Set(parseStalePorcelain(staleExecutor(toSurface, repoRoot)).map((r) => r.name));
      const staleSurfaced = toSurface.filter((n) => staleNames.has(n));
      if (staleSurfaced.length > 0) {
        const lines = staleSurfaced.map((n) => `  git span history ${n}`).join('\n');
        staleHint = `\nStale — the lines you're touching have drifted from these spans' anchored state. Review how each subsystem evolved before changing it:\n${lines}`;
      }
    } catch (err) {
      ctx.logger.warn('git span stale (history hint) failed', { err });
    }

    const wrapped = `\n<git-span>\n${renderStdout}${staleHint}\n</git-span>\n`;

    // Update memo
    memo.addSurfaced(sessionId, toSurface);

    // Surface the span block to the agent loop via `additionalContext` (the
    // channel that actually reaches the model) and keep `systemMessage` for the
    // user-facing UI line.
    return preToolUseOutput({
      hookSpecificOutput: {
        additionalContext: wrapped
      },
      systemMessage: wrapped
    });
  };
}

export default preToolUseHook(
  { matcher: 'Read|Edit|Write', timeout: 10_000 },
  createHandler(createDefaultSpanExecutor(), diskMemoFactory)
);
