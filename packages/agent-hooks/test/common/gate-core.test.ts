/**
 * Skipped acceptance checks for gate-core.ts (Phase 3.2 of the TDD bootstrap
 * described in plans/initial.md's Phase 3). Phase 3.1 declared
 * `parseGitCommand`, `resolveChangeset`, and `evaluateGate` as not-implemented
 * stubs (`isGateSkipped` is the sole already-implemented exception); this file
 * writes the contract's acceptance checks against those stubs so the eventual
 * Phase 3.3 implementation has a fixed target. Every case here is marked
 * `.skip` — none are expected to run (the stubs throw `Not Implemented`);
 * Phase 3.3 unskips them one by one while implementing minimally against each.
 *
 * Fakes are constructed against the real exported types from gate-core.ts
 * (`GitExecutor`, `GateExecutors`, `GateMemoState`, `StalePorcelainRow`,
 * `PorcelainRow`, `ParsedGitCommand`, `GateResult`) rather than
 * loosened/`any`-typed shapes — that fidelity is the payoff of the bootstrap:
 * an awkward fake here is a contract-ergonomics finding, not something to
 * work around.
 */

import { describe, expect, it } from 'vitest';
import type { PorcelainRow, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import {
  evaluateGate,
  type GateExecutors,
  type GateMemoState,
  type GitExecutor,
  isGateSkipped,
  parseGitCommand,
  resolveChangeset
} from '../../src/common/gate-core.js';

const REPO_ROOT = '/repo';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An in-memory GateMemoState fake — one Set of presented digests. */
function createMemoryGateMemoState(): GateMemoState {
  const digests = new Set<string>();
  return {
    has(digest: string): boolean {
      return digests.has(digest);
    },
    record(digest: string): void {
      digests.add(digest);
    }
  };
}

/** A GitExecutor fake with independently overridable staged/tracked/outgoing results. */
function createFakeGitExecutor(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    stagedPaths: async (): Promise<string[]> => [],
    trackedModifiedPaths: async (): Promise<string[]> => [],
    outgoingPaths: async (): Promise<string[]> => [],
    ...overrides
  };
}

/** A GateExecutors fake with independently overridable fix/stale/list results. */
function createFakeGateExecutors(overrides: Partial<GateExecutors> = {}): GateExecutors {
  return {
    fix: async (): Promise<void> => {},
    list: async (): Promise<PorcelainRow[]> => [],
    stale: async (): Promise<StalePorcelainRow[]> => [],
    ...overrides
  };
}

/** A porcelain row for a span covering a given path. */
function porcelainRow(overrides: Partial<PorcelainRow> = {}): PorcelainRow {
  return { name: 'billing/checkout-request-flow', path: 'src/app.ts', start: 1, end: 10, ...overrides };
}

/** A stale porcelain row (drift row) for a span covering a given path. */
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

describe('gate-core (Phase 3.2 — skipped acceptance checks)', () => {
  // -------------------------------------------------------------------------
  // parseGitCommand
  // -------------------------------------------------------------------------

  describe('parseGitCommand', () => {
    it('recognizes a plain `git commit -m "..."` as kind: commit', () => {
      const result = parseGitCommand('git commit -m "wip"');

      expect(result.kind).toBe('commit');
    });

    it('recognizes a plain `git push` as kind: push', () => {
      const result = parseGitCommand('git push');

      expect(result.kind).toBe('push');
    });

    it('recognizes a chained `&&` form: `cd /repo && git commit -m "wip"`', () => {
      const result = parseGitCommand('cd /repo && git commit -m "wip"');

      expect(result.kind).toBe('commit');
    });

    it('recognizes a chained `;` form: `echo done; git push`', () => {
      const result = parseGitCommand('echo done; git push');

      expect(result.kind).toBe('push');
    });

    it('recognizes a piped form: `git commit -m "wip" | cat`', () => {
      const result = parseGitCommand('git commit -m "wip" | cat');

      expect(result.kind).toBe('commit');
    });

    it('recognizes `git -C <dir> commit -m "..."`', () => {
      const result = parseGitCommand('git -C /repo/sub commit -m "wip"');

      expect(result.kind).toBe('commit');
    });

    it('recognizes a trailing pathspec after `--` and populates paths', () => {
      const result = parseGitCommand('git commit -m "wip" -- src/app.ts src/util.ts');

      expect(result.kind).toBe('commit');
      expect(result.paths).toEqual(['src/app.ts', 'src/util.ts']);
    });

    it('recognizes the `-a` form as kind: commit (the `all` signal is not carried on ParsedGitCommand)', () => {
      const result = parseGitCommand('git commit -a -m "wip"');

      expect(result.kind).toBe('commit');
      expect(result).not.toHaveProperty('all');
    });

    it('recognizes the `-am` form as kind: commit (the `all` signal is not carried on ParsedGitCommand)', () => {
      const result = parseGitCommand('git commit -am "wip"');

      expect(result.kind).toBe('commit');
      expect(result).not.toHaveProperty('all');
    });

    it('treats a command whose message merely contains the substring "git commit" as kind: none', () => {
      const result = parseGitCommand('echo "please git commit later"');

      expect(result.kind).toBe('none');
    });

    it('treats an unrecognized/unfamiliar shape (alias) as kind: none', () => {
      const result = parseGitCommand('git ci -m "wip"');

      expect(result.kind).toBe('none');
    });

    it('treats a dynamically-built command as kind: none', () => {
      const result = parseGitCommand('eval "git $ACTION"');

      expect(result.kind).toBe('none');
    });
  });

  // -------------------------------------------------------------------------
  // resolveChangeset
  // -------------------------------------------------------------------------

  describe('resolveChangeset', () => {
    it('commit, all: false → staged paths only, excluding tracked-modified paths', async () => {
      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/staged.ts'],
        trackedModifiedPaths: async (): Promise<string[]> => ['src/unstaged-modified.ts']
      });

      const result = await resolveChangeset('commit', false, REPO_ROOT, git);

      expect(result).toEqual(['src/staged.ts']);
      expect(result).not.toContain('src/unstaged-modified.ts');
    });

    it('commit, all: true → staged paths plus tracked-modified paths, deduplicated', async () => {
      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/staged.ts', 'src/both.ts'],
        trackedModifiedPaths: async (): Promise<string[]> => ['src/both.ts', 'src/modified.ts']
      });

      const result = await resolveChangeset('commit', true, REPO_ROOT, git);

      expect(new Set(result)).toEqual(new Set(['src/staged.ts', 'src/both.ts', 'src/modified.ts']));
      expect(result.filter((p) => p === 'src/both.ts')).toHaveLength(1);
    });

    it('push → the outgoing range paths, ignoring `all`', async () => {
      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/staged.ts'],
        trackedModifiedPaths: async (): Promise<string[]> => ['src/modified.ts'],
        outgoingPaths: async (): Promise<string[]> => ['src/outgoing.ts']
      });

      const result = await resolveChangeset('push', true, REPO_ROOT, git);

      expect(result).toEqual(['src/outgoing.ts']);
    });
  });

  // -------------------------------------------------------------------------
  // evaluateGate
  // -------------------------------------------------------------------------

  describe('evaluateGate', () => {
    it('empty paths → allow/silent, and the injected executors are never invoked', async () => {
      const memo = createMemoryGateMemoState();
      let calls = 0;
      const executors = createFakeGateExecutors({
        fix: async (): Promise<void> => {
          calls += 1;
        },
        list: async (): Promise<PorcelainRow[]> => {
          calls += 1;
          return [];
        },
        stale: async (): Promise<StalePorcelainRow[]> => {
          calls += 1;
          return [];
        }
      });

      const result = await evaluateGate([], REPO_ROOT, executors, memo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
      expect(calls).toBe(0);
    });

    it('semantic staleness (CHANGED/DELETED) → deny/semantic-staleness with findings, and re-denies on an unchanged memoState', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED' })]
      });
      const paths = ['src/app.ts'];

      const first = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('deny');
      expect(first.kind).toBe('semantic-staleness');
      if (first.kind === 'semantic-staleness') {
        expect(first.findings).toHaveLength(1);
      }

      // Same paths, same executor results, same memoState — staleness
      // re-blocks until the findings themselves change; the memo does not
      // suppress a repeated semantic-staleness denial.
      const second = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(second.decision).toBe('deny');
      expect(second.kind).toBe('semantic-staleness');
    });

    it('uncovered writes only → denies once and records state, then resolves to allow/already-presented on retry with unchanged memoState', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        // Zero covering rows for the changed path — an uncovered write.
        list: async (): Promise<PorcelainRow[]> => [],
        stale: async (): Promise<StalePorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts'];

      const first = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('deny');
      expect(first.kind).toBe('uncovered-writes');
      if (first.kind === 'uncovered-writes') {
        expect(first.uncovered).toEqual(['src/uncovered.ts']);
      }

      // Identical paths/executor results and the same memoState — consider-once.
      const second = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(second).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    it('MOVED/RESOLVED_PENDING_COMMIT-only staleness never denies, regardless of memoState state', async () => {
      const freshMemo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [
          staleRow({ status: 'MOVED' }),
          staleRow({ name: 'other/span', status: 'RESOLVED_PENDING_COMMIT' })
        ]
      });
      const paths = ['src/app.ts'];

      const first = await evaluateGate(paths, REPO_ROOT, executors, freshMemo);
      expect(first.decision).toBe('allow');

      // A memoState that has already recorded some unrelated digest must not
      // change this outcome — positional-only drift never denies.
      const primedMemo = createMemoryGateMemoState();
      primedMemo.record('some-other-digest');
      const second = await evaluateGate(paths, REPO_ROOT, executors, primedMemo);
      expect(second.decision).toBe('allow');
    });

    it('an executor rejecting (internal/CLI error) resolves to allow/silent rather than throwing', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        stale: async (): Promise<StalePorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        }
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });
  });

  // -------------------------------------------------------------------------
  // isGateSkipped
  // -------------------------------------------------------------------------

  describe('isGateSkipped', () => {
    it('returns true when GIT_SPAN_GATE is exactly "skip"', () => {
      expect(isGateSkipped({ GIT_SPAN_GATE: 'skip' })).toBe(true);
    });

    it('returns false when the env is empty', () => {
      expect(isGateSkipped({})).toBe(false);
    });

    it('returns false for a near-miss value like "no"', () => {
      expect(isGateSkipped({ GIT_SPAN_GATE: 'no' })).toBe(false);
    });

    it('returns false for an empty-string value', () => {
      expect(isGateSkipped({ GIT_SPAN_GATE: '' })).toBe(false);
    });
  });
});
