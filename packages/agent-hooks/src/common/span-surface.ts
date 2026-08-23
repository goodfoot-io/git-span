/**
 * Harness-agnostic span-surfacing core.
 *
 * Given an already-resolved repo-relative path and a line range, this module
 * runs the shared `git span list --porcelain` / `.hookignore` / session-memo /
 * `git span drift` pipeline and assembles the human-readable `<git-span>…</git-span>`
 * block that both adapters surface inline before an edit. It imports nothing
 * from either hook SDK: the Claude PreToolUse hook feeds it a range derived from
 * `file_path`/`offset`/`old_string`; the Codex PreToolUse hook feeds it the
 * ranges recovered from an `apply_patch` envelope. Each adapter wraps the
 * returned block string in its own SDK output builder.
 *
 * The executor/drift/memo dependencies are injected so the pipeline is testable
 * with fakes exactly like the porcelain parsers in the shared kernel.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import {
  isGitIgnored,
  isInsideSpanRoot,
  type LineRange,
  type PorcelainRow,
  parseDriftPorcelain,
  parsePorcelain,
  pruneStaleSessionsThrottled,
  rangesIntersect,
  relativeToRepo,
  resolveRepoRoot,
  resolveSpanRoot,
  type SessionLayout,
  toPosix
} from './agent-hooks-common.js';
import { type HookIgnoreLoader, isSpanSuppressed } from './span-ignore.js';

/**
 * Minimal logger surface the `common/` layer logs through; both SDK loggers
 * satisfy it. `warn` is required — every existing call site reports a failure.
 * `info` is optional so a fake carrying only `warn` still satisfies the
 * interface: it exists for the diagnostic breadcrumbs a *successful* run leaves
 * behind (advisor-core's churn-suppression count), which are not warnings and
 * must not read as failures in the hook log.
 */
export interface CoreLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
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
 * Runs `git span drift --format porcelain <slugs>` and returns its porcelain stdout —
 * one row per *drifted* anchor among the given spans, empty when all are clean.
 * `git span drift` exits 0 in porcelain mode whether or not drift exists, but we
 * still capture stdout from a thrown error so a drift signal is never lost to a
 * non-zero exit. Throws only when no stdout is available (genuine failure).
 */
export type DriftExecutor = (slugs: string[], cwd: string) => string;

export function createDefaultDriftExecutor(timeoutMs = 10_000): DriftExecutor {
  return (slugs, cwd) => {
    try {
      return execFileSync('git', ['span', 'drift', '--format', 'porcelain', ...slugs], {
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
  /**
   * Record `names` as surfaced, merging into `known` — the set the caller
   * read via {@link getSurfaced} earlier in the same pipeline. The caller's
   * read is authoritative: implementations must write the merge without
   * re-reading the memo, so one rendered block costs one read (the caller's)
   * and one write. Requiring the parameter keeps that freshness contract a
   * type error to bypass.
   */
  addSurfaced(sessionId: string, names: string[], known: ReadonlySet<string>): void;
}

export type MemoLogger = CoreLogger;

/**
 * The disk-backed memo, under the per-session state directory the caller's
 * {@link SessionLayout} names (agent-hooks-common.ts) — relocated from
 * os.tmpdir()/agent-hooks-git-span/ so per-session state has one home and is
 * covered by pruneStaleSessions's opportunistic >30-day pruning.
 */
export function createDiskMemoStore(logger: MemoLogger, layout: SessionLayout): MemoStore {
  return {
    getSurfaced(sessionId) {
      pruneStaleSessionsThrottled(layout);
      try {
        const raw = fs.readFileSync(layout.memoFile(sessionId), 'utf8');
        const parsed = JSON.parse(raw) as { surfaced?: unknown };
        if (Array.isArray(parsed.surfaced)) {
          return new Set(parsed.surfaced as string[]);
        }
      } catch (err) {
        logger.warn('memo read failed (treating as empty)', { err });
      }
      return new Set();
    },
    addSurfaced(sessionId, names, known) {
      // The caller's just-read set is authoritative — merging into it instead
      // of re-reading keeps one surface pipeline at one memo read (the
      // caller's) and one write. The read-modify-write window this opens is
      // the gap between the caller's getSurfaced and here: adjacent statements
      // in the live render pipeline.
      const existing = new Set(known);
      for (const n of names) existing.add(n);
      const memoDir = layout.dir(sessionId);
      const memoPath = layout.memoFile(sessionId);
      const tmpPath = `${memoPath}.tmp`;
      try {
        // The memo and plan stores can each create the shared session dir
        // first, so both enforce the same restrictive mode.
        fs.mkdirSync(memoDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(tmpPath, JSON.stringify({ surfaced: [...existing] }), 'utf8');
        fs.renameSync(tmpPath, memoPath);
      } catch (err) {
        logger.warn('memo write failed', { err });
      }
    }
  };
}

/** Factory function that creates a MemoStore given a logger and a layout. */
export type MemoFactory = (logger: MemoLogger, layout: SessionLayout) => MemoStore;

// ---------------------------------------------------------------------------
// Touch scope resolution (repo-scoping + gitignore + span-root guards)
// ---------------------------------------------------------------------------

export interface TouchScope {
  repoRoot: string;
  repoRelPath: string;
}

/**
 * Bound a touched file to the CWD repo. Resolve the repo root of the current
 * working directory and require the touched file to resolve to the SAME repo
 * root; drop files in a different repository/worktree, gitignored files, and
 * files under the span root. Returns the resolved `{ repoRoot, repoRelPath }`
 * or null when the touch is out of scope.
 *
 * Comparing resolved `git --show-toplevel` toplevels (not path prefixes)
 * distinguishes separate repos and worktrees and is robust to symlinks. Fail
 * closed: if the CWD repo can't be resolved, the touch is dropped rather than
 * falling back to the file's own repo.
 */
export function resolveTouchScope(cwd: string, absPath: string): TouchScope | null {
  const cwdRepoRoot = cwd ? resolveRepoRoot(cwd) : null;
  if (!cwdRepoRoot) return null;

  const absDir = toPosix(nodePath.dirname(absPath));
  const fileRepoRoot = resolveRepoRoot(absDir);
  if (fileRepoRoot !== cwdRepoRoot) return null;

  const repoRoot = cwdRepoRoot;
  const repoRelPath = relativeToRepo(repoRoot, absPath);

  // Skip gitignored files entirely. Build output, caches, and logs are not
  // span-relevant: they must never surface span overlaps.
  if (isGitIgnored(repoRoot, repoRelPath)) return null;

  // Skip span documents entirely. Files under the resolved span root are managed
  // by git span itself and are not application sources that need span coverage.
  const spanRoot = resolveSpanRoot(repoRoot);
  if (isInsideSpanRoot(repoRelPath, spanRoot)) return null;

  return { repoRoot, repoRelPath };
}

// ---------------------------------------------------------------------------
// Surface routine
// ---------------------------------------------------------------------------

/** Injected dependencies for {@link surfaceOverlappingSpans}. */
export interface SurfaceDeps {
  executor: SpanExecutor;
  driftExecutor: DriftExecutor;
  memo: MemoStore;
  loadRules: HookIgnoreLoader;
  logger: CoreLogger;
}

/**
 * Given a repo-relative path and the line range being touched within an
 * already-resolved repo, produce the `<git-span>…</git-span>` block for the
 * spans overlapping that range, or null when there is nothing to surface.
 *
 * The pipeline: `git span list <path> --porcelain` → keep line-ranged anchors on
 * the same file that intersect the range and are not `.hookignore`-suppressed →
 * drop slugs already surfaced this session (memo) → render `git span list
 * <names…>` → append a `git span history <name>` pointer for any already-drifted
 * span. On success the surfaced names are recorded in the memo. Executor and
 * drift-probe failures are logged and degrade to null / the plain block; they
 * never throw.
 */
export function surfaceOverlappingSpans(
  deps: SurfaceDeps,
  repoRoot: string,
  repoRelPath: string,
  range: LineRange,
  sessionId: string
): string | null {
  const { executor, driftExecutor, memo, loadRules, logger } = deps;

  // Filter pass: git span list <path> --porcelain
  let porcelainStdout: string;
  try {
    porcelainStdout = executor(['--porcelain', repoRelPath], repoRoot);
  } catch (err) {
    logger.warn('git span list --porcelain failed', { err });
    return null;
  }

  // Path-scoped suppression: a repo's .span/.hookignore can hold back span slug
  // prefixes for anchors under given paths. A suppressed span is never surfaced.
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
    logger.warn('git span list (render) failed', { err });
    return null;
  }

  // Of the spans being surfaced, flag any already drifted — the touched lines have
  // drifted from their anchored state — with a `git span history <name>` pointer.
  // Detection is as-of-now (surfacing runs before the edit applies), so this
  // catches pre-existing drift; drift this session causes is the Stop hook's job.
  // Failure to compute drift is non-fatal: fall back to the plain block.
  let driftHint = '';
  try {
    const driftNames = new Set(parseDriftPorcelain(driftExecutor(toSurface, repoRoot)).map((r) => r.name));
    const driftSurfaced = toSurface.filter((n) => driftNames.has(n));
    if (driftSurfaced.length > 0) {
      const lines = driftSurfaced.map((n) => `  git span history ${n}`).join('\n');
      driftHint = `\nDrift — the lines you're touching have drifted from these spans' anchored state. Review how each subsystem evolved before changing it:\n${lines}`;
    }
  } catch (err) {
    logger.warn('git span drift (history hint) failed', { err });
  }

  const wrapped = `\n<git-span>\n${renderStdout}${driftHint}\n</git-span>\n`;

  // Update memo — `surfaced` was read above, before the render and drift
  // probes; recording merges into it rather than re-reading.
  memo.addSurfaced(sessionId, toSurface, surfaced);

  return wrapped;
}
