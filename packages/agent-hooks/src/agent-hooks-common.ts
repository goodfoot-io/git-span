/**
 * Shared helpers used by multiple agent-hooks entry points.
 *
 * Extracted from pre-tool-use.ts so that the upcoming Stop hook (and any
 * future hooks) can import path utilities, range helpers, and the
 * sanitizeSessionId/formatAnchor functions without depending on the
 * PreToolUse-specific module.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isAbsolutePosix(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:\//.test(p);
}

export function abspathAgainst(base: string, target: string): string {
  const t = toPosix(target);
  if (isAbsolutePosix(t)) return t;
  const b = toPosix(base).replace(/\/+$/, '');
  return `${b}/${t}`;
}

export function resolveRepoRoot(dir: string | undefined | null): string | null {
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

export function relativeToRepo(repoRoot: string, absPath: string): string {
  const root = toPosix(repoRoot);
  const abs = toPosix(absPath);
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

export function canonicalizePath(absPath: string): string {
  try {
    return toPosix(fs.realpathSync.native(absPath));
  } catch {
    // File doesn't exist yet (e.g. Write to a new file): canonicalize the
    // directory and rejoin the basename so symlinks in the parent are resolved.
    try {
      const dir = toPosix(fs.realpathSync.native(nodePath.dirname(absPath)));
      return `${dir}/${nodePath.basename(absPath)}`;
    } catch {
      // Parent doesn't exist either; fall back to the un-canonicalized path.
      return absPath;
    }
  }
}

export function derivePath(toolInput: Record<string, unknown>, cwd: string): string | null {
  const fp = toolInput.file_path;
  if (typeof fp !== 'string' || fp.length === 0) return null;
  const abs = abspathAgainst(cwd, fp);
  return canonicalizePath(abs);
}

// ---------------------------------------------------------------------------
// Line range types and helpers
// ---------------------------------------------------------------------------

export interface LineRange {
  start: number;
  end: number;
}

export function rangesIntersect(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && a.end >= b.start;
}

// ---------------------------------------------------------------------------
// Porcelain row parsing
// ---------------------------------------------------------------------------

export interface PorcelainRow {
  name: string;
  path: string;
  start: number;
  end: number;
}

export function parsePorcelain(stdout: string): PorcelainRow[] {
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
// Session ID sanitization
// ---------------------------------------------------------------------------

/**
 * Injective transform: percent-encode bytes outside [A-Za-z0-9._-] as %HH
 * (uppercase hex). Used to produce safe filenames from arbitrary session ids.
 */
export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
  });
}

// ---------------------------------------------------------------------------
// Touch kind and anchor formatting
// ---------------------------------------------------------------------------

export type TouchKind = 'read' | 'write' | 'whole' | 'create';

/**
 * Format a mesh anchor string.
 *
 * - `whole` and `create`: returns just the path
 * - `read` and `write`: returns `path#L<start>-L<end>` (requires range)
 */
export function formatAnchor(path: string, kind: TouchKind, range?: LineRange): string {
  if ((kind === 'read' || kind === 'write') && range) {
    return `${path}#L${range.start}-L${range.end}`;
  }
  return path;
}
