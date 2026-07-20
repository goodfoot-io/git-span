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
import * as os from 'node:os';
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

/**
 * Report whether a repo-relative path is excluded by git's ignore rules
 * (.gitignore, .git/info/exclude, core.excludesFile). Used to keep ignored
 * files — build output, caches, logs — out of touch tracking entirely, so
 * the touch hook never reports reads, writes, or uncovered writes on them.
 *
 * `git check-ignore -q <path>` exits 0 when the path is ignored, 1 when it is
 * not, and 128 on error. execFileSync throws on any non-zero exit, so a clean
 * return means "ignored". A status-1 throw is the expected "not ignored"
 * signal; any other failure is an unreliable answer, so we report `false`
 * (do not drop the touch) rather than silently hiding a tracked file.
 */
/**
 * The default span root directory, relative to the repo root, used when no
 * environment variable or git config overrides the location.
 */
export const SPAN_ROOT = '.span';

/**
 * Resolve the span root directory for a given repo, mirroring the Rust CLI
 * precedence (minus the --span-dir CLI flag, which is invisible to file-write
 * hooks):
 *   1. GIT_SPAN_DIR environment variable
 *   2. `git config git-span.dir` in the repo
 *   3. Default: ".span"
 *
 * The returned value is a POSIX-style path with no trailing slash.
 * Fail-safe: any resolution error falls back to ".span" so the hook never
 * crashes.
 */
export function resolveSpanRoot(repoRoot: string): string {
  const envDir = process.env['GIT_SPAN_DIR'];
  if (envDir && envDir.trim().length > 0) {
    return toPosix(envDir.trim()).replace(/\/+$/, '');
  }
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'config', 'git-span.dir'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    const trimmed = toPosix(out.trim()).replace(/\/+$/, '');
    if (trimmed.length > 0) return trimmed;
  } catch (err) {
    void err; // config key absent or git error — fall through to default
  }
  return SPAN_ROOT;
}

/**
 * Report whether a repo-relative POSIX path falls inside the given span root
 * directory. A path is inside when it equals the span root exactly or is
 * nested beneath it (i.e. starts with "<spanRoot>/"). The "/" boundary prevents
 * false positives for siblings like ".spans/x" or ".span-notes/x".
 *
 * Pass the result of `resolveSpanRoot(repoRoot)` as `spanRoot`.
 */
export function isInsideSpanRoot(repoRelPath: string, spanRoot: string = SPAN_ROOT): boolean {
  const root = spanRoot.replace(/\/+$/, '');
  return repoRelPath === root || repoRelPath.startsWith(`${root}/`);
}

export function isGitIgnored(repoRoot: string, repoRelPath: string): boolean {
  try {
    execFileSync('git', ['-C', repoRoot, 'check-ignore', '-q', '--', repoRelPath], {
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch (err) {
    void err;
    return false;
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

/**
 * The full `git span stale --format porcelain` status token vocabulary (the
 * git-span CLI's porcelain contract): `FRESH`/`MOVED`/`RESOLVED_PENDING_COMMIT`
 * are positional-or-clean and never debt; every other token is semantic drift
 * or a terminal/error condition and is debt. See {@link isDebt} for the
 * single source of truth on that split.
 */
export const PORCELAIN_STATUSES = [
  'FRESH',
  'RESOLVED_PENDING_COMMIT',
  'MOVED',
  'CHANGED',
  'DELETED',
  'CONFLICT',
  'SUBMODULE',
  'LFS_NOT_FETCHED',
  'LFS_NOT_INSTALLED',
  'PROMISOR_MISSING',
  'SPARSE_EXCLUDED',
  'FILTER_FAILED',
  'IO_ERROR'
] as const;

export type PorcelainStatus = (typeof PORCELAIN_STATUSES)[number];

const PORCELAIN_STATUS_SET: ReadonlySet<string> = new Set(PORCELAIN_STATUSES);

function parsePorcelainStatus(raw: string): PorcelainStatus | null {
  return PORCELAIN_STATUS_SET.has(raw) ? (raw as PorcelainStatus) : null;
}

/** A `parseStalePorcelain` row: a {@link PorcelainRow} plus its status token. */
export interface StalePorcelainRow extends PorcelainRow {
  status: PorcelainStatus;
}

/**
 * The debt invariant (system-wide; consumed by both the future touch-core and
 * gate-core): only semantic statuses are debt. `CHANGED` and `DELETED` are
 * semantic drift; the remaining non-FRESH/MOVED/RESOLVED_PENDING_COMMIT tokens
 * are terminal/error conditions and are treated as debt too (they block on
 * their own merits — the CLI could not resolve the anchor at all). `FRESH`,
 * `MOVED`, and `RESOLVED_PENDING_COMMIT` are never debt: positional drift the
 * CLI can heal (or already has) is invisible, and a pending-commit resolution
 * is not outstanding debt.
 *
 * Note: the porcelain vocabulary does not currently distinguish
 * content-equivalent `CHANGED` (e.g. whitespace-only drift `--fix` can heal)
 * from genuinely semantic `CHANGED` — that classification is not present in
 * `git span stale --format porcelain` output today. Until the CLI exposes it,
 * every `CHANGED` row is treated as debt.
 */
export function isDebt(status: PorcelainStatus): boolean {
  switch (status) {
    case 'FRESH':
    case 'MOVED':
    case 'RESOLVED_PENDING_COMMIT':
      return false;
    default:
      return true;
  }
}

/**
 * The terminal/environmental statuses: the CLI could not resolve the anchor at
 * all, so the row is not span drift a user can fix by editing a span. These are
 * `CONFLICT` (unresolved merge), `SUBMODULE` (anchor inside a submodule),
 * `LFS_NOT_FETCHED`/`LFS_NOT_INSTALLED` (Git LFS content unavailable),
 * `PROMISOR_MISSING` (partial-clone object not fetched), `SPARSE_EXCLUDED`
 * (path outside the sparse-checkout cone), `FILTER_FAILED` (a clean/smudge
 * filter errored), and `IO_ERROR` (transient read failure).
 *
 * These are a strict subset of {@link isDebt}: every environmental status is
 * also debt (it blocks on its own merits when surfaced in a status report), but
 * the gate must treat them differently from *semantic* drift (`CHANGED`,
 * `DELETED`). Semantic drift is fixable by editing a span, so the gate fails
 * closed on it; an environmental condition is not something a span edit can
 * resolve, so the gate fails OPEN on it (allow, but surface the condition) —
 * re-denying forever on an infra failure the user cannot clear from here would
 * contradict the fail-open contract the rest of the gate already honors for
 * CLI-absent/timeout/parse-failure conditions.
 */
export function isEnvironmentalStatus(status: PorcelainStatus): boolean {
  switch (status) {
    case 'CONFLICT':
    case 'SUBMODULE':
    case 'LFS_NOT_FETCHED':
    case 'LFS_NOT_INSTALLED':
    case 'PROMISOR_MISSING':
    case 'SPARSE_EXCLUDED':
    case 'FILTER_FAILED':
    case 'IO_ERROR':
      return true;
    default:
      return false;
  }
}

/**
 * `git span stale --format porcelain` emits a different shape than
 * `list --porcelain`: a `# porcelain v2` header, `# fuzzy N` comment lines,
 * and one `<status>\t<src>\t<name>\t<path>\t<start>\t<end>` row per drifted
 * anchor (whole-file anchors carry `(whole)`/`-` in place of the line columns).
 * Rows whose status token is not in {@link PORCELAIN_STATUSES} are skipped —
 * an unrecognized token from a newer CLI is treated the same as a malformed
 * line rather than guessed at.
 */
export function parseStalePorcelain(stdout: string): StalePorcelainRow[] {
  const rows: StalePorcelainRow[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 6) continue;
    const [statusCol, , name, path, startCol, endCol] = parts;
    const status = parsePorcelainStatus(statusCol);
    if (!status) continue;
    const start = startCol === '(whole)' ? 0 : parseInt(startCol, 10);
    const end = endCol === '-' ? 0 : parseInt(endCol, 10);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    rows.push({ name, path, start, end, status });
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
// Per-session base directory
// ---------------------------------------------------------------------------

// Base dir shared by all per-session state: currently just the touch-hook
// session memo (span-surface.ts's MemoStore). Each session gets one
// subdirectory keyed by its sanitized id, so every writer/reader for a given
// session agrees on its location.
export const SESSION_BASE_DIR = nodePath.join(os.homedir(), '.cache', 'git-span', 'session');

/** The per-session state directory for a given session id. */
export function sessionDir(sessionId: string): string {
  return nodePath.join(SESSION_BASE_DIR, sanitizeSessionId(sessionId));
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Opportunistically prune per-session state directories under
 * {@link SESSION_BASE_DIR} whose mtime is older than `maxAgeMs` (default 30
 * days). A directory's mtime advances whenever an entry inside it is
 * created/renamed/removed, so an active session (memo writes) stays fresh;
 * only genuinely abandoned sessions age out.
 *
 * Best-effort and non-throwing: called opportunistically from hook read/write
 * paths, not a separate cron-like mechanism, so a failure here must never
 * block the caller's actual work.
 */
export function pruneStaleSessions(now: number = Date.now(), maxAgeMs: number = THIRTY_DAYS_MS): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SESSION_BASE_DIR, { withFileTypes: true });
  } catch {
    return; // base dir absent or unreadable — nothing to prune
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(SESSION_BASE_DIR, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch {
      // Vanished between readdir and stat, or removal failed — skip it. A
      // best-effort prune must never throw into the caller's hot path.
    }
  }
}

// ---------------------------------------------------------------------------
// Touch kind and anchor formatting
// ---------------------------------------------------------------------------

export type TouchKind = 'read' | 'write' | 'whole-read' | 'whole-write' | 'create';

/**
 * Format a span anchor string.
 *
 * - `whole-read`, `whole-write`, and `create`: returns just the path
 * - `read` and `write`: returns `path#L<start>-L<end>` (requires range)
 */
export function formatAnchor(path: string, kind: TouchKind, range?: LineRange): string {
  if ((kind === 'read' || kind === 'write') && range) {
    return `${path}#L${range.start}-L${range.end}`;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Anchor spec type
// ---------------------------------------------------------------------------

export interface AnchorSpec {
  path: string;
  kind: TouchKind;
  range?: LineRange;
}

// ---------------------------------------------------------------------------
// Queue directory helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the git common directory for the given repo root.
 * This is the shared directory (not the worktree-specific .git), so queue
 * records survive worktree deletion.
 */
export function resolveGitCommonDir(repoRoot: string): string {
  const out = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-common-dir'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8'
  });
  const trimmed = toPosix(out.trim());
  // git returns a relative path (e.g. ".git") for simple repos. Resolve it
  // against repoRoot so callers never depend on process.cwd().
  if (!nodePath.isAbsolute(trimmed)) {
    return toPosix(nodePath.resolve(repoRoot, trimmed));
  }
  return trimmed;
}

/**
 * Root of the git-span queue directory tree, under the git common dir.
 */
export function queueRoot(repoRoot: string): string {
  return nodePath.join(resolveGitCommonDir(repoRoot), 'git-span');
}

/**
 * Directory for the gate's per-changeset state memos (digest of sorted
 * findings + uncovered paths), under the git common dir so it is shared
 * across worktrees.
 */
export function gateMemoDir(repoRoot: string): string {
  return nodePath.join(queueRoot(repoRoot), 'gate');
}
