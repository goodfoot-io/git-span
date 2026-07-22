/**
 * Skipped acceptance checks for gate-core.ts (Phase 3.2 of the TDD bootstrap
 * described in plans/initial.md's Phase 3). Phase 3.1 declared
 * `parseGitCommand`, `resolveChangeset`, and `evaluateGate` as not-implemented
 * stubs; this file writes the contract's acceptance checks against those
 * stubs so the eventual Phase 3.3 implementation has a fixed target. Every
 * case here is marked `.skip` — none are expected to run (the stubs throw
 * `Not Implemented`); Phase 3.3 unskips them one by one while implementing
 * minimally against each.
 *
 * Fakes are constructed against the real exported types from gate-core.ts
 * (`GitExecutor`, `GateExecutors`, `GateMemoState`, `StalePorcelainRow`,
 * `PorcelainRow`, `ParsedGitCommand`, `GateResult`) rather than
 * loosened/`any`-typed shapes — that fidelity is the payoff of the bootstrap:
 * an awkward fake here is a contract-ergonomics finding, not something to
 * work around.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PorcelainRow, StalePorcelainRow } from '../../src/common/agent-hooks-common.js';
import {
  commitStagesAll,
  evaluateGate,
  type GateExecutors,
  type GateMemoState,
  GateScanError,
  type GitExecutor,
  parseGitCommand,
  resolveChangeset
} from '../../src/common/gate-core.js';
import { makeTempRepo } from '../helpers.js';

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
    record(digest: string): boolean {
      digests.add(digest);
      return true;
    }
  };
}

/** A GitExecutor fake with independently overridable staged/tracked/outgoing/pathspec results. */
function createFakeGitExecutor(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    stagedPaths: async (): Promise<string[]> => [],
    trackedModifiedPaths: async (): Promise<string[]> => [],
    outgoingPaths: async (): Promise<string[]> => [],
    pathspecPaths: async (): Promise<string[]> => [],
    ...overrides
  };
}

/** A GateExecutors fake with independently overridable fix/stale/list results. */
function createFakeGateExecutors(overrides: Partial<GateExecutors> = {}): GateExecutors {
  return {
    fix: async (): Promise<void> => {},
    list: async (): Promise<PorcelainRow[]> => [],
    stale: async (): Promise<StalePorcelainRow[]> => [],
    listBlocks: async (): Promise<string> => '',
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

    it('commit with explicit pathspecs → the pathspec working-tree content only, never the full staged set', async () => {
      const git = createFakeGitExecutor({
        // A `git commit -- src/scoped.ts` lands only the pathspec content, not
        // whatever else happens to be staged.
        stagedPaths: async (): Promise<string[]> => ['src/staged-elsewhere.ts'],
        pathspecPaths: async (paths): Promise<string[]> => (paths.includes('src/scoped.ts') ? ['src/scoped.ts'] : [])
      });

      const result = await resolveChangeset('commit', false, REPO_ROOT, git, ['src/scoped.ts']);

      expect(result).toEqual(['src/scoped.ts']);
      expect(result).not.toContain('src/staged-elsewhere.ts');
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

    it('semantic staleness (CHANGED/DELETED) → deny/semantic-staleness with findings once per digest, then falls through to allow/already-presented on an identical retry', async () => {
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

      // Same paths, same executor results, same memoState — the digest is
      // already memoized, so evaluation falls through past the semantic check
      // into the (clean) environmental and uncovered checks, ending in
      // already-presented rather than a bare silent allow.
      const second = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(second).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    it('a semantic-staleness deny renders the full human span block with per-anchor drift labels', async () => {
      const memo = createMemoryGateMemoState();
      const blocks = [
        '## billing/checkout-request-flow',
        '- src/app.ts#L1-L10',
        '- api/charge.ts#L30-L76',
        '',
        'Checkout request flow that carries a charge attempt from the browser to the server.'
      ].join('\n');
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => blocks
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.kind).toBe('semantic-staleness');
      if (result.kind === 'semantic-staleness') {
        expect(result.reason).toContain('This change leaves a latent semantic dependency out of date:');
        // The drifted anchor is labeled; the clean sibling anchor is not.
        expect(result.reason).toContain('- src/app.ts#L1-L10 — changed');
        expect(result.reason).toContain('- api/charge.ts#L30-L76\n');
        expect(result.reason).toContain('Checkout request flow');
        expect(result.reason).toContain('git span add billing/checkout-request-flow');
      }
    });

    it('a failed human-format list read degrades to a synthesized block — the deny still carries every finding', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => {
          throw new Error('spawn git ENOENT');
        }
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('deny');
      expect(result.kind).toBe('semantic-staleness');
      if (result.kind === 'semantic-staleness') {
        expect(result.reason).toContain('## billing/checkout-request-flow');
        expect(result.reason).toContain('- src/app.ts#L1-L10 — changed');
      }
    });

    it('a changed findings set produces a fresh semantic-staleness deny (new digest) even after the prior digest was memoized', async () => {
      const memo = createMemoryGateMemoState();
      let call = 0;
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => {
          call += 1;
          // The first call's findings differ from the second's (a different
          // path drifted), so the digests differ and the second eval denies
          // fresh rather than falling through.
          return [staleRow({ status: 'CHANGED', path: call === 1 ? 'src/app.ts' : 'src/other.ts' })];
        }
      });
      const paths = ['src/app.ts'];

      const first = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('deny');
      expect(first.kind).toBe('semantic-staleness');

      const second = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(second.decision).toBe('deny');
      expect(second.kind).toBe('semantic-staleness');
    });

    it('a changeset carrying both unpresented semantic staleness and unpresented uncovered writes denies twice — staleness first, uncovered on the retry — then passes on the third attempt', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        // src/app.ts is covered but semantically stale; src/uncovered.ts has no
        // covering span at all.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/app.ts' })],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED', path: 'src/app.ts' })]
      });
      const paths = ['src/app.ts', 'src/uncovered.ts'];

      const first = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('deny');
      expect(first.kind).toBe('semantic-staleness');

      // The semantic digest is now memoized, so this retry falls through past
      // the (already-presented) semantic check into the uncovered check, which
      // has not been presented yet — a fresh deny for a distinct debt state.
      const second = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(second.decision).toBe('deny');
      expect(second.kind).toBe('uncovered-writes');
      if (second.kind === 'uncovered-writes') {
        expect(second.uncovered).toEqual(['src/uncovered.ts']);
      }

      // Both digests are now memoized — the third attempt ends clean.
      const third = await evaluateGate(paths, REPO_ROOT, executors, memo);
      expect(third).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    it('a memo that cannot persist (record returns false) fails OPEN on semantic staleness rather than denying with no escape', async () => {
      const unwritableMemo: GateMemoState = { has: () => false, record: () => false };
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'CHANGED' })]
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, unwritableMemo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
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

    it('a `.span/.gateignore` match drops the sole uncovered path, resolving to allow/silent', async () => {
      const repo = makeTempRepo();
      try {
        fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
        fs.writeFileSync(nodePath.join(repo.root, '.span', '.gateignore'), 'src/generated\n');

        const memo = createMemoryGateMemoState();
        const executors = createFakeGateExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          stale: async (): Promise<StalePorcelainRow[]> => []
        });

        const result = await evaluateGate(['src/generated/out.ts'], repo.root, executors, memo);

        expect(result).toEqual({ decision: 'allow', kind: 'silent' });
      } finally {
        repo.cleanup();
      }
    });

    it('a `.span/.gateignore` present but not matching the uncovered path still denies', async () => {
      const repo = makeTempRepo();
      try {
        fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
        fs.writeFileSync(nodePath.join(repo.root, '.span', '.gateignore'), 'src/generated\n');

        const memo = createMemoryGateMemoState();
        const executors = createFakeGateExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          stale: async (): Promise<StalePorcelainRow[]> => []
        });

        const result = await evaluateGate(['src/uncovered.ts'], repo.root, executors, memo);

        expect(result.decision).toBe('deny');
        expect(result.kind).toBe('uncovered-writes');
        if (result.kind === 'uncovered-writes') {
          expect(result.uncovered).toEqual(['src/uncovered.ts']);
        }
      } finally {
        repo.cleanup();
      }
    });

    it('a missing `.span/.gateignore` fails open — no additional exclusion — and still denies the uncovered path', async () => {
      const repo = makeTempRepo();
      try {
        const memo = createMemoryGateMemoState();
        const executors = createFakeGateExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          stale: async (): Promise<StalePorcelainRow[]> => []
        });

        const result = await evaluateGate(['src/uncovered.ts'], repo.root, executors, memo);

        expect(result.decision).toBe('deny');
        expect(result.kind).toBe('uncovered-writes');
      } finally {
        repo.cleanup();
      }
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

    it('a hard scan failure (GateScanError) allows with a scan-failed warning rather than reading the aborted scan as clean, even when a sibling anchor would have carried real CHANGED debt', async () => {
      // The scoped scan spans two paths; one anchor is unreadable, so the CLI
      // aborts the entire scoped query (empty stdout + an error on stderr, which
      // the default executor surfaces as a GateScanError). Had the scan
      // completed, the sibling anchor would have surfaced CHANGED debt — but it
      // never ran, so an empty result here must NOT be silently read as
      // "clean" and swallowed: it allows (fail-open, matching the
      // `environmental` category), but with a distinct `scan-failed` kind and a
      // reason so the adapter can surface the warning instead of staying silent.
      const memo = createMemoryGateMemoState();
      let recorded = false;
      const guardedMemo: GateMemoState = {
        has: (d) => memo.has(d),
        record: (d) => {
          recorded = true;
          return memo.record(d);
        }
      };
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/sibling.ts' })],
        stale: async (): Promise<StalePorcelainRow[]> => {
          throw new GateScanError('fatal: unable to read src/app.ts: Permission denied');
        }
      });

      const result = await evaluateGate(['src/app.ts', 'src/sibling.ts'], REPO_ROOT, executors, guardedMemo);

      expect(result.decision).toBe('allow');
      expect(result.kind).toBe('scan-failed');
      if (result.kind === 'scan-failed') {
        expect(result.reason).toContain('Permission denied');
        expect(result.reason).not.toContain('To proceed anyway');
      }
      // A distinct kind from the ordinary silent allow a truly-clean scan
      // produces — the adapter must still see and surface the warning.
      expect(result).not.toEqual({ decision: 'allow', kind: 'silent' });
      // No debt-state to memoize for a scan that never ran to completion.
      expect(recorded).toBe(false);
    });

    it('a hard scan failure keeps warning on repeated evaluations — no memo involvement', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        stale: async (): Promise<StalePorcelainRow[]> => {
          throw new GateScanError('fatal: unable to read src/app.ts: Permission denied');
        }
      });

      const first = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);
      const second = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(first.decision).toBe('allow');
      expect(first.kind).toBe('scan-failed');
      expect(second.decision).toBe('allow');
      expect(second.kind).toBe('scan-failed');
    });

    it('a non-scan internal error (plain Error) still fails OPEN to allow/silent — only a scan failure fails closed', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        stale: async (): Promise<StalePorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        }
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('a terminal/environmental status (SPARSE_EXCLUDED) fails OPEN — allow/environmental with the condition surfaced, never deny', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ status: 'SPARSE_EXCLUDED' })]
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('allow');
      expect(result.kind).toBe('environmental');
      if (result.kind === 'environmental') {
        expect(result.conditions).toHaveLength(1);
        expect(result.conditions[0].status).toBe('SPARSE_EXCLUDED');
        expect(result.reason).toContain('sparse excluded');
        expect(result.reason).toContain('billing/checkout-request-flow');
      }
    });

    it('an environmental condition does not suppress a genuinely semantic finding in the same changeset (still denies)', async () => {
      const memo = createMemoryGateMemoState();
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        stale: async (): Promise<StalePorcelainRow[]> => [
          staleRow({ status: 'LFS_NOT_FETCHED', name: 'infra/anchor' }),
          staleRow({ status: 'CHANGED', name: 'billing/flow' })
        ]
      });

      const result = await evaluateGate(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('deny');
      expect(result.kind).toBe('semantic-staleness');
      if (result.kind === 'semantic-staleness') {
        // Only the semantic row is a finding; the environmental row is not.
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].name).toBe('billing/flow');
      }
    });

    it('a memo that cannot persist (record returns false) fails OPEN on an uncovered write rather than re-denying forever', async () => {
      // A memo whose record never persists would turn "deny once, then allow the
      // identical retry" into "deny every time" — so the gate must fail open.
      const unwritableMemo: GateMemoState = { has: () => false, record: () => false };
      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        stale: async (): Promise<StalePorcelainRow[]> => []
      });

      const result = await evaluateGate(['src/uncovered.ts'], REPO_ROOT, executors, unwritableMemo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('a pathspec-scoped commit gates the pathspec content and ignores unrelated staged debt', async () => {
      // Debt lives in an unrelated staged file; the commit names only a clean
      // pathspec. Resolving the changeset to the pathspec content, then gating,
      // must allow — the staged debt is not part of this commit.
      const parsed = parseGitCommand('git commit -m "wip" -- src/scoped.ts');
      expect(parsed.paths).toEqual(['src/scoped.ts']);

      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/debt.ts'],
        pathspecPaths: async (): Promise<string[]> => ['src/scoped.ts']
      });
      const changeset = await resolveChangeset('commit', false, REPO_ROOT, git, parsed.paths);
      expect(changeset).toEqual(['src/scoped.ts']);

      const executors = createFakeGateExecutors({
        // The scoped path is covered and clean; the (unevaluated) debt file is not in scope.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/scoped.ts' })],
        stale: async (paths): Promise<StalePorcelainRow[]> =>
          paths.includes('src/debt.ts') ? [staleRow({ path: 'src/debt.ts', status: 'CHANGED' })] : []
      });

      const result = await evaluateGate(changeset, REPO_ROOT, executors, createMemoryGateMemoState());

      expect(result.decision).toBe('allow');
    });

    it('a pathspec-scoped commit denies when the debt-carrying file IS in the pathspec', async () => {
      const parsed = parseGitCommand('git commit -m "wip" -- src/debt.ts');
      expect(parsed.paths).toEqual(['src/debt.ts']);

      const git = createFakeGitExecutor({
        pathspecPaths: async (): Promise<string[]> => ['src/debt.ts']
      });
      const changeset = await resolveChangeset('commit', false, REPO_ROOT, git, parsed.paths);

      const executors = createFakeGateExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/debt.ts' })],
        stale: async (): Promise<StalePorcelainRow[]> => [staleRow({ path: 'src/debt.ts', status: 'CHANGED' })]
      });

      const result = await evaluateGate(changeset, REPO_ROOT, executors, createMemoryGateMemoState());

      expect(result.decision).toBe('deny');
      expect(result.kind).toBe('semantic-staleness');
    });
  });

  // -------------------------------------------------------------------------
  // commitStagesAll
  // -------------------------------------------------------------------------

  describe('commitStagesAll', () => {
    it('detects `-a` and `-am` and `--all`', () => {
      expect(commitStagesAll('git commit -a -m "wip"')).toBe(true);
      expect(commitStagesAll('git commit -am "wip"')).toBe(true);
      expect(commitStagesAll('git commit --all -m "wip"')).toBe(true);
    });

    it('does not treat a `-m` message argument that looks like a short-flag cluster as `--all`', () => {
      // `-analysis` is the message value, not a flag — it must not widen the changeset.
      expect(commitStagesAll('git commit -m "-analysis"')).toBe(false);
      expect(commitStagesAll('git commit -m -analysis')).toBe(false);
    });

    it('is false for a plain staged commit', () => {
      expect(commitStagesAll('git commit -m "wip"')).toBe(false);
    });
  });
});
