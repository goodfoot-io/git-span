import { describe, expect, it } from 'vitest';
import { type BashTouchMatch, bashGatePrelude } from '../../src/common/bash-touch.js';

/** Minimal resolved-match fixture; only the fields the phase reads are populated. */
function resolvedMatch(overrides: Record<string, unknown> = {}): BashTouchMatch {
  return {
    status: 'resolved',
    idiom: 'sed-inplace',
    span: {
      operation: 'modify',
      absolutePath: '/repo/a.txt',
      simpleCommandIndex: 0,
      ...overrides
    },
    ...overrides
  } as BashTouchMatch;
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
    const { guardByIndex } = orderCommands([resolvedMatch({ simpleCommandIndex: 0 })], [guard as never]);
    expect(guardByIndex.size).toBe(0);
  });
});
