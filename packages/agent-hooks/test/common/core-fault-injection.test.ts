/**
 * Fault-injection checks for the core-layer failure-logging contract
 * (CARD main-349).
 *
 * Fail-open is the contract at every layer, but before main-349 an internal
 * defect vanished without a trace: `evaluateAdvisor`'s outer catch resolved
 * any non-advisor error to `{allow, silent}` with no logger available at all,
 * `runTouchHooks` swallowed render errors with a bare `catch {}`, and the
 * structured Read/Edit/Write path discarded `batch.diagnostics` entirely.
 *
 * These checks inject defects at the cores (a TypeError thrown mid-body, a
 * memo whose surface bookkeeping explodes, a context executor that fails) and
 * pin the replacement contract: warn-level records land on the threaded core
 * logger with useful detail, while every documented fail-open path — mapped
 * advisor errors, clean allows, successful batches — stays quiet.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AdvisorExecutors,
  type AdvisorMemoState,
  AdvisorScanError,
  evaluateAdvisor
} from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { CoreLogger, MemoStore } from '../../src/common/span-surface.js';
import { runTouchHook, runTouchHooks, type TouchExecutors, type TouchInput } from '../../src/common/touch-core.js';
import { makeTempRepo } from '../helpers.js';
import { contextExecutors, type SurfaceFake } from '../touch-context-fake.js';

/** A {@link CoreLogger} recording every warn record for assertions. */
function recordingLogger(): CoreLogger & { warns: Array<{ message: string; context?: Record<string, unknown> }> } {
  const warns: Array<{ message: string; context?: Record<string, unknown> }> = [];
  return {
    warns,
    warn: (message, context) => {
      warns.push({ message, context });
    }
  };
}

// ---------------------------------------------------------------------------
// Advisor fakes (mirroring advisor-deadline.test.ts's conventions)
// ---------------------------------------------------------------------------

function memoryMemoState(): AdvisorMemoState {
  const seen = new Set<string>();
  return {
    has: (digest) => seen.has(digest),
    record: (digest) => {
      seen.add(digest);
      return true;
    }
  };
}

function baseAdvisorExecutors(): AdvisorExecutors {
  return {
    fix: async () => undefined,
    drift: async () => [] as DriftPorcelainRow[],
    list: async () => [],
    listBlocks: async () => ''
  };
}

describe('evaluateAdvisor fault injection (main-349)', () => {
  it('warns through the threaded logger when a non-advisor error fails open', async () => {
    const logger = recordingLogger();
    const defect = new TypeError('core defect: cannot read properties of undefined (reading "map")');
    const executors: AdvisorExecutors = {
      ...baseAdvisorExecutors(),
      // A programming defect surfaces as an arbitrary throw, not a mapped
      // advisor error — exactly what the final fail-open branch exists for.
      drift: async () => {
        throw defect;
      }
    };

    const result = await evaluateAdvisor(
      ['src/a.ts', 'src/b.ts'],
      '/repo',
      executors,
      memoryMemoState(),
      'may-hold',
      undefined,
      'generic',
      undefined,
      logger
    );

    // Fail-open behavior is unchanged…
    expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    // …and the defect leaves a warn-level breadcrumb carrying the error.
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]?.message).toContain('failed open on an unexpected error');
    expect(logger.warns[0]?.context).toMatchObject({ err: defect });
  });

  it('stays quiet on the documented scan-failed fail-open path', async () => {
    const logger = recordingLogger();
    const executors: AdvisorExecutors = {
      ...baseAdvisorExecutors(),
      drift: async () => {
        throw new AdvisorScanError('exit 1: fatal: not a git repository');
      }
    };

    const result = await evaluateAdvisor(
      ['src/a.ts', 'src/b.ts'],
      '/repo',
      executors,
      memoryMemoState(),
      'may-hold',
      undefined,
      'generic',
      undefined,
      logger
    );

    expect(result).toMatchObject({ decision: 'allow', kind: 'scan-failed' });
    expect(logger.warns).toHaveLength(0);
  });

  it('stays quiet on normal allow and hold paths', async () => {
    const logger = recordingLogger();
    const silent = await evaluateAdvisor(
      ['src/app.ts'],
      '/repo',
      baseAdvisorExecutors(),
      memoryMemoState(),
      'may-hold',
      undefined,
      'generic',
      undefined,
      logger
    );
    expect(silent).toEqual({ decision: 'allow', kind: 'silent' });

    // Two uncovered paths hold once; still zero warnings — a hold is the
    // documented happy path, not a defect.
    const held = await evaluateAdvisor(
      ['src/a.ts', 'src/b.ts'],
      '/repo',
      baseAdvisorExecutors(),
      memoryMemoState(),
      'may-hold',
      undefined,
      'generic',
      undefined,
      logger
    );
    expect(held.decision).toBe('hold');
    expect(held.kind).toBe('uncovered-writes');
    expect(logger.warns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Touch-core fakes
// ---------------------------------------------------------------------------

const SESSION_ID = 'session-fault-injection';

function readInput(repoRoot: string): TouchInput {
  return {
    kind: 'read',
    sessionId: SESSION_ID,
    cwd: repoRoot,
    filePath: join(repoRoot, 'app.ts'),
    invocationId: `${SESSION_ID}:test-event`
  };
}

function coveredSpanRow(): PorcelainRow {
  return { name: 'billing/checkout-request-flow', path: 'app.ts', start: 1, end: 10 };
}

function driftedRow(): DriftPorcelainRow {
  return { name: 'billing/checkout-request-flow', path: 'app.ts', start: 1, end: 10, status: 'CHANGED' };
}

function surfaceFake(opts: { list?: PorcelainRow[]; drift?: DriftPorcelainRow[] } = {}): SurfaceFake {
  return {
    fix: async () => ({ modified: false }),
    list: async () => opts.list ?? [],
    drift: async () => opts.drift ?? [],
    why: async () => 'Checkout request flow that carries a charge attempt.'
  };
}

describe('runTouchHooks / runTouchHook fault injection (main-349)', () => {
  let repo: { root: string; cleanup: () => void };
  beforeAll(() => {
    repo = makeTempRepo();
    // The prepare step resolves the repo root from disk, so the touched file
    // must exist under a real repository.
    writeFileSync(join(repo.root, 'app.ts'), 'export const app = 1;\n');
  });
  afterAll(() => repo.cleanup());

  it('warns with the file and error when a render defect is swallowed per touch', async () => {
    const logger = recordingLogger();
    // A span covering the file with semantic drift makes the renderer build
    // sections; the injected memo defect then explodes inside renderContextTouch.
    const executors = contextExecutors(surfaceFake({ list: [coveredSpanRow()], drift: [driftedRow()] }));
    const defect = new TypeError('core defect: surfaced.set is not a function');
    const memo: MemoStore = {
      getSurfaced: () => new Set<string>(),
      addSurfaced: () => {
        throw defect;
      }
    };

    const batch = await runTouchHooks(
      [readInput(repo.root)],
      executors,
      memo,
      `${SESSION_ID}:batch`,
      undefined,
      logger
    );

    // Fail-open per touch: no output, no throw…
    expect(batch.outputs).toHaveLength(1);
    expect(batch.outputs[0]?.additionalContext).toBeNull();
    // …and the swallow leaves a warn-level breadcrumb naming the file and error.
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]?.message).toContain('touch render failed open');
    expect(logger.warns[0]?.context).toMatchObject({ filePath: join(repo.root, 'app.ts'), err: defect });
  });

  it('stays quiet on a normal batch that renders output', async () => {
    const logger = recordingLogger();
    const executors = contextExecutors(surfaceFake({ list: [coveredSpanRow()], drift: [driftedRow()] }));
    const memo: MemoStore = {
      getSurfaced: () => new Set<string>(),
      addSurfaced: () => undefined
    };

    const batch = await runTouchHooks(
      [readInput(repo.root)],
      executors,
      memo,
      `${SESSION_ID}:quiet`,
      undefined,
      logger
    );

    expect(batch.outputs[0]?.additionalContext).toContain('billing/checkout-request-flow');
    expect(batch.diagnostics.failure).toBeNull();
    expect(logger.warns).toHaveLength(0);
  });

  it('surfaces a non-null diagnostics.failure on the structured single-touch path', async () => {
    const logger = recordingLogger();
    // The production degradation this pins: the context subprocess is broken
    // (nonzero exit), the structured path renders nothing, and the only trace
    // would be the discarded diagnostics field.
    const executors: TouchExecutors = {
      context: async () => ({ ok: false as const, failure: 'nonzero_exit' as const, elapsedMs: 1 })
    };

    const output = await runTouchHook(
      readInput(repo.root),
      executors,
      {
        getSurfaced: () => new Set<string>(),
        addSurfaced: () => undefined
      },
      undefined,
      logger
    );

    expect(output.additionalContext).toBeNull();
    expect(logger.warns).toHaveLength(1);
    expect(logger.warns[0]?.message).toContain('structured touch context failed');
    expect(logger.warns[0]?.context).toMatchObject({
      filePath: join(repo.root, 'app.ts'),
      failure: 'nonzero_exit'
    });
  });

  it('stays quiet when the structured context query succeeds', async () => {
    const logger = recordingLogger();
    const executors = contextExecutors(surfaceFake());

    const output = await runTouchHook(
      readInput(repo.root),
      executors,
      {
        getSurfaced: () => new Set<string>(),
        addSurfaced: () => undefined
      },
      undefined,
      logger
    );

    expect(output.additionalContext).toBeNull(); // no spans cover the file — a clean no-op
    expect(logger.warns).toHaveLength(0);
  });
});
