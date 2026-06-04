/**
 * Shared helpers used by multiple agent-hooks entry points.
 *
 * Extracted from pre-tool-use.ts so that the upcoming Stop hook (and any
 * future hooks) can import path utilities, range helpers, and the
 * sanitizeSessionId/formatAnchor functions without depending on the
 * PreToolUse-specific module.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
 * files — build output, caches, logs — out of the touch journal entirely, so
 * the Stop hook never reports reads, writes, or uncovered writes on them.
 *
 * `git check-ignore -q <path>` exits 0 when the path is ignored, 1 when it is
 * not, and 128 on error. execFileSync throws on any non-zero exit, so a clean
 * return means "ignored". A status-1 throw is the expected "not ignored"
 * signal; any other failure is an unreliable answer, so we report `false`
 * (do not drop the touch) rather than silently hiding a tracked file.
 */
/**
 * The default mesh root directory, relative to the repo root, used when no
 * environment variable or git config overrides the location.
 */
export const MESH_ROOT = '.mesh';

/**
 * Resolve the mesh root directory for a given repo, mirroring the Rust CLI
 * precedence (minus the --mesh-dir CLI flag, which is invisible to file-write
 * hooks):
 *   1. GIT_MESH_DIR environment variable
 *   2. `git config git-mesh.dir` in the repo
 *   3. Default: ".mesh"
 *
 * The returned value is a POSIX-style path with no trailing slash.
 * Fail-safe: any resolution error falls back to ".mesh" so the hook never
 * crashes.
 */
export function resolveMeshRoot(repoRoot: string): string {
  const envDir = process.env['GIT_MESH_DIR'];
  if (envDir && envDir.trim().length > 0) {
    return toPosix(envDir.trim()).replace(/\/+$/, '');
  }
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'config', 'git-mesh.dir'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    const trimmed = toPosix(out.trim()).replace(/\/+$/, '');
    if (trimmed.length > 0) return trimmed;
  } catch (err) {
    void err; // config key absent or git error — fall through to default
  }
  return MESH_ROOT;
}

/**
 * Report whether a repo-relative POSIX path falls inside the given mesh root
 * directory. A path is inside when it equals the mesh root exactly or is
 * nested beneath it (i.e. starts with "<meshRoot>/"). The "/" boundary prevents
 * false positives for siblings like ".meshes/x" or ".mesh-notes/x".
 *
 * Pass the result of `resolveMeshRoot(repoRoot)` as `meshRoot`.
 */
export function isInsideMeshRoot(repoRelPath: string, meshRoot: string = MESH_ROOT): boolean {
  const root = meshRoot.replace(/\/+$/, '');
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
// Per-session expert-agent marker
// ---------------------------------------------------------------------------

// Base dir shared with the Stop hook's touch journal. Each session gets one
// directory; the expert-agent marker lives alongside the journal so the
// SubagentStart hook (writer) and the Stop hook (reader) agree on its location.
const SESSION_BASE_DIR = nodePath.join(os.homedir(), '.cache', 'git-mesh', 'session');

export function expertAgentMarkerPath(sessionId: string): string {
  return nodePath.join(SESSION_BASE_DIR, sanitizeSessionId(sessionId), 'expert-agent.json');
}

/**
 * Record the most recently spawned git-mesh:expert subagent for a session.
 * Latest-write-wins: a later spawn overwrites the wake target. Best-effort —
 * a write failure leaves the Stop hook to dispatch a fresh spawn instead.
 */
export function recordExpertAgent(
  sessionId: string,
  agentId: string,
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void }
): void {
  const path = expertAgentMarkerPath(sessionId);
  try {
    fs.mkdirSync(nodePath.dirname(path), { recursive: true });
    fs.writeFileSync(path, `${JSON.stringify({ agentId })}\n`, 'utf8');
  } catch (err) {
    logger?.warn('failed to record expert agent marker', { err });
  }
}

/**
 * Read the recorded expert agent id for a session, or null if none has been
 * spawned this session (or the marker is missing/unreadable/malformed).
 */
export function readExpertAgentId(sessionId: string): string | null {
  try {
    const raw = fs.readFileSync(expertAgentMarkerPath(sessionId), 'utf8');
    const parsed = JSON.parse(raw) as { agentId?: unknown };
    return typeof parsed.agentId === 'string' && parsed.agentId.length > 0 ? parsed.agentId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-session subagent counter
// ---------------------------------------------------------------------------

export function subagentCountPath(sessionId: string): string {
  return nodePath.join(SESSION_BASE_DIR, sanitizeSessionId(sessionId), 'subagent-count');
}

// Lock constants
const LOCK_RETRY_INTERVAL_MS = 5;
// The critical section is a microsecond-scale read-modify-write, so real
// contention resolves almost immediately. A generous budget (~5 s of retries)
// means the only way to exhaust it is a genuinely abandoned lock — which the
// stale-lock breaker reclaims below — rather than ordinary contention.
const LOCK_MAX_RETRIES = 1000; // ~5 s total budget at 5 ms/retry
// Reclaim locks older than this. The hold is microsecond-scale, so a threshold
// this far above any real hold time means a lock this old is genuinely
// abandoned (a crashed/killed holder), never one mid-critical-section.
const LOCK_STALE_MS = 30_000; // 30 s

type CountLogger = { warn: (msg: string, meta?: Record<string, unknown>) => void } | undefined;

/**
 * Acquire an exclusive per-session filesystem lock.
 *
 * Spins with LOCK_RETRY_INTERVAL_MS sleeps up to LOCK_MAX_RETRIES attempts,
 * giving a generous budget so ordinary contention never exhausts it. A lock
 * whose mtime is older than LOCK_STALE_MS is treated as abandoned and reclaimed.
 *
 * Reclaim is race-free: the contender first atomically renames the stale lock to
 * a unique sidelined name (`rename` has exactly one winner across processes),
 * then unlinks the sideline and retries the exclusive `open(wx)`. Two contenders
 * cannot both win the rename, so they cannot both acquire — at most one reclaims
 * and the rest fall back to the normal exclusive-create contention.
 *
 * Returns the lock path for the caller to unlink in finally.
 */
function acquireLock(countFilePath: string): string {
  const lockPath = `${countFilePath}.lock`;
  let attempts = 0;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.closeSync(fd);
      return lockPath;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'EEXIST') throw err;
      // Lock exists — check staleness.
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          // Abandoned: reclaim atomically. Rename the stale lock aside; only one
          // contender can win this rename, so reclaim cannot race two acquirers.
          const sideline = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
          try {
            fs.renameSync(lockPath, sideline);
            try {
              fs.unlinkSync(sideline);
            } catch (e2) {
              void e2;
            }
          } catch (e2) {
            // Lost the rename race (another contender reclaimed it) or the lock
            // vanished — either way, retry the exclusive create.
            void e2;
          }
          continue;
        }
      } catch {
        // Lock disappeared between existence check and stat — retry.
        continue;
      }
      if (++attempts >= LOCK_MAX_RETRIES) {
        throw new Error(`subagent-count: could not acquire lock after ${LOCK_MAX_RETRIES} retries`);
      }
      // Busy-wait with a synchronous sleep (hooks are short-lived processes).
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_INTERVAL_MS);
    }
  }
}

/**
 * Read and parse the count file. Distinguishes three states:
 *   - absent (ENOENT) → 0 (legitimate "no subagent has started this session")
 *   - present but empty / unparseable / negative → throws (ambiguous; the caller
 *     must fail closed and suppress rather than treat as 0)
 *   - present and a valid non-negative integer → that value
 *
 * Any non-ENOENT I/O error (EACCES, EIO, EISDIR, …) propagates unchanged.
 */
function readCountRaw(countFilePath: string): number {
  let raw: string;
  try {
    raw = fs.readFileSync(countFilePath, 'utf8').trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return 0;
    throw err;
  }
  if (!raw) {
    throw new Error(`subagent-count: count file is present but empty: ${countFilePath}`);
  }
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`subagent-count: count file holds an unparseable or negative value: ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * Atomically persist the count: write a uniquely-named temp file in the same
 * directory, then `rename` it into place. Rename is atomic on the same
 * filesystem, so a concurrent lock-free reader observes either the old complete
 * file or the new complete file — never a torn or zero-byte intermediate. The
 * temp name carries the pid and a uuid so two writers never collide. Mirrors
 * `writeJournal` in stop.ts.
 */
function writeCountAtomic(countFilePath: string, value: number | string): void {
  const tmpPath = `${countFilePath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    fs.writeFileSync(tmpPath, `${value}`, 'utf8');
    fs.renameSync(tmpPath, countFilePath);
  } catch (err) {
    // Best-effort cleanup of the temp file on failure, then re-throw so the
    // caller (incrementSubagentCount/decrementSubagentCount) logs it.
    try {
      fs.unlinkSync(tmpPath);
    } catch (e) {
      void e;
    }
    throw err;
  }
}

function withCountLock(countFilePath: string, fn: (current: number) => number): void {
  // Ensure the session directory exists before acquiring the lock — the lock
  // file lives in the same directory as the count file.
  fs.mkdirSync(nodePath.dirname(countFilePath), { recursive: true });
  const lockPath = acquireLock(countFilePath);
  try {
    // Under the lock the file is never torn, so a present-but-empty/unparseable
    // read here would be genuine corruption; readCountRaw throws and we let it
    // propagate to the caller's catch rather than silently resetting to 0.
    const current = readCountRaw(countFilePath);
    const next = fn(current);
    writeCountAtomic(countFilePath, next);
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch (e) {
      void e;
    }
  }
}

// The marker an increment writes when it cannot acquire the lock to perform a
// proper +1. It is deliberately unparseable so the lock-free Stop read throws
// and the Stop hook fails closed (suppresses) rather than dispatching on a
// silently-undercounted value. A subsequent successful increment/decrement
// re-establishes a numeric count under the lock.
const COUNT_FAILCLOSED_MARKER = 'FAIL_CLOSED';

/**
 * Increment the per-session active-subagent count by 1. Atomic RMW under a
 * per-session filesystem lock.
 *
 * Non-fatal to the hook: a failure is logged, never thrown. But an increment
 * must never silently undercount — a dropped +1 lets a later Stop read a
 * too-low count and dispatch mid-fan-out (fail-open). So when the RMW cannot be
 * completed (e.g. the lock budget is exhausted by a genuinely stuck holder), we
 * write a fail-closed marker that makes the lock-free Stop read throw and the
 * Stop hook suppress, rather than leaving a stale low number in place.
 */
export function incrementSubagentCount(sessionId: string, logger?: CountLogger): void {
  const countPath = subagentCountPath(sessionId);
  try {
    withCountLock(countPath, (n) => n + 1);
  } catch (err) {
    logger?.warn('failed to increment subagent count; writing fail-closed marker', { err });
    // Fail closed: an unparseable count suppresses dispatch (see readCountRaw).
    try {
      fs.mkdirSync(nodePath.dirname(countPath), { recursive: true });
      writeCountAtomic(countPath, COUNT_FAILCLOSED_MARKER);
    } catch (err2) {
      logger?.warn('failed to write fail-closed subagent-count marker', { err: err2 });
    }
  }
}

/**
 * Decrement the per-session active-subagent count by 1, flooring at zero.
 * Atomic RMW under a per-session filesystem lock. Best-effort — a failure is
 * logged and swallowed.
 */
export function decrementSubagentCount(sessionId: string, logger?: CountLogger): void {
  try {
    withCountLock(subagentCountPath(sessionId), (n) => Math.max(0, n - 1));
  } catch (err) {
    logger?.warn('failed to decrement subagent count', { err });
  }
}

/**
 * Read the current active-subagent count.
 *
 * Fail-closed contract for the Stop hook: the only state that legitimately means
 * "0 active subagents, dispatch normally" is the count file being **absent**, so
 * absent → 0. Every other ambiguity — an I/O/permission error, an unreadable
 * path, a torn/empty/partial/unparseable file — **throws**, so the caller
 * (stop.ts Step 0.5) suppresses dispatch rather than dispatching on a value it
 * cannot confidently confirm. This deliberately does NOT swallow errors to 0;
 * doing so would make stop.ts's fail-closed catch dead code.
 */
export function readSubagentCount(sessionId: string): number {
  return readCountRaw(subagentCountPath(sessionId));
}

// ---------------------------------------------------------------------------
// Touch kind and anchor formatting
// ---------------------------------------------------------------------------

export type TouchKind = 'read' | 'write' | 'whole-read' | 'whole-write' | 'create';

/**
 * Format a mesh anchor string.
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
