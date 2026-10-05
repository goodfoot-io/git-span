/**
 * Tests for the OpenCode session lifecycle split (plan decision 8):
 * `session.idle` is a turn boundary — it prunes ONLY call-scoped state
 * (patch plans, shell cwd frames, pending bash planned-touch
 * records) and never the surfaced-span memo on disk; `session.deleted` runs
 * the full cleanup; `dispose()` backstops every tracked session. Also covers
 * the call-state stash's consume-on-read semantics and the assembled plugin's
 * `shell.env` guard against immortal `''`-keyed cwd frames.
 */

import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultPlannedTouchStore } from '../../src/common/bash-attribution.js';
import { createDiskMemoStore } from '../../src/common/span-surface.js';
import { assemblePlugin } from '../../src/opencode/index.js';
import { createDisposeHandler, createEventHandler } from '../../src/opencode/session.js';
import type { OpencodeCallState, PatchPlanTouch } from '../../src/opencode/stash.js';
import { createOpencodeCallState } from '../../src/opencode/stash.js';
import { present } from '../helpers.js';
import { makeTempLayout } from '../session-layout-helpers.js';

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
  it('patch plans consume-on-read', () => {
    const stash = createOpencodeCallState();
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
    stash.trackShellCwd('s1', 'c', '/one');
    stash.trackShellCwd('s2', 'c', '/two');
    stash.trackPlannedCall('s1', 'p1');
    stash.pruneSession('s1');
    expect(stash.peekShellCwd('s1', 'c')).toBeNull();
    expect(stash.plannedCalls('s1')).toEqual([]);
    expect(stash.peekShellCwd('s2', 'c')).toBe('/two');
    stash.clear();
    expect(stash.peekShellCwd('s2', 'c')).toBeNull();
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
    stash.trackShellCwd('s', 'c', '/kept');
    expect(stash.peekShellCwd('s', 'c')).toBe('/kept');
  });
});

describe('opencode lifecycle split (decision 8)', () => {
  it('idle preserves the surfaced-span memo but prunes cwd frames and pending bash plans', async () => {
    const temp = makeTempLayout();
    try {
      const logger = silentLogger();
      const memo = createDiskMemoStore(logger, temp.layout);
      memo.addSurfaced('sess', ['billing/checkout-request-flow'], new Set());
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
      callState.trackShellCwd('sess', 'call-8', '/repo/sub');
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
      // …but the cwd frame is gone…
      expect(callState.peekShellCwd('sess', 'call-8')).toBeNull();
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
      memo.addSurfaced('gone', ['a-span'], new Set());
      const memoFile = temp.layout.memoFile('gone');
      expect(existsSync(memoFile)).toBe(true);

      const sessions = new Set(['gone']);
      const callState = createOpencodeCallState();
      callState.trackShellCwd('gone', 'c', '/repo/sub');
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
      memoA.addSurfaced('a', ['span-a'], new Set());
      const memoB = createDiskMemoStore(silentLogger(), temp.layout);
      memoB.addSurfaced('b', ['span-b'], new Set());
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
      await present(hooks['shell.env'], 'the shell.env hook')(
        { callID: 'ghost-call', cwd: '/ghost-frame' },
        { env: {} }
      );
      // Decision 8 scopes pruning to real sessionIDs; a ''-keyed frame would
      // sit outside every session.idle/deleted prune's reach forever.
      expect(stash.peekShellCwd('', 'ghost-call')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('an undefined event argument resolves without acting — the assembled boundary fails open', async () => {
    const { hooks, cleanup } = assembleOverScratch();
    try {
      await expect(present(hooks.event, 'the event hook')(undefined as never)).resolves.toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('a shell.env with sessionID records the frame and idle prunes it at the turn boundary', async () => {
    const { hooks, stash, cleanup } = assembleOverScratch();
    try {
      await present(hooks['shell.env'], 'the shell.env hook')(
        { sessionID: 'sess', callID: 'real-call', cwd: '/frame' },
        { env: {} }
      );
      expect(stash.peekShellCwd('sess', 'real-call')).toBe('/frame');
      await present(
        hooks.event,
        'the event hook'
      )({ event: { type: 'session.idle', properties: { sessionID: 'sess' } } });
      expect(stash.peekShellCwd('sess', 'real-call')).toBeNull();
    } finally {
      cleanup();
    }
  });
});
