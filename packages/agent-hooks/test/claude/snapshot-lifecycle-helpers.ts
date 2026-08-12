/**
 * Shared fixture helpers for the Phase 2 snapshot-lifecycle acceptance checks
 * (card main-213): temp-repo + real-`git span` CLI setup, the v2 snapshot
 * record builder, a content-hash helper, and the executor/memo fakes the harness
 * lifecycle files drive the touch pipeline with. SDK-specific shapes (hook
 * input builders, logger capture) live in the per-harness lifecycle files that
 * import this module.
 *
 * Since Phase 3 the store and comparison functions are real, so these helpers
 * also partition the fixture session ids per consuming file: the claude and
 * codex lifecycle files each purge only the ids they own, between cases that
 * would otherwise see one another's records through the base-wide sweep. The
 * two files now hold *separate* per-run layouts on /tmp, so the partition is
 * no longer what keeps them apart across files — it is what keeps a file's own
 * cases from leaking into each other.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DriftPorcelainRow, PorcelainRow, SessionLayout } from '../../src/common/agent-hooks-common.js';
import type { SnapshotRecord } from '../../src/common/snapshot-core.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult } from '../../src/common/touch-core.js';

// ---------------------------------------------------------------------------
// Span constants
// ---------------------------------------------------------------------------

export const SPAN_A = 'billing/checkout-request-flow';
export const SPAN_B = 'billing/payment-created-flow';
export const WHY = 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';

// ---------------------------------------------------------------------------
// Real-repo + real-CLI setup (mirrors test/common/porcelain-contract.test.ts)
// ---------------------------------------------------------------------------

export interface TestRepo {
  root: string;
  cleanup: () => void;
}

/** Initialise a git repo with identity configured, for committed spans. */
export function createTestRepo(): TestRepo {
  const root = mkdtempSync(join(tmpdir(), 'agent-hooks-snapshot-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@test.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false'], { stdio: 'ignore' });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

/**
 * Strictly increasing, always-in-the-past mtimes for fixture writes.
 *
 * git calls an index entry "racily clean" when the file's mtime is not older
 * than the index's own, and then falls back to the entry's recorded size to
 * decide whether the content moved — a fallback that is blind to any rewrite
 * of identical byte length. Several fixtures here simulate a tool's edit with
 * exactly that: a reorder or an equal-length substitution. When the baseline
 * `git add` and the rewrite land in one mtime tick, `write-tree` reuses the
 * stale blob, so the post tree equals the pre tree and the window closes
 * having attributed nothing — with no warning to say why, because nothing
 * failed. Serialized files left enough wall time between the two steps to
 * hide it; running files in parallel made the collision reachable about one
 * run in ten.
 *
 * Stamping every write an hour back, one second apart, removes the ambiguity
 * from both directions: each rewrite is strictly newer than the entry git
 * recorded for it, so the stat cache always reports the change, and every
 * mtime stays comfortably older than the index, so no entry is ever treated
 * as racy in the first place. Future stamps would do the opposite — they make
 * *every* entry look racy and put the size fallback permanently in charge.
 */
const WRITE_EPOCH = Date.now() - 3_600_000;
let writeTick = 0;

export function writeFile(repoRoot: string, relPath: string, content: string): void {
  const full = join(repoRoot, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  writeTick += 1;
  const stamp = new Date(WRITE_EPOCH + writeTick * 1000);
  utimesSync(full, stamp, stamp);
}

export function gitAddCommit(repoRoot: string, msg: string): void {
  execFileSync('git', ['-C', repoRoot, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, 'commit', '-m', msg], { stdio: 'ignore' });
}

export function addSpan(repoRoot: string, name: string, anchor: string): void {
  execFileSync('git', ['span', 'add', name, anchor], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  execFileSync('git', ['span', 'why', name, `span ${name}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
}

// ---------------------------------------------------------------------------
// Shared-session-base cleanup
// ---------------------------------------------------------------------------

/**
 * Session ids owned by the claude lifecycle fixture file. Snapshot records
 * and consumption tombstones persist in the shared per-session base
 * (`~/.cache/git-span/session/<sanitized-id>`) for `recordTtlMs` (24h) after
 * consumption, so re-running these fixtures against the real store would
 * otherwise find a stale tombstone for a previously consumed
 * (session, tool_use_id) and fail every call closed. The ids are unique per
 * test and never shared across tests, so purging a fixture's own dirs before
 * and after a run is always safe.
 *
 * The partition matters: the claude and codex lifecycle files run in
 * parallel forks sharing the base, so a purge must cover only the ids the
 * calling file owns — a union purge from one file would delete the other
 * file's live records mid-test.
 */
export const CLAUDE_SESSION_IDS: readonly string[] = [
  'sess-a',
  'sess-b',
  'sess-edit',
  'sess-interleave-bashfirst',
  'sess-interleave-neverflag',
  'sess-interleave-prefail',
  'sess-interleave-nulldelete',
  'sess-interleave-race',
  'sess-interleave-ttlprune',
  'sess-interleave-unfinished',
  'sess-interleave-walktail',
  'sess-interleave-walktail-unequal',
  'sess-lifecycle',
  'sess-lifecycle-absent',
  'sess-lifecycle-budget',
  'sess-lifecycle-costfloor',
  'sess-lifecycle-defer',
  'sess-lifecycle-delete',
  'sess-lifecycle-dirty',
  'sess-lifecycle-dirty2',
  'sess-lifecycle-duplicate',
  'sess-lifecycle-end',
  'sess-lifecycle-failure-interrupt',
  'sess-lifecycle-failure-nointerrupt',
  'sess-lifecycle-failure-none',
  'sess-lifecycle-failure-norecord',
  'sess-lifecycle-failure-plain',
  'sess-lifecycle-norecord',
  'sess-lifecycle-norecord-opaque',
  'sess-lifecycle-orphan',
  'sess-lifecycle-formatter',
  'sess-lifecycle-generated',
  'sess-lifecycle-pre-readonly',
  'sess-lifecycle-pre-record',
  'sess-lifecycle-rename',
  'sess-lifecycle-script',
  'sess-lifecycle-ttl-edit',
  'sess-lifecycle-ttl-live',
  'sess-lifecycle-ttl-old',
  'sess-lifecycle-capcut',
  'sess-lifecycle-binary',
  'sess-lifecycle-partialbudget',
  'sess-lifecycle-repoless',
  'sess-lifecycle-hasherr',
  'sess-lifecycle-hasherr-orphan',
  'sess-lifecycle-v1sib',
  'sess-lifecycle-v1sib-old'
];

/**
 * Session ids owned by the codex lifecycle fixture file — disjoint from
 * `CLAUDE_SESSION_IDS`, so each file's purge never touches the other's live
 * records while they run in parallel forks. (`sess-a`/`sess-b` sit on the
 * claude side; both files use them only in in-memory ambiguity-rule tests
 * that never reach the disk store.)
 */
export const CODEX_SESSION_IDS: readonly string[] = [
  'sess-codex',
  'sess-codex-applypatch',
  'sess-codex-defer',
  'sess-codex-delete',
  'sess-codex-dirty',
  'sess-codex-duplicate',
  'sess-codex-failed',
  'sess-codex-formatter',
  'sess-codex-interleave-bashfirst',
  'sess-codex-interleave-neverflag',
  'sess-codex-interleave-unfinished',
  'sess-codex-later',
  'sess-codex-norecord',
  'sess-codex-orphan',
  'sess-codex-pre-envelope',
  'sess-codex-pre-readonly',
  'sess-codex-pre-record',
  'sess-codex-race',
  'sess-codex-rename',
  'sess-codex-stop',
  'sess-codex-subagent',
  'sess-codex-ttl',
  'sess-codex-capcut',
  'sess-codex-binary',
  'sess-codex-partialbudget',
  'sess-codex-workdir',
  'sess-codex-repoless'
];

let trashCounter = 0;

/**
 * Remove the given sessions' per-session state dirs (records, tombstones,
 * memos) from the layout's base *without unlinking live files*: each existing
 * dir is renamed atomically into the layout's trash root, a sibling of the
 * base that no sweep (which scans only the base itself) ever reads.
 *
 * A plain recursive rmSync would unlink record files while a store's
 * write-time sweep is mid-`readFileSync` on them, and Node aborts
 * (uv_fs_close assertion) on a close-after-unlink on this fs. The rename
 * leaves every inode in place, so a concurrent reader's open/close still
 * succeeds; later opens of the original path fail ENOENT, which the store
 * treats as an ordinary miss.
 *
 * The trash root no longer needs a `process.pid` suffix to stay this worker's
 * own: the layout's base sits inside a per-run mkdtemp'd parent, so the
 * sibling trash root is per-run by construction.
 */
export function purgeSessions(layout: SessionLayout, ids: readonly string[]): void {
  mkdirSync(layout.trashDir, { recursive: true });
  for (const sid of ids) {
    const dir = layout.dir(sid);
    if (!existsSync(dir)) continue;
    renameSync(dir, join(layout.trashDir, `${basename(dir)}-${trashCounter}`));
    trashCounter += 1;
  }
}

/**
 * Empty the layout's trash root. Safe in afterAll: nothing ever reads the
 * trash (it sits outside the base), so unlinking it races no sweep — and the
 * path is inside this run's own temp parent, so it can never reach another
 * run's state.
 */
export function flushPurgedSessions(layout: SessionLayout): void {
  rmSync(layout.trashDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Record / file builders
// ---------------------------------------------------------------------------

/** The SHA-256 hex of a string's bytes — the byte hash the snapshot records. */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** A timestamp in the past that every fixture's clocks are relative to. */
export const BASE_NOW = 1_800_000_000_000;

export function makeRecord(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    version: 2,
    sessionId: 'sess-lifecycle',
    toolUseId: 'tu-bash-1',
    repoRoot: '/repo',
    createdAt: BASE_NOW,
    consumed: false,
    consumedAt: null,
    treeSha: 'a'.repeat(40),
    gaps: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Touch pipeline fakes
// ---------------------------------------------------------------------------

/** An in-memory MemoStore fake — one Set of surfaced names per session id. */
export function createMemoryMemoStore(): MemoStore {
  const bySession = new Map<string, Set<string>>();
  return {
    getSurfaced(sessionId: string): Set<string> {
      return new Set(bySession.get(sessionId) ?? []);
    },
    addSurfaced(sessionId: string, names: string[]): void {
      const existing = bySession.get(sessionId) ?? new Set<string>();
      for (const n of names) existing.add(n);
      bySession.set(sessionId, existing);
    }
  };
}

export function porcelainRow(overrides: Partial<PorcelainRow> = {}): PorcelainRow {
  return { name: SPAN_A, path: 'src/app.ts', start: 1, end: 10, ...overrides };
}

export function driftRow(overrides: Partial<DriftPorcelainRow> = {}): DriftPorcelainRow {
  return {
    name: SPAN_A,
    path: 'src/app.ts',
    start: 1,
    end: 10,
    status: 'CHANGED',
    ...overrides
  };
}

export interface FakeExecutorOpts {
  /** Rows per requested file path; defaults to a single row for any path. */
  rows?: (filePath: string) => PorcelainRow[];
  /** Drift rows per requested args; defaults to a single CHANGED row. */
  drift?: (args: string[]) => DriftPorcelainRow[];
  fixModified?: boolean;
}

export interface FakeExecutorHandle {
  executors: TouchExecutors;
  calls: { fix: number; list: number; drift: number; why: number };
  driftArgs: string[][];
  /** The per-call filePath arguments to fix (one fix per attributed scope). */
  fixPaths: string[];
}

/** An executor fake with call counters, mirroring the existing test fakes. */
export function makeExecutors(opts: FakeExecutorOpts = {}): FakeExecutorHandle {
  const calls = { fix: 0, list: 0, drift: 0, why: 0 };
  const driftArgs: string[][] = [];
  const fixPaths: string[] = [];
  const executors: TouchExecutors = {
    fix: async (filePath: string): Promise<TouchFixResult> => {
      calls.fix += 1;
      fixPaths.push(filePath);
      return { modified: opts.fixModified ?? false };
    },
    list: async (filePath: string): Promise<PorcelainRow[]> => {
      calls.list += 1;
      return opts.rows ? opts.rows(filePath) : [porcelainRow()];
    },
    drift: async (args: string[]): Promise<DriftPorcelainRow[]> => {
      calls.drift += 1;
      driftArgs.push(args);
      return opts.drift ? opts.drift(args) : [driftRow()];
    },
    why: async (): Promise<string | null> => {
      calls.why += 1;
      return WHY;
    }
  };
  return { executors, calls, driftArgs, fixPaths };
}
