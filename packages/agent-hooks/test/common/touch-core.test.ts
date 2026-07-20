/**
 * Skipped acceptance checks for touch-core.ts (Phase 2.2 of the TDD bootstrap
 * described in plans/initial.md's Phase 2). Phase 2.1 declared `recoverRange`
 * and `runTouchHook` as not-implemented stubs; this file writes the contract's
 * acceptance checks against those stubs so the eventual Phase 2.3
 * implementation has a fixed target. Every case here is marked `.skip` — none
 * are expected to run (the stubs throw `Not Implemented`); Phase 2.3 unskips
 * them one by one while implementing minimally against each.
 *
 * Fakes are constructed against the real exported types from touch-core.ts
 * (`TouchInput`, `TouchExecutors`, `TouchFixResult`, `PorcelainRow`,
 * `StalePorcelainRow`, `MemoStore`) rather than loosened/`any`-typed shapes —
 * that fidelity is the payoff of the bootstrap: an awkward fake here is a
 * contract-ergonomics finding, not something to work around.
 */

import { describe, expect, it } from 'vitest';
import type { PorcelainRow, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import type { TouchExecutors, TouchFixResult, TouchReadInput, TouchWriteInput } from '../../src/common/touch-core.js';
import { recoverRange, runTouchHook } from '../../src/common/touch-core.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An in-memory MemoStore fake — one Set of surfaced names per session id. */
function createMemoryMemoStore(): MemoStore {
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

const REPO_ROOT = '/repo';
const SESSION_ID = 'session-touch-core-test';

function writeInput(overrides: Partial<TouchWriteInput> = {}): TouchWriteInput {
  return {
    kind: 'write',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/src/app.ts`,
    written: 'export const app = 1;\n',
    ...overrides
  };
}

function readInput(overrides: Partial<TouchReadInput> = {}): TouchReadInput {
  return {
    kind: 'read',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/src/app.ts`,
    ...overrides
  };
}

/** A porcelain row for a span covering the touched file. */
function porcelainRow(overrides: Partial<PorcelainRow> = {}): PorcelainRow {
  return { name: 'billing/checkout-request-flow', path: 'src/app.ts', start: 1, end: 10, ...overrides };
}

/** A stale porcelain row (drift row) for a span covering the touched file. */
function staleRow(overrides: Partial<StalePorcelainRow> = {}): StalePorcelainRow {
  return {
    name: 'billing/checkout-request-flow',
    path: 'src/app.ts',
    start: 1,
    end: 10,
    status: 'CHANGED',
    ...overrides
  };
}

describe('touch-core (Phase 2.2 — skipped acceptance checks)', () => {
  describe('runTouchHook — write path', () => {
    it('heals insertion-only (positional) drift in the tree but surfaces no alert', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: true }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        // Only positional statuses remain after the fix healed the tree —
        // MOVED/RESOLVED_PENDING_COMMIT never constitute debt (isDebt()).
        stale: async (): Promise<StalePorcelainRow[]> => [
          staleRow({ status: 'MOVED' }),
          staleRow({ name: 'other/span', status: 'RESOLVED_PENDING_COMMIT' })
        ]
      };

      const output = await runTouchHook(writeInput(), executors, memo);

      expect(output.treeModified).toBe(true);
      expect(output.additionalContext).toBeNull();
    });

    it('surfaces the merged directive for semantic drift exactly once per span per status in a session', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED' })]
      };
      const input = writeInput();

      const first = await runTouchHook(input, executors, memo);
      expect(first.additionalContext).not.toBeNull();
      expect(first.additionalContext).toContain('billing/checkout-request-flow');

      // Same span, same status, same session (same MemoStore instance) — the
      // directive must not repeat.
      const second = await runTouchHook(input, executors, memo);
      expect(second.additionalContext).toBeNull();
    });
  });

  describe('runTouchHook — read path', () => {
    it('never invokes the fix executor and never reports the tree as modified', async () => {
      const memo = createMemoryMemoStore();
      let fixCalls = 0;
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          fixCalls += 1;
          return { modified: true };
        },
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED' })]
      };

      const output = await runTouchHook(readInput(), executors, memo);

      expect(fixCalls).toBe(0);
      expect(output.treeModified).toBe(false);
    });

    it('filters positional statuses out of the read-path hint, surfacing nothing when drift is positional-only', async () => {
      const memo = createMemoryMemoStore();
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => ({ modified: false }),
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [
          staleRow({ status: 'MOVED' }),
          staleRow({ name: 'other/span', status: 'RESOLVED_PENDING_COMMIT' })
        ]
      };

      const output = await runTouchHook(readInput(), executors, memo);

      expect(output.additionalContext).toBeNull();
      expect(output.treeModified).toBe(false);
    });
  });

  describe('runTouchHook — fail-open behavior', () => {
    it('returns a null/unmodified output rather than throwing when an executor rejects (CLI/.span absent)', async () => {
      const memo = createMemoryMemoStore();
      // A rejected promise is how an injected executor expresses the CLI's
      // non-zero-exit / absent-binary contract (see
      // notes/cli-and-harness-contracts.md's exit-code table) — the executor
      // wraps a real subprocess call in production, so a thrown/rejected
      // failure is the natural fake for "the CLI could not run".
      const executors: TouchExecutors = {
        fix: async (): Promise<TouchFixResult> => {
          throw new Error('spawn git ENOENT');
        },
        list: async (): Promise<PorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        },
        stale: async (): Promise<StalePorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        }
      };

      const output = await runTouchHook(writeInput(), executors, memo);

      expect(output.additionalContext).toBeNull();
      expect(output.treeModified).toBe(false);
    });
  });

  describe('recoverRange', () => {
    it("degrades to 'whole-file' when the written block is absent from onDiskContent", () => {
      const written = 'const totally = "missing";\n';
      const onDiskContent = ['line one', 'line two', 'line three'].join('\n');

      expect(recoverRange(written, onDiskContent)).toBe('whole-file');
    });

    it("degrades to 'whole-file' when the written block is duplicated and cannot be disambiguated", () => {
      const written = 'duplicate\n';
      const onDiskContent = ['duplicate', 'middle', 'duplicate', 'tail'].join('\n');

      expect(recoverRange(written, onDiskContent)).toBe('whole-file');
    });

    it('recovers the correct 1-based inclusive LineRange for an unambiguous written block', () => {
      const written = ['beta', 'gamma'].join('\n');
      const onDiskContent = ['alpha', 'beta', 'gamma', 'delta'].join('\n');

      expect(recoverRange(written, onDiskContent)).toEqual({ start: 2, end: 3 });
    });
  });
});
