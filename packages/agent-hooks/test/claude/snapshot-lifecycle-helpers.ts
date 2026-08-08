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
 * codex lifecycle files run in parallel forks over the shared session base,
 * and each file must purge only the ids it owns.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  type DriftPorcelainRow,
  type PorcelainRow,
  SESSION_BASE_DIR,
  sessionDir
} from '../../src/common/agent-hooks-common.js';
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

export function writeFile(repoRoot: string, relPath: string, content: string): void {
  const full = join(repoRoot, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
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

/**
 * This worker's trash root: a sibling of the shared session base, so no
 * sweep (which only scans the base itself) ever reads what lands here.
 */
const TRASH_ROOT = join(dirname(SESSION_BASE_DIR), `session-trash-${process.pid}`);

let trashCounter = 0;

/**
 * Remove the given sessions' per-session state dirs (records, tombstones,
 * memos) from the shared base *without unlinking live files*: each existing
 * dir is renamed atomically into this worker's trash root.
 *
 * A plain recursive rmSync would unlink record files while other workers'
 * write-time sweeps are mid-`readFileSync` on them, and Node aborts
 * (uv_fs_close assertion) on a close-after-unlink on this fs. The rename
 * leaves every inode in place, so a concurrent reader's open/close still
 * succeeds; later opens of the original path fail ENOENT, which the store
 * treats as an ordinary miss.
 */
export function purgeSessions(ids: readonly string[]): void {
  mkdirSync(TRASH_ROOT, { recursive: true });
  for (const sid of ids) {
    const dir = sessionDir(sid);
    if (!existsSync(dir)) continue;
    renameSync(dir, join(TRASH_ROOT, `${basename(dir)}-${trashCounter}`));
    trashCounter += 1;
  }
}

/**
 * Empty this worker's trash root. Safe in afterAll: nothing ever reads the
 * trash (it sits outside the base), so unlinking it races no sweep. Stale
 * trash roots from crashed runs belong to other pids and are left alone —
 * deleting another worker's trash mid-run would be the cross-process write
 * this rename scheme exists to avoid.
 */
export function flushPurgedSessions(): void {
  rmSync(TRASH_ROOT, { recursive: true, force: true });
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
