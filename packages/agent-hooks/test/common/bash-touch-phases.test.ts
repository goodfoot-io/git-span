import { describe, expect, it } from 'vitest';
import { type BashTouchMatch, bashGatePrelude } from '../../src/common/bash-touch.js';

/** Minimal resolved-match fixture; only the fields the phase reads are populated. */
function resolvedMatch(overrides: Record<string, unknown> = {}): never {
  return {
    status: 'resolved',
    idiom: 'sed-inplace',
    span: {
      operation: 'modify',
      absolutePath: '/repo/a.txt',
      simpleCommandIndex: 0,
      ...overrides
    }
  } as never;
}

describe('bashGatePrelude', () => {
  it('proceeds with the resolved set and the harness exit code when nothing gates', () => {
    const prelude = bashGatePrelude([resolvedMatch()], { exit_code: 0 });
    expect(prelude.kind).toBe('proceed');
    if (prelude.kind === 'proceed') {
      expect(prelude.resolved).toHaveLength(1);
      expect(prelude.exitCode).toBe(0);
    }
  });

  it('drops every span when the tool response marks the command interrupted', () => {
    const prelude = bashGatePrelude([resolvedMatch()], { interrupted: true });
    expect(prelude).toEqual({ kind: 'stop', drops: 1 });
  });

  it('stops with zero drops on an empty resolved set', () => {
    const guard = { status: 'builtin-guard', simpleCommandIndex: 0, join: undefined, exitStatus: 1 };
    expect(bashGatePrelude([guard as BashTouchMatch], {})).toEqual({ kind: 'stop', drops: 0 });
  });

  it('rejects the complete touch set atomically over the candidate budget, naming both counts', () => {
    const matches = Array.from({ length: 33 }, (_, i) =>
      resolvedMatch({ absolutePath: `/repo/f${i}.txt`, simpleCommandIndex: i })
    );
    const prelude = bashGatePrelude(matches, {});
    expect(prelude).toMatchObject({ kind: 'stop', drops: 33 });
    if (prelude.kind === 'stop') {
      expect(prelude.warn).toBe(
        'Bash candidate budget exceeded: 33 candidates (limit 32); rejecting the complete touch set'
      );
    }
  });

  it('keeps exactly the budget limit of candidates', () => {
    const matches = Array.from({ length: 32 }, (_, i) =>
      resolvedMatch({ absolutePath: `/repo/f${i}.txt`, simpleCommandIndex: i })
    );
    expect(bashGatePrelude(matches, {}).kind).toBe('proceed');
  });
});

import { orderCommands } from '../../src/common/bash-touch.js';

describe('orderCommands', () => {
  it('groups spans by simple command index in first-appearance walker order', () => {
    const { groups, guardByIndex, order } = orderCommands(
      [
        resolvedMatch({ simpleCommandIndex: 2 }),
        resolvedMatch({ simpleCommandIndex: 0 }),
        resolvedMatch({ simpleCommandIndex: 2 })
      ],
      []
    );
    expect([...groups.keys()]).toEqual([2, 0]);
    expect(groups.get(2)).toHaveLength(2);
    expect(order).toEqual([0, 2]);
    expect(guardByIndex.size).toBe(0);
  });

  it('appends span-less guards to the order without groups and dedups repeats', () => {
    const guard = (index: number) => ({ status: 'builtin-guard', simpleCommandIndex: index, exitStatus: 1 });
    const { groups, guardByIndex, order } = orderCommands([resolvedMatch({ simpleCommandIndex: 3 })], [
      guard(5),
      guard(5),
      guard(1)
    ] as never[]);
    expect(order).toEqual([1, 3, 5]);
    expect(groups.has(5)).toBe(false);
    expect(guardByIndex.get(5)).toBeDefined();
    expect(guardByIndex.size).toBe(2);
  });

  it('never lets a guard overwrite an existing span group at the same index', () => {
    const guard = { status: 'builtin-guard', simpleCommandIndex: 0, exitStatus: 0 };
    const { guardByIndex } = orderCommands([resolvedMatch({ simpleCommandIndex: 0 })] as never, [guard as never]);
    expect(guardByIndex.size).toBe(0);
  });
});

import {
  buildPassByPath,
  reconcileAgainstPassMap,
  type SpanEval,
  translateAndGateSpans
} from '../../src/common/bash-touch.js';
import { createRealityProbeCache } from '../../src/common/touch-core.js';

/** Hand-built SpanEval for phase drives; only the fields those phases read are set. */
function evalEntry(overrides: Partial<SpanEval>): SpanEval {
  return {
    match: resolvedMatch() as never,
    touch: null,
    outcome: 'inconclusive',
    explained: false,
    commandIndex: 0,
    path: '/repo/f.txt',
    sourceKey: null,
    ...overrides
  };
}

describe('translateAndGateSpans', () => {
  it('translates one entry per span, stamped with its command index and path', () => {
    const m0 = resolvedMatch({ operation: 'read', idiom: 'rg-read', simpleCommandIndex: 0 });
    const m3a = resolvedMatch({
      operation: 'read',
      idiom: 'rg-read',
      absolutePath: '/repo/c.txt',
      simpleCommandIndex: 3
    });
    const m3b = resolvedMatch({
      idiom: 'rg-read',
      span: { operation: 'read', absolutePath: '/repo/d.txt', simpleCommandIndex: 3 }
    });
    const groups = new Map<number, never[]>([
      [0, [m0]],
      [3, [m3a, m3b]]
    ]);
    const evals = translateAndGateSpans(
      groups as never,
      [0, 3],
      'sess',
      '/repo',
      true,
      createRealityProbeCache([], [])
    );
    expect([...evals.keys()]).toEqual([0, 3]);
    const first = evals.get(0)![0] as unknown as Record<string, unknown>;
    expect(first.commandIndex).toBe(0);
    expect(first.path).toBe('/repo/a.txt');
    expect(first.sourceKey).toBeNull();
    expect(first.outcome).toBe('inconclusive');
    expect(evals.get(3)).toHaveLength(2);
  });
});

describe('buildPassByPath', () => {
  it('records the highest command index with a decisivePass per path', () => {
    const evals = new Map<number, SpanEval[]>([
      [1, [evalEntry({ outcome: 'decisivePass', path: '/repo/f.txt', commandIndex: 1 })]],
      [2, [evalEntry({ outcome: 'decisiveFail', path: '/repo/g.txt', commandIndex: 2 })]],
      [3, [evalEntry({ outcome: 'decisivePass', path: '/repo/f.txt', commandIndex: 3 })]]
    ]);
    expect(buildPassByPath(evals, [1, 2, 3])).toEqual(new Map([['/repo/f.txt', 3]]));
  });
});

describe('reconcileAgainstPassMap', () => {
  it('promotes a pending hold to decisivePass when a later command passes its source path', () => {
    const pending = evalEntry({
      outcome: 'pending',
      path: '/repo/dest.txt',
      sourceKey: '/repo/src.txt',
      commandIndex: 1
    });
    const laterPass = evalEntry({ outcome: 'decisivePass', path: '/repo/src.txt', commandIndex: 2 });
    const evals = new Map<number, SpanEval[]>([
      [1, [pending]],
      [2, [laterPass]]
    ]);
    reconcileAgainstPassMap(evals, [1, 2], buildPassByPath(evals, [1, 2]));
    expect(pending.outcome).toBe('decisivePass');

    const staleHold = evalEntry({
      outcome: 'pending',
      path: '/repo/dest.txt',
      sourceKey: '/repo/src.txt',
      commandIndex: 5
    });
    const earlierPass = evalEntry({ outcome: 'decisivePass', path: '/repo/src.txt', commandIndex: 2 });
    const evals2 = new Map<number, SpanEval[]>([
      [5, [staleHold]],
      [2, [earlierPass]]
    ]);
    reconcileAgainstPassMap(evals2, [2, 5], buildPassByPath(evals2, [2, 5]));
    expect(staleHold.outcome).toBe('decisiveFail');
  });

  it('marks a decisiveFail explained when a later command passes its own path', () => {
    const fail = evalEntry({ outcome: 'decisiveFail', path: '/repo/f.txt', commandIndex: 1 });
    const rewrite = evalEntry({ outcome: 'decisivePass', path: '/repo/f.txt', commandIndex: 4 });
    const evals = new Map<number, SpanEval[]>([
      [1, [fail]],
      [4, [rewrite]]
    ]);
    reconcileAgainstPassMap(evals, [1, 4], buildPassByPath(evals, [1, 4]));
    expect(fail.explained).toBe(true);
  });
});
