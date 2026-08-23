/**
 * Tests for the OpenCode session lifecycle split (plan decision 8):
 * `session.idle` is a turn boundary — it prunes ONLY call-scoped state
 * (stashed reports, patch plans, shell cwd frames, pending bash planned-touch
 * records) and never the surfaced-span memo on disk; `session.deleted` runs
 * the full cleanup; `dispose()` backstops every tracked session. Also covers
 * the call-state stash's consume-on-read semantics and the assembled plugin's
 * `shell.env` guard against immortal `''`-keyed cwd frames.
 */

import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdvisorExecutors, AdvisorMemoState, GitExecutor } from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import { createDefaultPlannedTouchStore } from '../../src/common/bash-attribution.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { assemblePlugin } from '../../src/opencode/index.js';
import { createDisposeHandler, createEventHandler } from '../../src/opencode/session.js';
import type { OpencodeCallState, PatchPlanTouch } from '../../src/opencode/stash.js';
import { createOpencodeCallState } from '../../src/opencode/stash.js';
import { makeTempLayout } from '../session-layout-helpers.js';

const SPAN = 'billing/checkout-request-flow';

function fakeGit(): GitExecutor {
  return {
    stagedPaths: async () => ['src/app.ts'],
    trackedModifiedPaths: async () => [],
    outgoingPaths: async () => ({ paths: [], base: '@{u}' }),
    pathspecPaths: async () => [],
    changedHunks: async () => []
  };
}

/** An executor pair whose advisory always resolves to an environmental report kind. */
function environmentalExecutors(): AdvisorExecutors {
  return {
    fix: async () => {},
    list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
    drift: async (): Promise<DriftPorcelainRow[]> => [driftRow('LFS_NOT_FETCHED')],
    listBlocks: async (): Promise<string> => ''
  };
}

function sharedMemoFactory(): (cwd: string) => AdvisorMemoState {
  const digests = new Set<string>();
  const state: AdvisorMemoState = {
    has: (d) => digests.has(d),
    record: (d) => {
      digests.add(d);
      return true;
    }
  };
  return () => state;
}

function porcelainRow(path = 'src/app.ts'): PorcelainRow {
  return { name: SPAN, path, start: 1, end: 10 };
}
function driftRow(status: DriftPorcelainRow['status'], path = 'src/app.ts'): DriftPorcelainRow {
  return { name: SPAN, path, start: 1, end: 10, status };
}

function silentLogger() {
  return { warn: () => undefined };
}

const { captured } = vi.hoisted(() => ({
  captured: { last: null as OpencodeCallState | null }
}));

/** Hold a reference to each stash the assembled plugin creates internally. */
vi.mock('../../src/opencode/stash.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/opencode/stash.js')>();
  return {
    ...actual,
    createOpencodeCallState: (...args: Parameters<typeof actual.createOpencodeCallState>) => {
      const state = actual.createOpencodeCallState(...args);
      captured.last = state;
      return state;
    }
  };
});

describe('opencode call state (stash)', () => {
  it('report blocks and patch plans consume-on-read', () => {
    const stash = createOpencodeCallState();
    stash.stashReport('s', 'c1', '<git-span>preview</git-span>');
    expect(stash.takeReport('s', 'c1')).toBe('<git-span>preview</git-span>');
    expect(stash.takeReport('s', 'c1')).toBeNull();

    stash.stashPatchPlan('s', 'c2', [
      { absolutePath: '/r/f.ts', operation: 'modify', ranges: [{ start: 1, end: 2 }], preTrackedDelete: false }
    ]);
    expect(stash.takePatchPlan('s', 'c2')).toHaveLength(1);
    expect(stash.takePatchPlan('s', 'c2')).toBeNull();
  });

  it('shell cwd frames are keyed per call and readable until pruned', () => {
    const stash = createOpencodeCallState();
    stash.trackShellCwd('s', 'c1', '/repo/sub');
    expect(stash.peekShellCwd('s', 'c1')).toBe('/repo/sub');
    expect(stash.peekShellCwd('s', 'other')).toBeNull();
  });

  it('pruneSession drops that session only; clear drops everything', () => {
    const stash = createOpencodeCallState();
    stash.stashReport('s1', 'c', 'one');
    stash.stashReport('s2', 'c', 'two');
    stash.trackPlannedCall('s1', 'p1');
    stash.pruneSession('s1');
    expect(stash.takeReport('s1', 'c')).toBeNull();
    expect(stash.plannedCalls('s1')).toEqual([]);
    expect(stash.takeReport('s2', 'c')).toBe('two');
    stash.clear();
    expect(stash.takeReport('s2', 'c')).toBeNull();
  });

  it('every ingress refuses empty session or call ids — nothing enters the unprunable keyspace', () => {
    // Decision 8 scopes pruning to real sessionIDs (session.ts early-returns
    // on empty), so a ''-keyed entry would be immortal — the same reason the
    // shell.env handler refuses degraded ids. The guard is symmetric across
    // every ingress of the stash itself.
    const stash = createOpencodeCallState();
    const plan: PatchPlanTouch[] = [
      { absolutePath: '/r/f.ts', operation: 'modify', ranges: [{ start: 1, end: 2 }], preTrackedDelete: false }
    ];

    stash.stashReport('', 'c', 'ghost-report');
    stash.stashReport('s', '', 'ghost-report');
    expect(stash.takeReport('', 'c')).toBeNull();
    expect(stash.takeReport('s', '')).toBeNull();

    stash.stashPatchPlan('', 'c', plan);
    stash.stashPatchPlan('s', '', plan);
    expect(stash.takePatchPlan('', 'c')).toBeNull();
    expect(stash.takePatchPlan('s', '')).toBeNull();

    stash.trackShellCwd('', 'c', '/ghost-frame');
    stash.trackShellCwd('s', '', '/ghost-frame');
    expect(stash.peekShellCwd('', 'c')).toBeNull();
    expect(stash.peekShellCwd('s', '')).toBeNull();

    stash.trackPlannedCall('', 'c');
    stash.trackPlannedCall('s', '');
    expect(stash.plannedCalls('')).toEqual([]);
    expect(stash.plannedCalls('s')).toEqual([]);

    // Real keys are unaffected by the refusals.
    stash.stashReport('s', 'c', 'kept');
    expect(stash.takeReport('s', 'c')).toBe('kept');
  });
});

describe('opencode lifecycle split (decision 8)', () => {
  it('idle preserves the surfaced-span memo but prunes stashed reports and pending bash plans', async () => {
    const temp = makeTempLayout();
    try {
      const logger = silentLogger();
      const memo = createDiskMemoStore(logger, temp.layout);
      memo.addSurfaced('sess', ['billing/checkout-request-flow']);
      const store = createDefaultPlannedTouchStore(temp.layout);
      store.put({
        version: 1,
        sessionId: 'sess',
        toolUseId: 'call-9',
        repoRoot: '/repo',
        createdAtMs: Date.now(),
        touches: []
      });

      const sessions = new Set(['sess']);
      const callState = createOpencodeCallState();
      callState.stashReport('sess', 'call-8', '<git-span>status preview</git-span>');
      callState.trackPlannedCall('sess', 'call-9');

      const event = createEventHandler({
        layout: temp.layout,
        logger,
        sessions,
        pruneSession: (sessionId) => callState.pruneSession(sessionId),
        plannedCalls: (sessionId) => callState.plannedCalls(sessionId),
        forgetSession: (sessionId) => callState.pruneSession(sessionId)
      });
      await event({ event: { type: 'session.idle', properties: { sessionID: 'sess' } } });

      // The turn boundary must NOT touch the surfaced-span memo…
      expect([...memo.getSurfaced('sess')]).toEqual(['billing/checkout-request-flow']);
      // …but the report stash is gone…
      expect(callState.takeReport('sess', 'call-8')).toBeNull();
      // …and the pending bash plan record was discarded.
      expect(store.take('sess', 'call-9').status).not.toBe('record');
    } finally {
      temp.cleanup();
    }
  });

  it('session.deleted runs the full disk sweep; unknown events are ignored', async () => {
    const temp = makeTempLayout();
    try {
      const memo = createDiskMemoStore(silentLogger(), temp.layout);
      memo.addSurfaced('gone', ['a-span']);
      const memoFile = temp.layout.memoFile('gone');
      expect(existsSync(memoFile)).toBe(true);

      const sessions = new Set(['gone']);
      const callState = createOpencodeCallState();
      callState.stashReport('gone', 'c', 'x');
      const event = createEventHandler({
        layout: temp.layout,
        logger: silentLogger(),
        sessions,
        pruneSession: (sessionId) => callState.pruneSession(sessionId),
        plannedCalls: () => [],
        forgetSession: (sessionId) => callState.pruneSession(sessionId)
      });
      await event({ event: { type: 'session.idle', properties: {} } });
      await event({ event: { type: 'unrelated.event', properties: { sessionID: 'gone' } } });
      await event({ event: { type: 'session.deleted', properties: { sessionID: 'gone' } } });

      expect(existsSync(memoFile)).toBe(false);
      expect(sessions.has('gone')).toBe(false);
      // Garbage events never reject.
      await event({});
      await expect(event(undefined as never)).resolves.toBeUndefined();
    } finally {
      temp.cleanup();
    }
  });

  it('dispose sweeps every tracked session', async () => {
    const temp = makeTempLayout();
    try {
      const memoA = createDiskMemoStore(silentLogger(), temp.layout);
      memoA.addSurfaced('a', ['span-a']);
      const memoB = createDiskMemoStore(silentLogger(), temp.layout);
      memoB.addSurfaced('b', ['span-b']);
      const sessions = new Set(['a', 'b']);
      const callState = createOpencodeCallState();

      const dispose = createDisposeHandler({
        layout: temp.layout,
        logger: silentLogger(),
        sessions,
        clearAll: () => callState.clear()
      });
      await dispose();

      expect(existsSync(temp.layout.memoFile('a'))).toBe(false);
      expect(existsSync(temp.layout.memoFile('b'))).toBe(false);
      expect(sessions.size).toBe(0);
    } finally {
      temp.cleanup();
    }
  });
});

describe('opencode plugin shell.env wiring', () => {
  function assembleOverScratch() {
    const temp = makeTempLayout();
    const hooks = assemblePlugin({ directory: '/repo', layout: temp.layout, logger: silentLogger() });
    if (captured.last === null) throw new Error('plugin did not create a call-state stash');
    return { hooks, stash: captured.last, cleanup: () => temp.cleanup() };
  }

  it('a shell.env without sessionID records no cwd frame — an empty key would survive every prune', async () => {
    const { hooks, stash, cleanup } = assembleOverScratch();
    try {
      await hooks['shell.env']!({ callID: 'ghost-call', cwd: '/ghost-frame' }, { env: {} });
      // Decision 8 scopes pruning to real sessionIDs; a ''-keyed frame would
      // sit outside every session.idle/deleted prune's reach forever.
      expect(stash.peekShellCwd('', 'ghost-call')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('a shell.env with sessionID records the frame and idle prunes it at the turn boundary', async () => {
    const { hooks, stash, cleanup } = assembleOverScratch();
    try {
      await hooks['shell.env']!({ sessionID: 'sess', callID: 'real-call', cwd: '/frame' }, { env: {} });
      expect(stash.peekShellCwd('sess', 'real-call')).toBe('/frame');
      await hooks.event!({ event: { type: 'session.idle', properties: { sessionID: 'sess' } } });
      expect(stash.peekShellCwd('sess', 'real-call')).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('opencode plugin — degraded-id composition (empty sessionID, real callID)', () => {
  interface Recording {
    warns: string[];
  }

  /** Assemble the plugin with an advisor that always produces a report-kind advisory. */
  function assembleWithAdvisor() {
    const temp = makeTempLayout();
    const recording: Recording = { warns: [] };
    const logger = {
      warn: (message: string) => {
        recording.warns.push(message);
      },
      info: () => undefined
    };
    const hooks = assemblePlugin({
      directory: '/repo',
      layout: temp.layout,
      logger,
      git: fakeGit(),
      executors: environmentalExecutors(),
      advisorMemoFactory: sharedMemoFactory()
    });
    if (captured.last === null) throw new Error('plugin did not create a call-state stash');
    return { hooks, stash: captured.last, recording, cleanup: () => temp.cleanup() };
  }

  const degradedBefore = {
    tool: 'bash',
    sessionID: '',
    callID: 'ghost-call'
  } as const;
  const degradedAfter = { ...degradedBefore, args: { command: 'git commit -m x' } } as const;
  const successfulBash = { output: '', metadata: { output: '', exit: 0 } };

  it('an advisory under an empty sessionID is never stashed; the paired after hook skips cleanly with no throw and no swallowed-work warn', async () => {
    const { hooks, stash, recording, cleanup } = assembleWithAdvisor();
    try {
      // Before hook: the environmental advisory resolves, but its ingress key
      // is degraded — the stash must refuse it (nothing immortal).
      await hooks['tool.execute.before']!(degradedBefore, { args: degradedAfter.args });
      expect(stash.takeReport('', 'ghost-call')).toBeNull();

      // Paired after hook: resolves cleanly — the touch pipeline is skipped
      // symmetrically instead of throwing on the planned-touch store's
      // ''-keyed take past report consumption. No fail-open warn distinguishes
      // a clean skip from the old consume-then-throw swallow (the advisor's
      // own advisory trace is deliberate logging, not an error).
      const output = { ...successfulBash };
      await expect(hooks['tool.execute.after']!(degradedAfter, output)).resolves.toBeUndefined();
      expect(recording.warns.filter((message) => message.includes('failed open'))).toEqual([]);
      expect(output.output).toBe('');
    } finally {
      cleanup();
    }
  });

  it('a report stashed under a real session survives a degraded after hook and stays prunable', async () => {
    const { hooks, stash, recording, cleanup } = assembleWithAdvisor();
    try {
      // A real before hook stashes under `real-sess`…
      await hooks['tool.execute.before']!(
        { tool: 'bash', sessionID: 'real-sess', callID: 'call-9' },
        { args: { command: 'git commit -m x' } }
      );
      expect(stash.takeReport('real-sess', 'call-9')).not.toBeNull();
      // …re-stash for the degradation scenario (takeReport consumed above).
      stash.stashReport('real-sess', 'call-9', '<git-span>ENV ADVISORY</git-span>');

      // The host then degrades ids between before and after: nothing may
      // throw, and the retained report must stay prunable by the real
      // session's turn boundary — never stranded forever.
      const output = { ...successfulBash };
      await expect(
        hooks['tool.execute.after']!(
          { tool: 'bash', sessionID: '', callID: 'call-9', args: { command: 'git commit -m x' } },
          output
        )
      ).resolves.toBeUndefined();
      expect(recording.warns.filter((message) => message.includes('failed open'))).toEqual([]);
      expect(stash.takeReport('real-sess', 'call-9')).toBe('<git-span>ENV ADVISORY</git-span>');
      await hooks.event!({ event: { type: 'session.idle', properties: { sessionID: 'real-sess' } } });
      expect(stash.takeReport('real-sess', 'call-9')).toBeNull();
    } finally {
      cleanup();
    }
  });
});
