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
 * The full `git span drift --format porcelain` status token vocabulary (the
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

/** A `parseDriftPorcelain` row: a {@link PorcelainRow} plus its status token. */
export interface DriftPorcelainRow extends PorcelainRow {
  status: PorcelainStatus;
}

/**
 * The debt invariant (system-wide; consumed by both the future touch-core and
 * advisor-core): only semantic statuses are debt. `CHANGED` and `DELETED` are
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
 * `git span drift --format porcelain` output today. Until the CLI exposes it,
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
 * Lowercase human label for a porcelain status token (`LFS_NOT_FETCHED` →
 * `lfs not fetched`). The single label mapping for every human-format anchor
 * suffix — both the touch hook's block and the advisor's messages render through
 * this, so a status never reads differently between the two.
 */
export function humanStatusLabel(status: PorcelainStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
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
 * the advisor must treat them differently from *semantic* drift (`CHANGED`,
 * `DELETED`). Semantic drift is fixable by editing a span, so the advisor fails
 * closed on it; an environmental condition is not something a span edit can
 * resolve, so the advisor fails OPEN on it (allow, but surface the condition) —
 * re-denying forever on an infra failure the user cannot clear from here would
 * contradict the fail-open contract the rest of the advisor already honors for
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
 * `git span drift --format porcelain` emits a different shape than
 * `list --porcelain`: a `# porcelain v2` header, `# fuzzy N` comment lines,
 * and one `<status>\t<src>\t<name>\t<path>\t<start>\t<end>` row per drifted
 * anchor (whole-file anchors carry `(whole)`/`-` in place of the line columns).
 * Rows whose status token is not in {@link PORCELAIN_STATUSES} are skipped —
 * an unrecognized token from a newer CLI is treated the same as a malformed
 * line rather than guessed at.
 */
export function parseDriftPorcelain(stdout: string): DriftPorcelainRow[] {
  const rows: DriftPorcelainRow[] = [];
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
// Per-session directory layout
// ---------------------------------------------------------------------------

/** The `snapshots/` subdirectory of a session dir, holding the store's state. */
const SNAPSHOTS_DIR = 'snapshots';

/** Suffix marking a consumed call's tombstone beside its record file. */
const TOMBSTONE_SUFFIX = '.tombstone.json';

/** Suffix of a call's private GIT_OBJECT_DIRECTORY. */
const OBJECT_DIR_SUFFIX = '.objects';

/** Suffix of a call's private temp GIT_INDEX_FILE. */
const TEMP_INDEX_SUFFIX = '.index';

/** Suffix of a record file. Note `.tombstone.json` ends with it too. */
const RECORD_SUFFIX = '.json';

/** The four artifacts one captured call owns, all named off a shared stem. */
export interface SessionCallFiles {
  record: string;
  tombstone: string;
  objectDir: string;
  tempIndexFile: string;
}

/**
 * Every session-scoped path, derived from one base directory.
 *
 * The base is a value the caller supplies rather than a module constant, so a
 * test can point a hook at a scratch directory the same way production points
 * it at `~/.cache/git-span/session` — see {@link DEFAULT_SESSION_LAYOUT}. The
 * layout is the single owner of the on-disk naming vocabulary: nothing outside
 * it may concatenate a session path or a file suffix, or the two would drift
 * apart.
 */
export interface SessionLayout {
  /** Base dir holding one subdirectory per session, keyed by sanitized id. */
  readonly base: string;
  /**
   * Where pruned session dirs wait out their TTL — a *sibling* of the base on
   * the same filesystem, deliberately outside it so no sweep or session
   * enumeration ever reads trashed state.
   */
  readonly trashDir: string;
  /** The per-session state directory for a given session id. */
  dir(sessionId: string): string;
  /** The session's snapshot-store directory. */
  snapshotsDir(sessionId: string): string;
  /** The record file for one captured call. */
  recordFile(sessionId: string, toolUseId: string): string;
  /**
   * One call's private GIT_OBJECT_DIRECTORY, shared by the call's pre and post
   * write-trees (the post side's unchanged blobs are already local) and read
   * by later siblings' on-demand hash derivations. Lives next to the record
   * file so the sweep and session cleanup remove the pair together.
   */
  objectDir(sessionId: string, toolUseId: string): string;
  /** One call's private temp GIT_INDEX_FILE, primed from the real index per capture. */
  tempIndexFile(sessionId: string, toolUseId: string): string;
  /** The consumption tombstone beside a call's record. */
  tombstoneFile(sessionId: string, toolUseId: string): string;
  /** The touch-hook session memo (span-surface.ts's MemoStore). */
  memoFile(sessionId: string): string;
  /** The once-per-session marker gating the recordless fallback note. */
  recordlessNoteFile(sessionId: string): string;
  /** Whether a name in a snapshots dir is a tombstone. */
  isTombstoneName(name: string): boolean;
  /** Whether a name in a snapshots dir is a record (a tombstone is not one). */
  isRecordName(name: string): boolean;
  /**
   * The shared stem of a call's four artifacts, from any one of their file
   * names; null when the name belongs to none of them. The sweep and the
   * foreign-record reap derive sibling paths from a `readdir` name rather than
   * from a payload's (untrustworthy) fields, and must not re-spell the
   * suffixes to do it.
   */
  callStem(name: string): string | null;
  /** The four artifact paths for a stem inside an already-resolved snapshots dir. */
  callFiles(snapshotsDir: string, stem: string): SessionCallFiles;
}

/**
 * Build a {@link SessionLayout} over `base`. Creates nothing on disk — every
 * member is pure path derivation, so the default can be a module constant.
 */
export function createSessionLayout(base: string): SessionLayout {
  const dir = (sessionId: string): string => nodePath.join(base, sanitizeSessionId(sessionId));
  // NOTE: snapshotsDir sanitizes via dir() even when its caller passes an
  // already-sanitized directory name back in (reposFromRecords, runSweep).
  // sanitizeSessionId is *not* idempotent ('%' -> '%25'), so that second pass
  // is what fixes the set of directories the sweep reaches. Do not "tidy" it:
  // dropping it would silently widen the sweep's reach.
  const snapshotsDir = (sessionId: string): string => nodePath.join(dir(sessionId), SNAPSHOTS_DIR);
  const callFile = (sessionId: string, toolUseId: string, suffix: string): string =>
    nodePath.join(snapshotsDir(sessionId), `${sanitizeSessionId(toolUseId)}${suffix}`);
  const isTombstoneName = (name: string): boolean => name.endsWith(TOMBSTONE_SUFFIX);
  return Object.freeze({
    base,
    trashDir: nodePath.join(nodePath.dirname(base), 'session-trash'),
    dir,
    snapshotsDir,
    recordFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, RECORD_SUFFIX),
    objectDir: (sessionId, toolUseId) => callFile(sessionId, toolUseId, OBJECT_DIR_SUFFIX),
    tempIndexFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, TEMP_INDEX_SUFFIX),
    tombstoneFile: (sessionId, toolUseId) => callFile(sessionId, toolUseId, TOMBSTONE_SUFFIX),
    memoFile: (sessionId) => nodePath.join(dir(sessionId), 'touch-memo.json'),
    recordlessNoteFile: (sessionId) => nodePath.join(dir(sessionId), 'snapshot-recordless-note'),
    isTombstoneName,
    isRecordName: (name) => name.endsWith(RECORD_SUFFIX) && !isTombstoneName(name),
    callStem: (name) => {
      // Tombstone first: `.tombstone.json` also ends with the record suffix.
      for (const suffix of [TOMBSTONE_SUFFIX, RECORD_SUFFIX, OBJECT_DIR_SUFFIX, TEMP_INDEX_SUFFIX]) {
        if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
      }
      return null;
    },
    callFiles: (snapshots, stem) => ({
      record: nodePath.join(snapshots, `${stem}${RECORD_SUFFIX}`),
      tombstone: nodePath.join(snapshots, `${stem}${TOMBSTONE_SUFFIX}`),
      objectDir: nodePath.join(snapshots, `${stem}${OBJECT_DIR_SUFFIX}`),
      tempIndexFile: nodePath.join(snapshots, `${stem}${TEMP_INDEX_SUFFIX}`)
    })
  } satisfies SessionLayout);
}

/**
 * The production layout: `~/.cache/git-span/session`. Every hook entrypoint
 * defaults to it, so a deployed hook's on-disk behavior is what it was before
 * the base became injectable.
 */
export const DEFAULT_SESSION_LAYOUT: SessionLayout = createSessionLayout(
  nodePath.join(os.homedir(), '.cache', 'git-span', 'session')
);

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Retention for pruned session dirs, mirroring the snapshot store's
 * `TRASH_TTL_MS` discipline: a pruned dir is renamed away (an atomic same-fs
 * rename — never an in-place recursive unlink) and the unlink happens only
 * once the rename mtime aged past this, long after any hook-process read of
 * the dir's files closed. 60s of keepalive is far longer than any synchronous
 * read holds an fd.
 */
const SESSION_TRASH_TTL_MS = 60_000;

const SESSION_TRASH_MARKER = '.trash-session-';

/**
 * Opportunistically prune per-session state directories under `layout.base`
 * whose mtime is older than `maxAgeMs` (default 30
 * days). A directory's mtime advances whenever an entry inside it is
 * created/renamed/removed, so an active session (memo writes) stays fresh;
 * only genuinely abandoned sessions age out.
 *
 * A pruned directory is renamed to `layout.trashDir`, never unlinked
 * in place: an in-place recursive `rmSync` can abort a concurrent reader of
 * the dir's files (the node-on-virtiofs close-after-unlink assertion the
 * snapshot store's removals guard against — the snapshot sweep reads every
 * session dir on each write, including a 30-day-idle one whose records no
 * sweep has reached since they were written). The trash pass unlinks renamed
 * dirs once their stamped rename mtime aged past
 * {@link SESSION_TRASH_TTL_MS}, long after any reader closed.
 *
 * Best-effort and non-throwing: called opportunistically from hook read/write
 * paths, not a separate cron-like mechanism, so a failure here must never
 * block the caller's actual work.
 */
export function pruneStaleSessions(
  layout: SessionLayout,
  now: number = Date.now(),
  maxAgeMs: number = THIRTY_DAYS_MS
): void {
  // Unlink trashed dirs whose rename mtime aged past the TTL first, so a
  // freshly-renamed dir below is never a candidate in the same call.
  try {
    for (const entry of fs.readdirSync(layout.trashDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes(SESSION_TRASH_MARKER)) continue;
      const trashPath = nodePath.join(layout.trashDir, entry.name);
      // Vanished between readdir and stat (a concurrent prune's unlink), or
      // removal failed — skip it. A best-effort prune must never throw into
      // the caller's hot path.
      try {
        const stat = fs.statSync(trashPath);
        if (now - stat.mtimeMs > SESSION_TRASH_TTL_MS) {
          fs.rmSync(trashPath, { recursive: true, force: true });
        }
      } catch (err) {
        void err;
      }
    }
  } catch (err) {
    // Trash root absent or unreadable — nothing to unlink.
    void err;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(layout.base, { withFileTypes: true });
  } catch {
    return; // base dir absent or unreadable — nothing to prune
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = nodePath.join(layout.base, entry.name);
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.mkdirSync(layout.trashDir, { recursive: true, mode: 0o700 });
        const trashPath = nodePath.join(
          layout.trashDir,
          `${entry.name}${SESSION_TRASH_MARKER}${process.pid}-${Date.now().toString(36)}`
        );
        fs.renameSync(dirPath, trashPath);
        // A rename preserves the dir's mtime (the 30-day-old one); stamp the
        // rename instant so the trash TTL is genuinely measured from the
        // rename — otherwise the next call's trash pass would unlink it
        // moments later, under a reader that may still hold an fd.
        fs.utimesSync(trashPath, now / 1000, now / 1000);
      }
    } catch (err) {
      // Vanished between readdir and stat, or the rename/stamp failed (a
      // concurrent prune won the race, or EXDEV against an unusual mount) —
      // skip it; a failed rename retains the dir (retention over removal). A
      // best-effort prune must never throw into the caller's hot path.
      void err;
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
 * Directory for the advisor's per-changeset state memos (digest of sorted
 * findings + uncovered paths), under the git common dir so it is shared
 * across worktrees.
 */
export function advisorMemoDir(repoRoot: string): string {
  return nodePath.join(queueRoot(repoRoot), 'advisor');
}

// ---------------------------------------------------------------------------
// Block body formatting
// ---------------------------------------------------------------------------

/**
 * Indent every non-empty line of `text` by two spaces, leaving blank lines
 * blank — the body shape the `<git-span-error>` blocks use so a multi-line
 * diagnostic reads as one delimited artifact. Blank lines must stay blank:
 * two-space-only lines would read as trailing whitespace.
 */
export function indentBlockBody(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n');
}
