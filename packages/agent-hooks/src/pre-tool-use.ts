/**
 * PreToolUse: surface overlapping mesh anchors inline when an agent reads or
 * edits a line range that intersects an existing mesh anchor on the same file.
 *
 * On every Read / Edit / MultiEdit / Write whose tool input resolves to a
 * partial line range on one file, the hook calls `git mesh list <path>
 * --porcelain`, keeps only meshes that have a line-ranged anchor intersecting
 * the tool's range, drops slugs already surfaced in this Claude Code session
 * (on-disk per-session memo), and — if anything remains — emits the
 * human-readable `git mesh list <names…>` block wrapped in
 * `<git-mesh>…</git-mesh>` as both `systemMessage` and `additionalContext`.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { type HookContext, type PreToolUseInput, preToolUseHook, preToolUseOutput } from '@goodfoot/claude-code-hooks';

// ---------------------------------------------------------------------------
// Path helpers (inlined from deleted advice-common.ts)
// ---------------------------------------------------------------------------

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isAbsolutePosix(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:\//.test(p);
}

function abspathAgainst(base: string, target: string): string {
  const t = toPosix(target);
  if (isAbsolutePosix(t)) return t;
  const b = toPosix(base).replace(/\/+$/, '');
  return `${b}/${t}`;
}

function resolveRepoRoot(dir: string | undefined | null): string | null {
  if (!dir) return null;
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    const trimmed = out.trim();
    return trimmed.length > 0 ? toPosix(trimmed) : null;
  } catch {
    return null;
  }
}

function relativeToRepo(repoRoot: string, absPath: string): string {
  const root = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

// ---------------------------------------------------------------------------
// Range derivation types and helpers
// ---------------------------------------------------------------------------

interface LineRange {
  start: number;
  end: number;
}

/** Count newlines before byteOffset in text, returning 1-based line number. */
function byteOffsetToLine(text: string, byteOffset: number): number {
  let line = 1;
  for (let i = 0; i < byteOffset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** Count lines in a string (at least 1). */
function countLines(s: string): number {
  const n = s.split('\n').length;
  return n < 1 ? 1 : n;
}

function rangesIntersect(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && a.end >= b.start;
}

// ---------------------------------------------------------------------------
// Range derivation per tool
// ---------------------------------------------------------------------------

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
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const idx = content.indexOf(oldString);
  if (idx === -1) return null;
  const start = byteOffsetToLine(content, idx);
  const end = start + countLines(oldString) - 1;
  return { start, end };
}

function deriveMultiEditRange(toolInput: ToolInput): LineRange | null {
  const filePath = toolInput.file_path;
  const edits = toolInput.edits;
  if (typeof filePath !== 'string' || !Array.isArray(edits)) return null;
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let union: LineRange | null = null;
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) continue;
    const oldString = (edit as Record<string, unknown>).old_string;
    if (typeof oldString !== 'string') continue;
    const idx = content.indexOf(oldString);
    if (idx === -1) continue;
    const start = byteOffsetToLine(content, idx);
    const end = start + countLines(oldString) - 1;
    if (union === null) {
      union = { start, end };
    } else {
      union = {
        start: Math.min(union.start, start),
        end: Math.max(union.end, end)
      };
    }
  }
  return union;
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

function derivePath(toolInput: ToolInput, cwd: string): string | null {
  const fp = toolInput.file_path;
  if (typeof fp !== 'string' || fp.length === 0) return null;
  return abspathAgainst(cwd, fp);
}

// ---------------------------------------------------------------------------
// Mesh executor abstraction
// ---------------------------------------------------------------------------

/**
 * Executes `git mesh list` with given args in a given cwd.
 * Returns stdout string. Throws on non-zero exit.
 */
export type MeshExecutor = (args: string[], cwd: string) => string;

export function createDefaultMeshExecutor(timeoutMs = 10_000): MeshExecutor {
  return (args, cwd) => {
    return execFileSync('git', ['mesh', 'list', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: timeoutMs
    });
  };
}

// ---------------------------------------------------------------------------
// Session memo abstraction
// ---------------------------------------------------------------------------

export interface MemoStore {
  getSurfaced(sessionId: string): Set<string>;
  addSurfaced(sessionId: string, names: string[]): void;
}

const MEMO_DIR = nodePath.join(os.tmpdir(), 'agent-hooks-git-mesh');

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

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
// Porcelain row parsing
// ---------------------------------------------------------------------------

interface PorcelainRow {
  name: string;
  path: string;
  start: number;
  end: number;
}

function parsePorcelain(stdout: string): PorcelainRow[] {
  const rows: PorcelainRow[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const [name, path, range] = parts;
    const dashIdx = range.indexOf('-');
    if (dashIdx === -1) continue;
    const start = parseInt(range.slice(0, dashIdx), 10);
    const end = parseInt(range.slice(dashIdx + 1), 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end });
  }
  return rows;
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

export function createHandler(executor: MeshExecutor, memoFactory: MemoFactory) {
  return (input: PreToolUseInput, ctx: HookContext) => {
    const memo = memoFactory(ctx.logger);
    const sessionId = input.session_id;
    const cwd = input.cwd ?? '';
    const toolName = input.tool_name;
    const toolInput = (input.tool_input ?? {}) as ToolInput;

    // Derive the file path
    const absPath = derivePath(toolInput, cwd);
    if (!absPath) return preToolUseOutput({});

    // Derive the line range
    let range: LineRange | null = null;
    if (toolName === 'Read') {
      range = deriveReadRange(toolInput);
    } else if (toolName === 'Edit') {
      range = deriveEditRange(toolInput);
    } else if (toolName === 'MultiEdit') {
      range = deriveMultiEditRange(toolInput);
    } else if (toolName === 'Write') {
      range = deriveWriteRange(toolInput);
    }

    if (!range) return preToolUseOutput({});

    // Resolve repo root
    const absDir = toPosix(nodePath.dirname(absPath));
    const repoRoot = resolveRepoRoot(absDir);
    if (!repoRoot) return preToolUseOutput({});

    const repoRelPath = relativeToRepo(repoRoot, absPath);

    // Filter pass: git mesh list <path> --porcelain
    let porcelainStdout: string;
    try {
      porcelainStdout = executor(['--porcelain', repoRelPath], repoRoot);
    } catch (err) {
      ctx.logger.warn('git mesh list --porcelain failed', { err });
      return preToolUseOutput({});
    }

    const rows = parsePorcelain(porcelainStdout);
    const candidateNames = new Set<string>();
    for (const row of rows) {
      if (row.path !== repoRelPath) continue;
      if (row.start === 0 && row.end === 0) continue; // whole-file anchor
      if (!rangesIntersect(range, { start: row.start, end: row.end })) continue;
      candidateNames.add(row.name);
    }

    if (candidateNames.size === 0) return preToolUseOutput({});

    // Subtract already-surfaced names
    const surfaced = memo.getSurfaced(sessionId);
    const toSurface = [...candidateNames].filter((n) => !surfaced.has(n)).sort();
    if (toSurface.length === 0) return preToolUseOutput({});

    // Render pass: git mesh list <name1> <name2> ...
    let renderStdout: string;
    try {
      renderStdout = executor(toSurface, repoRoot);
    } catch (err) {
      ctx.logger.warn('git mesh list (render) failed', { err });
      return preToolUseOutput({});
    }

    const wrapped = `\n<git-mesh>\n${renderStdout}\n</git-mesh>\n`;

    // Update memo
    memo.addSurfaced(sessionId, toSurface);

    return preToolUseOutput({
      systemMessage: wrapped,
      hookSpecificOutput: { additionalContext: wrapped }
    });
  };
}

export default preToolUseHook(
  { matcher: 'Read|Edit|MultiEdit|Write', timeout: 10_000 },
  createHandler(createDefaultMeshExecutor(), diskMemoFactory)
);
