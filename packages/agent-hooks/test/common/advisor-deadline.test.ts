/**
 * The overall evaluation deadline (CARD main-339).
 *
 * Registration sets `timeout: 10_000` on every advisor hook while each spawned
 * subprocess carries its own 10s budget — and evaluation is strictly sequential
 * (fix → drift → list → listBlocks → changedHunks plus the per-file fallback),
 * so per-spawn timeouts do not bound the pipeline they compose. A slow or hung
 * child used to be able to spend minutes against a 10-second parent window,
 * after which the harness kills the hook: commits stall, and even the
 * scan-failed advisory is lost with only whatever the host logs.
 *
 * These checks pin the contract that replaced that failure mode: evaluation
 * races an overall deadline and resolves allow-with-warning (`scan-failed` /
 * `'deadline-exceeded'`) when the budget expires first — fail-open end to end,
 * with no new executor work started and outstanding subprocess work aborted,
 * and with the losing side of the race never surfacing an unhandled rejection.
 * Delays are injected through fakes (and one real sleeping subprocess), so the
 * assertions are wall-clock facts about the race, not mocks of it.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdvisorExecutors,
  type AdvisorMemoState,
  createDefaultAdvisorExecutors,
  evaluateAdvisor
} from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow } from '../../src/common/agent-hooks-common.js';

/** An in-memory {@link AdvisorMemoState} that records every call for assertions. */
function memoryMemoState(): AdvisorMemoState & { records: string[] } {
  const seen = new Set<string>();
  const records: string[] = [];
  return {
    records,
    has: (digest) => seen.has(digest),
    record: (digest) => {
      seen.add(digest);
      records.push(digest);
      return true;
    }
  };
}

/** Fakes whose every method captures the `signal` it was handed, for scope assertions. */
interface SignalCapture {
  signals: AbortSignal[];
}

function capturingExecutors(): AdvisorExecutors & SignalCapture {
  const signals: AbortSignal[] = [];
  return {
    signals,
    fix: async (_paths, _cwd, signal) => {
      signals.push(signal ?? new AbortController().signal);
    },
    drift: async () => [] as DriftPorcelainRow[],
    list: async () => [],
    listBlocks: async () => ''
  };
}

describe('advisor overall deadline', () => {
  it('resolves allow-with-warning under budget when an executor hangs, spending no hold credit', async () => {
    const memo = memoryMemoState();
    // The hung executor stands in for any slow-or-hung child (`git span drift`
    // wedged on a network filesystem, say): evaluation must not wait it out.
    const executors: AdvisorExecutors = {
      ...capturingExecutors(),
      drift: () => new Promise<never>(() => {})
    };
    const started = Date.now();
    const result = await evaluateAdvisor(
      ['a.ts', 'b.ts'],
      '/repo',
      executors,
      memo,
      'may-hold',
      undefined,
      'generic',
      100
    );
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ decision: 'allow', kind: 'scan-failed' });
    expect(result).toHaveProperty('cause', 'deadline-exceeded');
    // Advisory-or-warning, never silence: the reason says what happened and
    // keeps the "NOT verified" honesty the other scan failures carry.
    const reason = (result as { reason: string }).reason;
    expect(reason).toContain('NOT verified');
    expect(reason).toContain('100 ms');
    // Total advisor wall time stayed under the injected budget (plus generous
    // scheduler slop) — and therefore far under every adapter's registered
    // 10_000 ms hook window, which is the invariant this card exists for.
    expect(elapsed).toBeLessThan(5_000);
    // The deadline path fails open WITHOUT memoizing: no debt state was
    // verified, so no hold credit may be consumed — a retry after the slowness
    // clears gets its full one-time hold.
    expect(memo.records).toEqual([]);
  }, 15_000);

  it('aborts the executor signal and starts no new executor work once expired', async () => {
    const memo = memoryMemoState();
    const capture = capturingExecutors();
    const drift = vi.fn(async () => [] as DriftPorcelainRow[]);
    const list = vi.fn(async () => []);
    const listBlocks = vi.fn(async () => '');
    const executors: AdvisorExecutors = {
      // Hangs: expiry lands mid-executor, and the signal it received must be
      // observed aborted once the answer is out.
      fix: (_paths, _cwd, signal) => {
        capture.signals.push(signal ?? new AbortController().signal);
        return new Promise<never>(() => {});
      },
      drift,
      list,
      listBlocks
    };

    const result = await evaluateAdvisor(
      ['a.ts', 'b.ts'],
      '/repo',
      executors,
      memo,
      'may-hold',
      undefined,
      'generic',
      80
    );

    expect(result).toMatchObject({ decision: 'allow', kind: 'scan-failed', cause: 'deadline-exceeded' });
    // The cancellation path is real: the executor received the evaluation's
    // signal, and it is aborted by the time the answer is returned — a
    // production implementation uses exactly this to kill its child process.
    expect(capture.signals.length).toBeGreaterThan(0);
    for (const signal of capture.signals) expect(signal.aborted).toBe(true);
    // No downstream executor was invoked after expiry: the sequential pipeline
    // stops instead of orphaning further spawns into the post-answer void.
    expect(drift).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(listBlocks).not.toHaveBeenCalled();
  }, 15_000);

  it('never surfaces an unhandled rejection from the losing side of the race', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const memo = memoryMemoState();
      let rejectLate: ((err: unknown) => void) | null = null;
      const executors: AdvisorExecutors = {
        ...capturingExecutors(),
        // Loses the race two ways at once: hangs past the deadline, then
        // rejects afterwards — the exact shape that would crash a naive race.
        drift: () =>
          new Promise<DriftPorcelainRow[]>((_, reject) => {
            rejectLate = reject;
          })
      };

      const settled = evaluateAdvisor(['a.ts', 'b.ts'], '/repo', executors, memo, 'may-hold', undefined, 'generic', 60);
      const result = await settled;
      expect(result).toMatchObject({ decision: 'allow', kind: 'scan-failed', cause: 'deadline-exceeded' });

      // Now reject the loser long after the race settled.
      setTimeout(() => rejectLate?.(new Error('late loser boom')), 150);
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(unhandled).toEqual([]);
      // And the answer was already out: the late rejection changed nothing.
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 15_000);

  it('leaves the fast path untouched: normal latency returns the ordinary verdict', async () => {
    const memo = memoryMemoState();
    const drifted: DriftPorcelainRow[] = [
      { name: 'billing/checkout-request-flow', path: 'src/app.ts', start: 1, end: 10, status: 'CHANGED' }
    ];
    const executors: AdvisorExecutors = {
      fix: async () => {},
      drift: async () => drifted,
      list: async () => [],
      listBlocks: async () => ''
    };
    const started = Date.now();
    // Generous budget: the race must be invisible to an evaluation that fits.
    const result = await evaluateAdvisor(
      ['src/app.ts', 'src/other.ts'],
      '/repo',
      executors,
      memo,
      'may-hold',
      undefined,
      'generic',
      8_000
    );
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ decision: 'hold', kind: 'semantic-drift', findings: drifted });
    // The rendered checklist is the ordinary one — no deadline wording leaked in.
    const reason = (result as { reason: string }).reason;
    expect(reason).toContain('## billing/checkout-request-flow');
    expect(reason).not.toContain('NOT verified');
    // No artificial latency: fast evaluations do not pay for the deadline.
    expect(elapsed).toBeLessThan(1_000);
    // The hold credit was spent normally — the deadline path is not involved.
    expect(memo.records.length).toBeGreaterThan(0);
  }, 15_000);

  describe('cancellation kills a real in-flight subprocess', () => {
    interface Harness {
      root: string;
      cleanup: () => void;
    }

    /**
     * A repo plus a `git-span` shim that answers `--version` and otherwise
     * sleeps far longer than any assertion — the hung child the deadline must
     * be able to kill, not merely abandon. Same PATH-shim pattern as the
     * version-skew suite: the executors inherit the ambient environment
     * deliberately, so prepending a shim directory stands in for the binary.
     */
    function makeSleepingHarness(): Harness {
      const root = mkdtempSync(nodePath.join(tmpdir(), 'advisor-deadline-'));
      execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
      execFileSync('git', ['-C', root, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
      execFileSync('git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
      fs.writeFileSync(nodePath.join(root, 'f.txt'), 'one\ntwo\n');

      const binDir = nodePath.join(root, '.shim-bin');
      fs.mkdirSync(binDir);
      const shimPath = nodePath.join(binDir, 'git-span');
      fs.writeFileSync(
        shimPath,
        [
          '#!/bin/sh',
          'if [ "$1" = "--version" ]; then',
          '  echo "git-span 1.0.142"',
          '  exit 0',
          'fi',
          'sleep 30',
          'exit 1'
        ].join('\n'),
        { mode: 0o755 }
      );
      const previousPath = process.env.PATH;
      process.env.PATH = `${binDir}${nodePath.delimiter}${previousPath ?? ''}`;
      return {
        root,
        cleanup: () => {
          process.env.PATH = previousPath;
          rmSync(root, { recursive: true, force: true });
        }
      };
    }

    let harness: Harness | null = null;

    afterEach(() => {
      harness?.cleanup();
      harness = null;
    });

    it('the production drift executor stops waiting when its signal aborts', async () => {
      harness = makeSleepingHarness();
      const executors = createDefaultAdvisorExecutors(60_000); // per-spawn timeout deliberately huge
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 150);

      const started = Date.now();
      // Resolves (collapsed empty — reporting expiry is the deadline race's
      // job, not the executor's) only because the abort killed the child.
      await expect(executors.drift(['f.txt'], harness.root, controller.signal)).resolves.toEqual([]);
      const elapsed = Date.now() - started;

      // Killed at the abort (~150ms), not at the 30s sleep or the 60s spawn
      // timeout — this is what makes the raced deadline enforceable in wall
      // clock rather than leaving an orphaned child behind the answer.
      expect(elapsed).toBeLessThan(5_000);
    }, 20_000);
  });

  it('documents the shipped budget: 8s under the registered 10s hook window', async () => {
    const { EVALUATION_DEADLINE_MS } = await import('../../src/common/advisor-core.js');
    expect(EVALUATION_DEADLINE_MS).toBe(8_000);
    expect(EVALUATION_DEADLINE_MS).toBeLessThan(10_000);
  });

  it('uses the default budget when a caller passes none', async () => {
    const memo = memoryMemoState();
    const executors: AdvisorExecutors = {
      ...capturingExecutors(),
      drift: () => new Promise<never>(() => {})
    };
    // No deadline argument: the shipped EVALUATION_DEADLINE_MS applies. Fake
    // timers fast-forward past it instantly — proving the default cannot
    // regress to an unbounded wait without this suite noticing.
    vi.useFakeTimers();
    try {
      const settled = evaluateAdvisor(['a.ts', 'b.ts'], '/repo', executors, memo);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await settled).toMatchObject({ decision: 'allow', kind: 'scan-failed', cause: 'deadline-exceeded' });
    } finally {
      vi.useRealTimers();
    }
  }, 12_000);

  beforeEach(() => {
    vi.restoreAllMocks();
  });
});
