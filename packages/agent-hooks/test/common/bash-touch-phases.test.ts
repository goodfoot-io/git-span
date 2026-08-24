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
