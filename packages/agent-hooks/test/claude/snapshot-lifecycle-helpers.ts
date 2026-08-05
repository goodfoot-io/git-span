/**
 * Shared fixture helpers for the Phase 2 snapshot-lifecycle acceptance checks
 * (card main-213): temp-repo + real-`git span` CLI setup, snapshot record/file
 * builders, a content-hash helper, and the executor/memo fakes the harness
 * lifecycle files drive the touch pipeline with. SDK-specific shapes (hook
 * input builders, logger capture) live in the per-harness lifecycle files that
 * import this module.
 *
 * Everything here compiles against the Phase 1 contract surfaces; the
 * disk-backed store and comparison functions are `Not Implemented` stubs until
 * Phase 3, which is why every consuming test is skipped.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { SnapshotFile, SnapshotRecord } from '../../src/common/snapshot-core.js';
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
// Record / file builders
// ---------------------------------------------------------------------------

/** The SHA-256 hex of a string's bytes — the byte hash the snapshot records. */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** A timestamp in the past that every fixture's clocks are relative to. */
export const BASE_NOW = 1_800_000_000_000;

/** A snapshot file entry; mtimeNs carries a non-zero sub-second part by default. */
export function makeFile(overrides: Partial<SnapshotFile> = {}): SnapshotFile {
  return {
    hash: 'a'.repeat(64),
    size: 11,
    mtimeNs: BigInt(BASE_NOW) * 1_000_000n + 1n,
    capturedAt: BASE_NOW,
    lines: ['line-hash-1', 'line-hash-2'],
    ...overrides
  };
}

export function makeRecord(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    version: 1,
    sessionId: 'sess-lifecycle',
    toolUseId: 'tu-bash-1',
    repoRoot: '/repo',
    createdAt: BASE_NOW,
    consumed: false,
    consumedAt: null,
    tier: 'repo',
    gaps: [],
    files: {},
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
}

/** An executor fake with call counters, mirroring the existing test fakes. */
export function makeExecutors(opts: FakeExecutorOpts = {}): FakeExecutorHandle {
  const calls = { fix: 0, list: 0, drift: 0, why: 0 };
  const driftArgs: string[][] = [];
  const executors: TouchExecutors = {
    fix: async (): Promise<TouchFixResult> => {
      calls.fix += 1;
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
  return { executors, calls, driftArgs };
}
