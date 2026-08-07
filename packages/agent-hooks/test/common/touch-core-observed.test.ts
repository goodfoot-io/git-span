/**
 * Skipped acceptance checks for the snapshot-observed path in touch-core (card
 * main-213, Phase 2). Phase 1 declared the `observed` variant of
 * {@link TouchWriteInput} (`ObservedWriteRanges`, the `written` XOR `observed`
 * invariant) and the multi-path scope list of {@link runTouchHook} as contract
 * surfaces; this file writes the Phase 2 checks against those surfaces so the
 * Phase 3 implementation (step 1: touch-core observed ranges) has a fixed
 * target. Every case is marked `.skip` — the snapshot path of `runTouchHook`
 * throws `Not Implemented` in Phase 1 and none of these run; Phase 3 unskips
 * them one by one while implementing minimally against each.
 *
 * The snapshot path's contract, per the plan:
 *
 * - `observed.changed` carries exact post-state 1-based inclusive ranges, so a
 *   snapshot-attributed write scopes like a parsed Edit — the changed lines and
 *   nothing else.
 * - `observed.wholeFile` covers creates, deletes, renames, truncations, and
 *   delete-only hunks — every covering span stays in scope, matching today's
 *   whole-file behavior for an unreadable/absent file.
 * - The `observed` path never reads the touched file from disk:
 *   `recoverRangeFromDisk` is skipped entirely (it exists to locate a *written
 *   body*; the snapshot already knows the ranges).
 * - `written` and `observed` are mutually exclusive — exactly one is set; a
 *   touch carrying both is a contract violation and fails closed, one carrying
 *   neither is scoped file-wide as today.
 * - The scope-list variant batches one tool call's changed paths: one heal
 *   pass across all paths, one repo-wide drift, per-scope surface computation
 *   against the shared session memo, blocks joined.
 *
 * The parse-based read-touch suppression for snapshot-attributed paths is an
 * adapter-level rule (the Bash branches of both post-tool-use handlers) and is
 * covered by the harness lifecycle files; it is not observable from the touch
 * core alone.
 *
 * Fakes are constructed against the real exported types (TouchInput,
 * TouchExecutors, ObservedWriteRanges, ObservedWriteScope, MemoStore) rather
 * than loosened shapes — the fidelity is the point, exactly as in the existing
 * touch-core acceptance checks.
 */

import { describe, expect, it } from 'vitest';
import type { DriftPorcelainRow, LineRange, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { ObservedWriteRanges } from '../../src/common/snapshot-core.js';
import type { MemoStore } from '../../src/common/span-surface.js';
import type {
  ObservedWriteScope,
  TouchExecutors,
  TouchFixResult,
  TouchWriteInput
} from '../../src/common/touch-core.js';
import { runTouchHook } from '../../src/common/touch-core.js';

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
const SESSION_ID = 'session-touch-core-observed';
const SPAN_A = 'billing/checkout-request-flow';
const SPAN_B = 'billing/payment-created-flow';
const WHY = 'Checkout request flow that carries a charge attempt from the browser to the Stripe-backed server.';

function observedRanges(changed: LineRange[], wholeFile = false): ObservedWriteRanges {
  return { changed, wholeFile };
}

function writeInput(overrides: Partial<TouchWriteInput> = {}): TouchWriteInput {
  return {
    kind: 'write',
    sessionId: SESSION_ID,
    cwd: REPO_ROOT,
    filePath: `${REPO_ROOT}/src/app.ts`,
    // The `written` XOR `observed` invariant (header + "fails closed" test):
    // an observed touch carries exactly one — an empty written body here, so
    // `writeInput({ observed })` alone never trips the violation check.
    written: '',
    ...overrides
  };
}

/** A porcelain row for a span covering a touched file. */
function porcelainRow(overrides: Partial<PorcelainRow> = {}): PorcelainRow {
  return { name: SPAN_A, path: 'src/app.ts', start: 1, end: 10, ...overrides };
}

/** A drifted porcelain row for a span covering a touched file. */
function driftRow(overrides: Partial<DriftPorcelainRow> = {}): DriftPorcelainRow {
  return {
    name: SPAN_A,
    path: 'src/app.ts',
    start: 1,
    end: 10,
    status: 'CHANGED',
    ...overrides
  };
}

/** An executor fake with call counters; `list` returns rows per requested file. */
function makeExecutors(
  opts: {
    rows?: (filePath: string) => PorcelainRow[];
    drift?: (args: string[]) => DriftPorcelainRow[];
    fixModified?: boolean;
  } = {}
): {
  executors: TouchExecutors;
  calls: { fix: number; list: number; drift: number; why: number };
  driftArgs: string[][];
  fixPaths: string[];
} {
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

// ---------------------------------------------------------------------------
// Skipped acceptance checks
// ---------------------------------------------------------------------------

describe('touch-core observed write ranges', () => {
  describe('observed ranges scope the touch precisely', () => {
    it('scopes the touch to the exact post-state changed ranges, excluding spans outside them', async () => {
      const memo = createMemoryMemoStore();
      const { executors, calls } = makeExecutors({
        // Two spans on the same file: one inside the observed range, one outside.
        rows: (filePath) =>
          filePath.endsWith('/src/app.ts')
            ? [
                porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 }),
                porcelainRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 2 })
              ]
            : [],
        drift: () => [
          driftRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 }),
          driftRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 2 })
        ]
      });

      const output = await runTouchHook(
        writeInput({ observed: observedRanges([{ start: 3, end: 5 }]) }),
        executors,
        memo
      );

      // The span anchored at lines 1-2 sits outside the observed range and must
      // not surface; the span inside lines 3-5 does. A whole-file touch would
      // have surfaced both.
      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
      expect(output.additionalContext).not.toContain('## billing/payment-created-flow');
      expect(calls.fix).toBe(1); // snapshot-attributed writes are write touches and heal
    });

    it('scopes a wholeFile observed write to every covering span (create/delete/truncate shape)', async () => {
      const memo = createMemoryMemoStore();
      const { executors, calls } = makeExecutors({
        rows: (filePath) =>
          filePath.endsWith('/src/app.ts')
            ? [
                porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 8, end: 10 }),
                porcelainRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 2 })
              ]
            : [],
        drift: () => [
          driftRow({ name: SPAN_A, path: 'src/app.ts', start: 8, end: 10, status: 'DELETED' }),
          driftRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 2, status: 'CHANGED' })
        ]
      });

      // A deletion (or truncation) has no post-state coordinates for the
      // removed lines — the scope degrades to whole-file, matching today's
      // unreadable-file behavior, so the span beyond the new EOF still surfaces.
      const output = await runTouchHook(writeInput({ observed: observedRanges([], true) }), executors, memo);

      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
      expect(output.additionalContext).toContain('## billing/payment-created-flow');
      expect(calls.fix).toBe(1);
    });

    it('renders a delete-only-hunk write as a write touch (drift header names the edit)', async () => {
      const memo = createMemoryMemoStore();
      const { executors } = makeExecutors({
        rows: () => [porcelainRow({ path: 'src/app.ts', start: 1, end: 5 })],
        drift: () => [driftRow({ path: 'src/app.ts', start: 1, end: 5, status: 'CHANGED' })]
      });

      const output = await runTouchHook(writeInput({ observed: observedRanges([], true) }), executors, memo);

      expect(output.additionalContext).toContain('This edit put an implicit dependency out of date:');
      expect(output.additionalContext).toContain('— changed');
    });
  });

  describe('the observed path skips recoverRangeFromDisk', () => {
    it('never reads the touched file: exact ranges survive on a path absent from disk', async () => {
      const memo = createMemoryMemoStore();
      const { executors } = makeExecutors({
        // '/repo/src/app.ts' does not exist on disk. If the touch core had run
        // recoverRangeFromDisk (the `written` path), the unreadable file would
        // degrade the scope to whole-file and the outside span would surface.
        // The observed path needs no file read, so the exact range holds.
        rows: (filePath) =>
          filePath.endsWith('/src/app.ts')
            ? [
                porcelainRow({ name: SPAN_B, path: 'src/app.ts', start: 1, end: 2 }),
                porcelainRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5 })
              ]
            : [],
        drift: () => [driftRow({ name: SPAN_A, path: 'src/app.ts', start: 3, end: 5, status: 'CHANGED' })]
      });

      const output = await runTouchHook(
        writeInput({ observed: observedRanges([{ start: 3, end: 5 }]) }),
        executors,
        memo
      );

      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
      expect(output.additionalContext).not.toContain('## billing/payment-created-flow');
    });
  });

  describe('the written XOR observed invariant', () => {
    it('fails closed when a touch carries both written and observed (contract violation)', async () => {
      const memo = createMemoryMemoStore();
      const { executors } = makeExecutors();

      // Exactly one of `written` / `observed` may be set — a touch with both is
      // a contract violation and must not half-run the static path.
      const input = writeInput({ written: 'not empty', observed: observedRanges([{ start: 1, end: 2 }]) });
      await expect(runTouchHook(input, executors, memo)).rejects.toThrow();
    });

    it('scopes a touch with neither written nor observed file-wide, as today', async () => {
      const memo = createMemoryMemoStore();
      const { executors } = makeExecutors({
        rows: () => [porcelainRow({ path: 'src/app.ts', start: 371, end: 387 })],
        drift: () => []
      });

      const output = await runTouchHook(writeInput({ written: '' }), executors, memo);

      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
    });
  });

  describe('runTouchHook scope list — the multi-path snapshot touch', () => {
    it('batches changed paths: one heal pass across all of them, one repo-wide drift, per-scope list, blocks joined', async () => {
      const memo = createMemoryMemoStore();
      const { executors, calls, driftArgs, fixPaths } = makeExecutors({
        rows: (filePath) =>
          filePath.endsWith('/src/a.ts')
            ? [porcelainRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 })]
            : [porcelainRow({ name: SPAN_B, path: 'src/b.ts', start: 1, end: 5 })],
        drift: () => [
          driftRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 }),
          driftRow({ name: SPAN_B, path: 'src/b.ts', start: 1, end: 5 })
        ],
        fixModified: true
      });
      const scopes: ObservedWriteScope[] = [
        { filePath: `${REPO_ROOT}/src/a.ts`, observed: observedRanges([{ start: 2, end: 3 }]) },
        { filePath: `${REPO_ROOT}/src/b.ts`, observed: observedRanges([{ start: 2, end: 3 }]) }
      ];

      const output = await runTouchHook(writeInput(), executors, memo, undefined, scopes);

      // One scoped fix call per changed path (each is a `git span drift <file>
      // --fix` subprocess pair, so N paths cost ~2N subprocesses — bounded by
      // budgets.maxTouchedFiles = 100, acceptable for a Bash write) and one
      // repo-wide drift. Every changed file's positional debt is healed; a
      // fix that ignored all but the first scope would leave the rest deferred.
      expect(calls.fix).toBe(2);
      expect(fixPaths).toEqual([`${REPO_ROOT}/src/a.ts`, `${REPO_ROOT}/src/b.ts`]);
      expect(calls.drift).toBe(1);
      expect(driftArgs).toEqual([[]]); // repo-wide — no per-scope path args
      expect(calls.list).toBe(2); // per-scope surface computation
      // Both sections live in ONE block under a single header/footer, joined by
      // the `---` separator — not two concatenated hook blocks.
      const block = output.additionalContext ?? '';
      expect(block).toContain('## billing/checkout-request-flow');
      expect(block).toContain('## billing/payment-created-flow');
      expect(block.match(/Restore agreement before committing/g)).toHaveLength(1);
      expect(output.treeModified).toBe(true);
    });

    it('dedupes a span surfaced by two scopes of the same batch through the shared session memo', async () => {
      const memo = createMemoryMemoStore();
      const { executors } = makeExecutors({
        rows: () => [porcelainRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 })],
        drift: () => [driftRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 })]
      });
      const scopes: ObservedWriteScope[] = [
        { filePath: `${REPO_ROOT}/src/a.ts`, observed: observedRanges([{ start: 2, end: 3 }]) },
        { filePath: `${REPO_ROOT}/src/b.ts`, observed: observedRanges([{ start: 2, end: 3 }]) }
      ];

      // Both scopes' spans share the name — the second scope's render is
      // deduped by the memo, so the block carries the span exactly once.
      const output = await runTouchHook(writeInput(), executors, memo, undefined, scopes);
      const block = output.additionalContext ?? '';
      expect(block.match(/## billing\/checkout-request-flow/g)).toHaveLength(1);
    });

    it('joins only the scopes that surfaced something, leaving the rest silent', async () => {
      const memo = createMemoryMemoStore();
      const { executors } = makeExecutors({
        rows: (filePath) =>
          filePath.endsWith('/src/a.ts') ? [porcelainRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 })] : [], // src/b.ts has no covering spans — nothing to surface
        drift: () => [driftRow({ name: SPAN_A, path: 'src/a.ts', start: 1, end: 5 })]
      });
      const scopes: ObservedWriteScope[] = [
        { filePath: `${REPO_ROOT}/src/a.ts`, observed: observedRanges([{ start: 2, end: 3 }]) },
        { filePath: `${REPO_ROOT}/src/b.ts`, observed: observedRanges([{ start: 2, end: 3 }]) }
      ];

      const output = await runTouchHook(writeInput(), executors, memo, undefined, scopes);

      expect(output.additionalContext).toContain('## billing/checkout-request-flow');
      expect(output.additionalContext).not.toContain('## billing/payment-created-flow');
    });

    it('returns null when every scope has nothing to surface', async () => {
      const memo = createMemoryMemoStore();
      const { executors, calls } = makeExecutors({ rows: () => [] });
      const scopes: ObservedWriteScope[] = [
        { filePath: `${REPO_ROOT}/src/a.ts`, observed: observedRanges([{ start: 2, end: 3 }]) }
      ];

      const output = await runTouchHook(writeInput(), executors, memo, undefined, scopes);

      expect(output.additionalContext).toBeNull();
      expect(calls.fix).toBe(1); // the heal pass still ran across the batch
      expect(calls.list).toBe(1);
    });
  });
});
