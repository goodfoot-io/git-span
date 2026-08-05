/**
 * Skipped acceptance checks for advisor-core.ts (Phase 3.2 of the TDD bootstrap
 * described in plans/initial.md's Phase 3). Phase 3.1 declared
 * `parseGitCommand`, `resolveChangeset`, and `evaluateAdvisor` as not-implemented
 * stubs; this file writes the contract's acceptance checks against those
 * stubs so the eventual Phase 3.3 implementation has a fixed target. Every
 * case here is marked `.skip` — none are expected to run (the stubs throw
 * `Not Implemented`); Phase 3.3 unskips them one by one while implementing
 * minimally against each.
 *
 * Fakes are constructed against the real exported types from advisor-core.ts
 * (`GitExecutor`, `AdvisorExecutors`, `AdvisorMemoState`, `DriftPorcelainRow`,
 * `PorcelainRow`, `ParsedGitCommand`, `AdvisorResult`) rather than
 * loosened/`any`-typed shapes — that fidelity is the payoff of the bootstrap:
 * an awkward fake here is a contract-ergonomics finding, not something to
 * work around.
 */

import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AdvisorExecutors,
  type AdvisorMemoState,
  AdvisorScanError,
  buildHunkReadArgs,
  commitStagesAll,
  evaluateAdvisor,
  type GitExecutor,
  parseGitCommand,
  resolveChangeset
} from '../../src/common/advisor-core.js';
import type { DriftPorcelainRow, PorcelainRow } from '../../src/common/agent-hooks-common.js';
import type { FileDiff } from '../../src/common/mechanical-change.js';
import { makeTempRepo } from '../helpers.js';

const REPO_ROOT = '/repo';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** An in-memory AdvisorMemoState fake — one Set of presented digests. */
function createMemoryAdvisorMemoState(): AdvisorMemoState {
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
    outgoingPaths: async (): Promise<{ paths: string[]; base: string | null }> => ({ paths: [], base: '@{u}' }),
    pathspecPaths: async (): Promise<string[]> => [],
    changedHunks: async (): Promise<FileDiff[]> => [],
    ...overrides
  };
}

/** A AdvisorExecutors fake with independently overridable fix/drift/list results. */
function createFakeAdvisorExecutors(overrides: Partial<AdvisorExecutors> = {}): AdvisorExecutors {
  return {
    fix: async (): Promise<void> => {},
    list: async (): Promise<PorcelainRow[]> => [],
    drift: async (): Promise<DriftPorcelainRow[]> => [],
    listBlocks: async (): Promise<string> => '',
    ...overrides
  };
}

/** A porcelain row for a span covering a given path. */
function porcelainRow(overrides: Partial<PorcelainRow> = {}): PorcelainRow {
  return { name: 'billing/checkout-request-flow', path: 'src/app.ts', start: 1, end: 10, ...overrides };
}

/** A drifted porcelain row (drift row) for a span covering a given path. */
function driftRow(overrides: Partial<DriftPorcelainRow> = {}): DriftPorcelainRow {
  return {
    name: 'billing/checkout-request-flow',
    path: 'src/app.ts',
    start: 1,
    end: 10,
    status: 'CHANGED',
    ...overrides
  };
}

describe('advisor-core (Phase 3.2 — skipped acceptance checks)', () => {
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

    it('recognizes a plain `git status` as kind: status', () => {
      const result = parseGitCommand('git status');

      expect(result.kind).toBe('status');
    });

    it('recognizes `git -C <dir> status` and a chained `&& git status`', () => {
      expect(parseGitCommand('git -C /repo/sub status').kind).toBe('status');
      expect(parseGitCommand('cd /repo && git status').kind).toBe('status');
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

      expect(result.paths).toEqual(['src/staged.ts']);
      expect(result.paths).not.toContain('src/unstaged-modified.ts');
    });

    it('commit, all: true → staged paths plus tracked-modified paths, deduplicated', async () => {
      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/staged.ts', 'src/both.ts'],
        trackedModifiedPaths: async (): Promise<string[]> => ['src/both.ts', 'src/modified.ts']
      });

      const result = await resolveChangeset('commit', true, REPO_ROOT, git);

      expect(new Set(result.paths)).toEqual(new Set(['src/staged.ts', 'src/both.ts', 'src/modified.ts']));
      expect(result.paths.filter((p) => p === 'src/both.ts')).toHaveLength(1);
    });

    it('push → the outgoing range paths, ignoring `all`', async () => {
      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/staged.ts'],
        trackedModifiedPaths: async (): Promise<string[]> => ['src/modified.ts'],
        outgoingPaths: async (): Promise<{ paths: string[]; base: string | null }> => ({
          paths: ['src/outgoing.ts'],
          base: '@{u}'
        })
      });

      const result = await resolveChangeset('push', true, REPO_ROOT, git);

      expect(result.paths).toEqual(['src/outgoing.ts']);
    });

    it('status → staged paths plus tracked-modified paths, deduplicated, ignoring `all`/pathspecs', async () => {
      const git = createFakeGitExecutor({
        stagedPaths: async (): Promise<string[]> => ['src/staged.ts', 'src/both.ts'],
        trackedModifiedPaths: async (): Promise<string[]> => ['src/both.ts', 'src/modified.ts']
      });

      const result = await resolveChangeset('status', false, REPO_ROOT, git);

      expect(new Set(result.paths)).toEqual(new Set(['src/staged.ts', 'src/both.ts', 'src/modified.ts']));
      expect(result.paths.filter((p) => p === 'src/both.ts')).toHaveLength(1);
    });

    it('commit with explicit pathspecs → the pathspec working-tree content only, never the full staged set', async () => {
      const git = createFakeGitExecutor({
        // A `git commit -- src/scoped.ts` lands only the pathspec content, not
        // whatever else happens to be staged.
        stagedPaths: async (): Promise<string[]> => ['src/staged-elsewhere.ts'],
        pathspecPaths: async (paths): Promise<string[]> => (paths.includes('src/scoped.ts') ? ['src/scoped.ts'] : [])
      });

      const result = await resolveChangeset('commit', false, REPO_ROOT, git, ['src/scoped.ts']);

      expect(result.paths).toEqual(['src/scoped.ts']);
      expect(result.paths).not.toContain('src/staged-elsewhere.ts');
    });

    // -----------------------------------------------------------------------
    // range mapping — exercises already-implemented Phase 1 code (unskipped)
    // -----------------------------------------------------------------------

    describe('range mapping (Phase 1 DiffRange threading — not skipped, already implemented)', () => {
      it('plain commit → { kind: "staged" }', async () => {
        const git = createFakeGitExecutor({ stagedPaths: async (): Promise<string[]> => ['src/staged.ts'] });

        const result = await resolveChangeset('commit', false, REPO_ROOT, git);

        expect(result.range).toEqual({ kind: 'staged' });
      });

      it('commit -a → { kind: "worktree" }', async () => {
        const git = createFakeGitExecutor({
          stagedPaths: async (): Promise<string[]> => ['src/staged.ts'],
          trackedModifiedPaths: async (): Promise<string[]> => ['src/modified.ts']
        });

        const result = await resolveChangeset('commit', true, REPO_ROOT, git);

        expect(result.range).toEqual({ kind: 'worktree' });
      });

      it('status → { kind: "worktree" }', async () => {
        const git = createFakeGitExecutor({
          stagedPaths: async (): Promise<string[]> => ['src/staged.ts'],
          trackedModifiedPaths: async (): Promise<string[]> => ['src/modified.ts']
        });

        const result = await resolveChangeset('status', false, REPO_ROOT, git);

        expect(result.range).toEqual({ kind: 'worktree' });
      });

      it('a pathspec-scoped commit → { kind: "worktree" } (pathspecPaths is already a git diff HEAD read)', async () => {
        const git = createFakeGitExecutor({
          pathspecPaths: async (): Promise<string[]> => ['src/scoped.ts']
        });

        const result = await resolveChangeset('commit', false, REPO_ROOT, git, ['src/scoped.ts']);

        expect(result.range).toEqual({ kind: 'worktree' });
      });

      it('push with a resolved base → { kind: "commits", base }', async () => {
        const git = createFakeGitExecutor({
          outgoingPaths: async (): Promise<{ paths: string[]; base: string | null }> => ({
            paths: ['src/outgoing.ts'],
            base: '@{u}'
          })
        });

        const result = await resolveChangeset('push', false, REPO_ROOT, git);

        expect(result.range).toEqual({ kind: 'commits', base: '@{u}' });
      });

      it('push with a null base (neither upstream nor merge-base resolved) → { kind: "unresolvable" }', async () => {
        const git = createFakeGitExecutor({
          outgoingPaths: async (): Promise<{ paths: string[]; base: string | null }> => ({ paths: [], base: null })
        });

        const result = await resolveChangeset('push', false, REPO_ROOT, git);

        expect(result.range).toEqual({ kind: 'unresolvable' });
        expect(result.paths).toEqual([]);
      });
    });
  });

  // -------------------------------------------------------------------------
  // evaluateAdvisor
  // -------------------------------------------------------------------------

  describe('evaluateAdvisor', () => {
    it('empty paths → allow/silent, and the injected executors are never invoked', async () => {
      const memo = createMemoryAdvisorMemoState();
      let calls = 0;
      const executors = createFakeAdvisorExecutors({
        fix: async (): Promise<void> => {
          calls += 1;
        },
        list: async (): Promise<PorcelainRow[]> => {
          calls += 1;
          return [];
        },
        drift: async (): Promise<DriftPorcelainRow[]> => {
          calls += 1;
          return [];
        }
      });

      const result = await evaluateAdvisor([], REPO_ROOT, executors, memo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
      expect(calls).toBe(0);
    });

    it('semantic drift (CHANGED/DELETED) → deny/semantic-drift with findings once per digest, then falls through to allow/already-presented on an identical retry', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const paths = ['src/app.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('hold');
      expect(first.kind).toBe('semantic-drift');
      if (first.kind === 'semantic-drift') {
        expect(first.findings).toHaveLength(1);
      }

      // Same paths, same executor results, same memoState — the digest is
      // already memoized, so evaluation falls through past the semantic check
      // into the (clean) environmental and uncovered checks, ending in
      // already-presented rather than a bare silent allow.
      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(second).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    it('a semantic-drift deny renders the full human span block with per-anchor drift labels', async () => {
      const memo = createMemoryAdvisorMemoState();
      const blocks = [
        '## billing/checkout-request-flow',
        '- src/app.ts#L1-L10',
        '- api/charge.ts#L30-L76',
        '',
        'Checkout request flow that carries a charge attempt from the browser to the server.'
      ].join('\n');
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => blocks
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.kind).toBe('semantic-drift');
      if (result.kind === 'semantic-drift') {
        expect(result.reason).toContain('This change leaves an implicit dependency out of date:');
        // The bullet run is re-laid-out as a shared-prefix tree; the drifted
        // anchor is labeled and the clean sibling anchor is not.
        expect(result.reason).toContain('├─ src/app.ts    #L1-L10 — changed');
        expect(result.reason).toContain('└─ api/charge.ts #L30-L76\n');
        expect(result.reason).not.toContain('- src/app.ts#L1-L10');
        expect(result.reason).toContain('Checkout request flow');
        expect(result.reason).toContain('swap the old anchor for the new one with `git span replace`');
        expect(result.reason).toContain('git span drift billing/checkout-request-flow');
      }
    });

    it('a failed human-format list read degrades to a synthesized block — the deny still carries every finding', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => {
          throw new Error('spawn git ENOENT');
        }
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('semantic-drift');
      if (result.kind === 'semantic-drift') {
        expect(result.reason).toContain('## billing/checkout-request-flow');
        // A synthesized block trees exactly like a parsed one — it must not be
        // the odd one out in a second format inside the same message.
        expect(result.reason).toContain('└─ src/app.ts #L1-L10 — changed');
      }
    });

    it('passes `*Span has no anchors*` through verbatim beside a span whose bullets do tree', async () => {
      const memo = createMemoryAdvisorMemoState();
      // The CLI's `render_list_block` prints this literal for a span with zero
      // anchors. It is not a bullet, so the walk must hand it straight through
      // rather than feeding it to the tree builder.
      const blocks = [
        ['## empty/span', '*Span has no anchors*', '', 'An empty span still carries its why sentence.'].join('\n'),
        ['## billing/checkout-request-flow', '- src/app.ts#L1-L10', '', 'Checkout request flow.'].join('\n')
      ].join('\n\n---\n\n');
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => blocks
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(result.reason).toContain(['## empty/span', '*Span has no anchors*', '', 'An empty span'].join('\n'));
      expect(result.reason).toContain('└─ src/app.ts #L1-L10 — changed');
    });

    it('never collects a `why` line that happens to start with `- ` as an anchor', async () => {
      const memo = createMemoryAdvisorMemoState();
      // Bullets are only the *contiguous* `- ` run under the header; the blank
      // line closes it, so this description line is passed through as prose and
      // must never surface as a fabricated whole-file anchor in the tree.
      const why = '- Dashed why lines are prose, not anchors.';
      const blocks = ['## billing/checkout-request-flow', '- src/app.ts#L1-L10', '', why].join('\n');
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => blocks
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(result.reason).toContain(`\n${why}`);
      expect(result.reason).not.toContain('─ Dashed why lines');
    });

    it('marks a bullet whose `#L` fragment does not parse as truncated, never guessing at a range', async () => {
      const memo = createMemoryAdvisorMemoState();
      // Nothing in this repository produces these shapes today (the CLI always
      // writes a complete range), so the coverage is deliberately synthetic —
      // the marker exists so a future producer of malformed text is reported,
      // not silently reinterpreted.
      const blocks = [
        '## billing/checkout-request-flow',
        '- src/app.ts#L1-L10',
        '- src/cut.ts#L12-',
        '- src/lone.ts#L'
      ].join('\n');
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => blocks
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(result.reason).toContain(
        [
          '   ├─ app.ts  #L1-L10 — changed',
          '   ├─ cut.ts  (truncated in source — anchor incomplete)',
          '   └─ lone.ts (truncated in source — anchor incomplete)'
        ].join('\n')
      );
    });

    it('renders a bare-path bullet as a whole-file anchor with zero marker, never as truncated', async () => {
      const memo = createMemoryAdvisorMemoState();
      // The negative of the case above, and the regression that matters most:
      // a bare path carries no `#L` at all because it is a *deliberate*
      // whole-file anchor, not because anything was cut off.
      const blocks = ['## billing/checkout-request-flow', '- src/app.ts#L1-L10', '- docs/guide.md'].join('\n');
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> => blocks
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(result.reason).toContain('└─ docs/guide.md');
      expect(result.reason).not.toContain('truncated');
      expect(result.reason).not.toContain('guide.md#');
    });

    it('renders the condensed `alreadySeen` drift retry as a tree of bare paths', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'CHANGED' }),
          driftRow({ status: 'CHANGED', path: 'api/charge.ts', start: 30, end: 76 })
        ]
      });
      const paths = ['src/app.ts', 'api/charge.ts'];

      // The first `report-only` marks the debt state seen; the second renders
      // the condensed form.
      await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      const condensed = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');

      if (condensed.kind !== 'semantic-drift-report') throw new Error('unreachable');
      expect(condensed.reason).toContain('This change still leaves an implicit dependency out of date:');
      // Bare-path leaves — this deduped retry list never claimed a range, so it
      // must not render one, and it must not diverge in format from the full
      // form it condenses.
      expect(condensed.reason).toContain(['├─ src/app.ts', '└─ api/charge.ts'].join('\n'));
      expect(condensed.reason).not.toContain('- src/app.ts');
    });

    it('a changed findings set produces a fresh semantic-drift deny (new digest) even after the prior digest was memoized', async () => {
      const memo = createMemoryAdvisorMemoState();
      let call = 0;
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => {
          call += 1;
          // The first call's findings differ from the second's (a different
          // path drifted), so the digests differ and the second eval denies
          // fresh rather than falling through.
          return [driftRow({ status: 'CHANGED', path: call === 1 ? 'src/app.ts' : 'src/other.ts' })];
        }
      });
      const paths = ['src/app.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('hold');
      expect(first.kind).toBe('semantic-drift');

      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(second.decision).toBe('hold');
      expect(second.kind).toBe('semantic-drift');
    });

    it('a changeset carrying both unpresented semantic drift and unpresented uncovered writes denies twice — drift first, uncovered on the retry — then passes on the third attempt', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        // src/app.ts is covered but semantically drifted; src/uncovered.ts has no
        // covering span at all.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/app.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED', path: 'src/app.ts' })]
      });
      const paths = ['src/app.ts', 'src/uncovered.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('hold');
      expect(first.kind).toBe('semantic-drift');

      // The semantic digest is now memoized, so this retry falls through past
      // the (already-presented) semantic check into the uncovered check, which
      // has not been presented yet — a fresh deny for a distinct debt state.
      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(second.decision).toBe('hold');
      expect(second.kind).toBe('uncovered-writes');
      if (second.kind === 'uncovered-writes') {
        expect(second.uncovered).toEqual(['src/uncovered.ts']);
      }

      // Both digests are now memoized — the third attempt ends clean.
      const third = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(third).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    it('a memo that cannot persist (record returns false) fails OPEN on semantic drift rather than denying with no escape', async () => {
      const unwritableMemo: AdvisorMemoState = { has: () => false, record: () => false };
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, unwritableMemo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('uncovered writes only → denies once and records state, then resolves to allow/already-presented on retry with unchanged memoState', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        // Zero covering rows for the changed paths — uncovered writes. Two
        // files, since a single-file changeset can never carry a cross-file
        // coupling and short-circuits to no uncovered paths.
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(first.decision).toBe('hold');
      expect(first.kind).toBe('uncovered-writes');
      if (first.kind === 'uncovered-writes') {
        expect(first.uncovered).toEqual(['src/uncovered.ts', 'src/other.ts']);
      }

      // Identical paths/executor results and the same memoState — consider-once.
      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      expect(second).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    it('a two-file changeset with only one uncovered path uses singular wording — "this file", not "these files"', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        // `src/other.ts` is covered; `src/uncovered.ts` is the only uncovered path.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('uncovered-writes');
      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.uncovered).toEqual(['src/uncovered.ts']);
      expect(result.reason).toContain('Determine if this file carries implicit dependencies');
      expect(result.reason).not.toContain('these files carry');
    });

    it('names the covered file that shares this changeset as a related span, using a line-range anchor', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        // `src/other.ts` is covered by `billing/checkout-request-flow`;
        // `src/uncovered.ts` has no span at all.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts', start: 5, end: 20 })],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain('Other files in this change already belong to spans');
      expect(result.reason).toContain('## billing/checkout-request-flow');
      expect(result.reason).toContain('└─ src/other.ts #L5-L20');
    });

    it('renders a bare path for a whole-file anchor in the related-spans section', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts', start: 0, end: 0 })],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      // Zero marker of any kind — a whole-file anchor is a real, deliberate
      // anchor, never rendered as truncated or otherwise annotated.
      expect(result.reason).toContain('└─ src/other.ts');
      expect(result.reason).not.toContain('other.ts#L');
      expect(result.reason).not.toContain('truncated');
    });

    it('groups multiple covered files under one shared span name, and ranks the span covering more of the changeset first even though its name sorts last', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'zeta/pair', path: 'src/z1.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'zeta/pair', path: 'src/z2.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'alpha/solo', path: 'src/a1.ts', start: 1, end: 5 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/z1.ts', 'src/z2.ts', 'src/a1.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      const alphaIndex = result.reason.indexOf('## alpha/solo');
      const zetaIndex = result.reason.indexOf('## zeta/pair');
      expect(zetaIndex).toBeGreaterThan(-1);
      // `zeta/pair` covers two of the changed files to `alpha/solo`'s one, so
      // it leads despite sorting last alphabetically.
      expect(alphaIndex).toBeGreaterThan(zetaIndex);
      // Both of `zeta/pair`'s anchors share `src/`, so they group under one branch.
      expect(result.reason).toContain(['└─ src/', '   ├─ z1.ts #L1-L5', '   └─ z2.ts #L1-L5'].join('\n'));
    });

    it("includes each related span's `why` sentence, fetched via `listBlocks`, under its anchor group", async () => {
      const memo = createMemoryAdvisorMemoState();
      const blocks = [
        [
          '## alpha/solo',
          '- src/a1.ts#L1-L5',
          '',
          'Alpha solo carries a single implicit dependency worth tracking on its own.'
        ].join('\n'),
        ['## zeta/pair', '- src/z1.ts#L1-L5', '- src/z2.ts#L1-L5', '', 'Zeta pair keeps two files in lockstep.'].join(
          '\n'
        )
      ].join('\n\n---\n\n');
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'zeta/pair', path: 'src/z1.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'zeta/pair', path: 'src/z2.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'alpha/solo', path: 'src/a1.ts', start: 1, end: 5 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        listBlocks: async (): Promise<string> => blocks
      });
      const paths = ['src/uncovered.ts', 'src/z1.ts', 'src/z2.ts', 'src/a1.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain('Alpha solo carries a single implicit dependency worth tracking on its own.');
      expect(result.reason).toContain('Zeta pair keeps two files in lockstep.');
      // Each why sentence follows its own group's anchors, not the other's.
      // `zeta/pair` ranks first (it covers two changed files), so its why
      // sentence lands above `alpha/solo`'s header.
      const zetaWhyIndex = result.reason.indexOf('Zeta pair keeps');
      const alphaHeaderIndex = result.reason.indexOf('## alpha/solo');
      expect(zetaWhyIndex).toBeGreaterThan(-1);
      expect(zetaWhyIndex).toBeLessThan(alphaHeaderIndex);
    });

    it("omits a related span's `why` line when the span has none recorded", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts', start: 5, end: 20 })],
        drift: async (): Promise<DriftPorcelainRow[]> => [],
        listBlocks: async (): Promise<string> =>
          ['## billing/checkout-request-flow', '- src/other.ts#L5-L20'].join('\n')
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain('## billing/checkout-request-flow');
      expect(result.reason).toContain('└─ src/other.ts #L5-L20');
    });

    it('omits the related-spans section entirely when no other file in the changeset carries any span coverage', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other-uncovered.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).not.toContain('Other files in this change already belong to spans');
      expect(result.reason).not.toContain('---');
    });

    it('breaks a co-occurrence tie by path proximity — the span anchored beside the uncovered file leads', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        // Both spans cover exactly one changed file, so co-occurrence ties.
        // `far/away` sorts first alphabetically, but `near/by`'s anchor lives
        // in the same directory as the uncovered file.
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'far/away', path: 'docs/guide/intro.md', start: 1, end: 5 }),
          porcelainRow({ name: 'near/by', path: 'src/billing/other.ts', start: 1, end: 5 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/billing/uncovered.ts', 'docs/guide/intro.md', 'src/billing/other.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      const nearIndex = result.reason.indexOf('## near/by');
      const farIndex = result.reason.indexOf('## far/away');
      expect(nearIndex).toBeGreaterThan(-1);
      expect(farIndex).toBeGreaterThan(nearIndex);
    });

    it('ranks by how much of the changeset a span covers, not by how many anchors it has', async () => {
      const memo = createMemoryAdvisorMemoState();
      // `git span list` returns matching spans *whole*, so `big/span` arrives
      // with five anchors even though only one of them is in this changeset.
      // `small/span` covers three changed files. Overlap must win.
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'big/span', path: 'src/b1.ts', start: 1, end: 5 }),
          ...Array.from({ length: 4 }, (_, index) =>
            porcelainRow({ name: 'big/span', path: `elsewhere/x${index}.ts`, start: 1, end: 5 })
          ),
          porcelainRow({ name: 'small/span', path: 'src/s1.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'small/span', path: 'src/s2.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'small/span', path: 'src/s3.ts', start: 1, end: 5 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/b1.ts', 'src/s1.ts', 'src/s2.ts', 'src/s3.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason.indexOf('## small/span')).toBeLessThan(result.reason.indexOf('## big/span'));
      // And the anchors outside this changeset are never rendered under a
      // header that promises "other files in this change".
      expect(result.reason).not.toContain('elsewhere/');
      // The in-changeset anchor of the big span survives the filter, and
      // filtering does not change which paths are flagged uncovered.
      expect(result.reason).toContain('└─ src/b1.ts #L1-L5');
      expect(result.reason).toContain('src/uncovered.ts');
    });

    it('does not treat two repo-root files as maximally proximate', async () => {
      const memo = createMemoryAdvisorMemoState();
      // Both spans cover one changed file, so co-occurrence ties. `root/cfg`
      // is anchored at the repo root (zero directory depth) and sorts first
      // alphabetically; `sub/tree` shares a real directory with the uncovered
      // file and must lead.
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'root/cfg', path: 'package.json', start: 0, end: 0 }),
          porcelainRow({ name: 'sub/tree', path: 'src/billing/other.ts', start: 1, end: 5 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/billing/uncovered.ts', 'package.json', 'src/billing/other.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason.indexOf('## sub/tree')).toBeLessThan(result.reason.indexOf('## root/cfg'));
    });

    it('orders a fully-tied set by span name, so identical state always renders identically', async () => {
      const memo = createMemoryAdvisorMemoState();
      // Same co-occurrence (one file each) and same proximity (same
      // directory), fed in reverse-alphabetical order: only the name
      // tie-break can decide, and it must decide the same way every run.
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'c/span', path: 'src/c.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'b/span', path: 'src/b.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'a/span', path: 'src/a.ts', start: 1, end: 5 })
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);
      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, createMemoryAdvisorMemoState());

      if (first.kind !== 'uncovered-writes') throw new Error('unreachable');
      if (second.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(first.reason.indexOf('## a/span')).toBeLessThan(first.reason.indexOf('## b/span'));
      expect(first.reason.indexOf('## b/span')).toBeLessThan(first.reason.indexOf('## c/span'));
      expect(second.reason).toBe(first.reason);
    });

    it('lists all eight spans with no disclosure line at the cap, and truncates with an explicit count past it', async () => {
      const spanRows = (count: number): PorcelainRow[] =>
        Array.from({ length: count }, (_, index) =>
          porcelainRow({ name: `span/${String(index).padStart(2, '0')}`, path: `src/f${index}.ts`, start: 1, end: 5 })
        );
      const changed = (count: number): string[] => [
        'src/uncovered.ts',
        ...Array.from({ length: count }, (_, index) => `src/f${index}.ts`)
      ];

      const atCap = await evaluateAdvisor(
        changed(8),
        REPO_ROOT,
        createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => spanRows(8),
          drift: async (): Promise<DriftPorcelainRow[]> => []
        }),
        createMemoryAdvisorMemoState()
      );
      if (atCap.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(atCap.reason).toContain('## span/07');
      expect(atCap.reason).not.toContain('not shown');

      const overCap = await evaluateAdvisor(
        changed(11),
        REPO_ROOT,
        createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => spanRows(11),
          drift: async (): Promise<DriftPorcelainRow[]> => []
        }),
        createMemoryAdvisorMemoState()
      );
      if (overCap.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(overCap.reason).toContain('## span/07');
      expect(overCap.reason).not.toContain('## span/08');
      expect(overCap.reason).toContain(
        '3 more spans cover files in this change and are not shown — `git span list` lists every span in the repository.'
      );

      const oneOver = await evaluateAdvisor(
        changed(9),
        REPO_ROOT,
        createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => spanRows(9),
          drift: async (): Promise<DriftPorcelainRow[]> => []
        }),
        createMemoryAdvisorMemoState()
      );
      if (oneOver.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(oneOver.reason).toContain(
        '1 more span covers files in this change and is not shown — `git span list` lists every span in the repository.'
      );
    });

    it('the condensed `alreadySeen` form ranks and caps the related-spans section exactly as the full message it condenses', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [
          porcelainRow({ name: 'zeta/pair', path: 'src/z1.ts', start: 1, end: 5 }),
          porcelainRow({ name: 'zeta/pair', path: 'src/z2.ts', start: 1, end: 5 }),
          ...Array.from({ length: 8 }, (_, index) =>
            porcelainRow({ name: `span/${String(index).padStart(2, '0')}`, path: `src/f${index}.ts`, start: 1, end: 5 })
          )
        ],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = [
        'src/uncovered.ts',
        'src/z1.ts',
        'src/z2.ts',
        ...Array.from({ length: 8 }, (_, index) => `src/f${index}.ts`)
      ];

      // First `report-only` renders the full form; the second, on the unchanged
      // debt state, renders the condensed one.
      const full = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      const condensed = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      if (full.kind !== 'uncovered-writes-report') throw new Error('unreachable');
      if (condensed.kind !== 'uncovered-writes-report') throw new Error('unreachable');

      expect(condensed.reason).toContain('Already flagged for git-span review above.');
      // Compare the section itself, stopping at the disclosure line — what
      // trails it differs between the forms for reasons predating ranking
      // (the full form closes with the skill-loading sentence).
      const section = (reason: string): string => {
        const body = reason.slice(reason.indexOf('Other files in this change'));
        return body.slice(0, body.indexOf('not shown'));
      };
      expect(section(condensed.reason)).toBe(section(full.reason));
      // The two-file span leads, the ninth-ranked span is cut, and the cut is disclosed.
      expect(condensed.reason.indexOf('## zeta/pair')).toBeLessThan(condensed.reason.indexOf('## span/00'));
      expect(condensed.reason).not.toContain('## span/07');
      expect(condensed.reason).toContain(
        '1 more span covers files in this change and is not shown — `git span list` lists every span in the repository.'
      );
    });

    it('an `inform` (status) preview that already showed a debt state lets the following `enforce` attempt through instead of denying it again', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts', start: 5, end: 20 })],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const info = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      if (info.kind !== 'uncovered-writes-report') throw new Error('unreachable');
      expect(info.reason).toContain('└─ src/other.ts #L5-L20');

      // The advisor is informational, not a hard block — a bare retry already
      // gets past a deny — so once the status preview has shown this exact
      // debt state in full, the real commit attempt right after it passes
      // instead of denying a state the agent has already been told about.
      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold');
      expect(result.decision).toBe('allow');
      expect(result.kind).toBe('already-presented');
    });

    it('an `inform` (status) preview of an uncovered group, immediately followed by an `enforce` (commit) attempt on the same debt state, lets the commit through', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['packages/website/app/components/icons.tsx', 'packages/website/public/logo-positive.svg'];

      // `git add -A && git status` — a status preview, non-blocking.
      const info = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      expect(info.decision).toBe('allow');
      expect(info.kind).toBe('uncovered-writes-report');
      if (info.kind !== 'uncovered-writes-report') throw new Error('unreachable');
      expect(info.reason).toContain('Determine if these files carry implicit dependencies');

      // `git commit` moments later, same unresolved debt state — already
      // explained in full by the status preview, so it passes rather than
      // denying a second time for no gain.
      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold');
      expect(result.decision).toBe('allow');
      expect(result.kind).toBe('already-presented');
    });

    it('an `enforce` (commit) deny of a semantic-drift group, followed by an `inform` (status) preview of the same unchanged debt state, does not repeat the full checklist verbatim', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const paths = ['src/app.ts'];

      const deny = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold');
      expect(deny.decision).toBe('hold');
      expect(deny.kind).toBe('semantic-drift');
      if (deny.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(deny.reason).toContain('This change leaves an implicit dependency out of date');

      const info = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      expect(info.decision).toBe('allow');
      expect(info.kind).toBe('semantic-drift-report');
      if (info.kind !== 'semantic-drift-report') throw new Error('unreachable');
      expect(info.reason).not.toContain('This change leaves an implicit dependency out of date');
    });

    it('a `.span/.advisorignore` match drops the sole uncovered path, resolving to allow/silent', async () => {
      const repo = makeTempRepo();
      try {
        fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
        fs.writeFileSync(nodePath.join(repo.root, '.span', '.advisorignore'), 'src/generated\n');

        const memo = createMemoryAdvisorMemoState();
        const executors = createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => []
        });

        const result = await evaluateAdvisor(['src/generated/out.ts'], repo.root, executors, memo);

        expect(result).toEqual({ decision: 'allow', kind: 'silent' });
      } finally {
        repo.cleanup();
      }
    });

    it('a `.span/.advisorignore` present but not matching the uncovered path still denies', async () => {
      const repo = makeTempRepo();
      try {
        fs.mkdirSync(nodePath.join(repo.root, '.span'), { recursive: true });
        fs.writeFileSync(nodePath.join(repo.root, '.span', '.advisorignore'), 'src/generated\n');

        const memo = createMemoryAdvisorMemoState();
        const executors = createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => []
        });

        const result = await evaluateAdvisor(['src/uncovered.ts', 'src/other.ts'], repo.root, executors, memo);

        expect(result.decision).toBe('hold');
        expect(result.kind).toBe('uncovered-writes');
        if (result.kind === 'uncovered-writes') {
          expect(result.uncovered).toEqual(['src/uncovered.ts', 'src/other.ts']);
        }
      } finally {
        repo.cleanup();
      }
    });

    it('a missing `.span/.advisorignore` fails open — no additional exclusion — and still denies the uncovered paths', async () => {
      const repo = makeTempRepo();
      try {
        const memo = createMemoryAdvisorMemoState();
        const executors = createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => []
        });

        const result = await evaluateAdvisor(['src/uncovered.ts', 'src/other.ts'], repo.root, executors, memo);

        expect(result.decision).toBe('hold');
        expect(result.kind).toBe('uncovered-writes');
      } finally {
        repo.cleanup();
      }
    });

    it('a single-file changeset never denies on uncovered writes — a lone file cannot form a cross-file coupling', async () => {
      const repo = makeTempRepo();
      try {
        const memo = createMemoryAdvisorMemoState();
        const executors = createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => []
        });

        const result = await evaluateAdvisor(['src/uncovered.ts'], repo.root, executors, memo);

        expect(result).toEqual({ decision: 'allow', kind: 'silent' });
      } finally {
        repo.cleanup();
      }
    });

    it('MOVED/RESOLVED_PENDING_COMMIT-only drift never denies, regardless of memoState state', async () => {
      const freshMemo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'MOVED' }),
          driftRow({ name: 'other/span', status: 'RESOLVED_PENDING_COMMIT' })
        ]
      });
      const paths = ['src/app.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, freshMemo);
      expect(first.decision).toBe('allow');

      // A memoState that has already recorded some unrelated digest must not
      // change this outcome — positional-only drift never denies.
      const primedMemo = createMemoryAdvisorMemoState();
      primedMemo.record('some-other-digest');
      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, primedMemo);
      expect(second.decision).toBe('allow');
    });

    it('an executor rejecting (internal/CLI error) resolves to allow/silent rather than throwing', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        drift: async (): Promise<DriftPorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        }
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('a hard scan failure (AdvisorScanError) allows with a scan-failed warning rather than reading the aborted scan as clean, even when a sibling anchor would have carried real CHANGED debt', async () => {
      // The scoped scan spans two paths; one anchor is unreadable, so the CLI
      // aborts the entire scoped query (empty stdout + an error on stderr, which
      // the default executor surfaces as a AdvisorScanError). Had the scan
      // completed, the sibling anchor would have surfaced CHANGED debt — but it
      // never ran, so an empty result here must NOT be silently read as
      // "clean" and swallowed: it allows (fail-open, matching the
      // `environmental` category), but with a distinct `scan-failed` kind and a
      // reason so the adapter can surface the warning instead of staying silent.
      const memo = createMemoryAdvisorMemoState();
      let recorded = false;
      const guardedMemo: AdvisorMemoState = {
        has: (d) => memo.has(d),
        record: (d) => {
          recorded = true;
          return memo.record(d);
        }
      };
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/sibling.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => {
          throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
        }
      });

      const result = await evaluateAdvisor(['src/app.ts', 'src/sibling.ts'], REPO_ROOT, executors, guardedMemo);

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
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        drift: async (): Promise<DriftPorcelainRow[]> => {
          throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
        }
      });

      const first = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);
      const second = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(first.decision).toBe('allow');
      expect(first.kind).toBe('scan-failed');
      expect(second.decision).toBe('allow');
      expect(second.kind).toBe('scan-failed');
    });

    it('a non-scan internal error (plain Error) still fails OPEN to allow/silent — only a scan failure fails closed', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        drift: async (): Promise<DriftPorcelainRow[]> => {
          throw new Error('spawn git ENOENT');
        }
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('a terminal/environmental status (SPARSE_EXCLUDED) fails OPEN — allow/environmental with the condition surfaced, never deny', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'SPARSE_EXCLUDED' })]
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

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
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'LFS_NOT_FETCHED', name: 'infra/anchor' }),
          driftRow({ status: 'CHANGED', name: 'billing/flow' })
        ]
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('semantic-drift');
      if (result.kind === 'semantic-drift') {
        // Only the semantic row is a finding; the environmental row is not.
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].name).toBe('billing/flow');
      }
    });

    it('a memo that cannot persist (record returns false) fails OPEN on an uncovered write rather than re-denying forever', async () => {
      // A memo whose record never persists would turn "deny once, then allow the
      // identical retry" into "deny every time" — so the advisor must fail open.
      const unwritableMemo: AdvisorMemoState = { has: () => false, record: () => false };
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(['src/uncovered.ts', 'src/other.ts'], REPO_ROOT, executors, unwritableMemo);

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('a pathspec-scoped commit scopes to the pathspec content and ignores unrelated staged debt', async () => {
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
      expect(changeset.paths).toEqual(['src/scoped.ts']);

      const executors = createFakeAdvisorExecutors({
        // The scoped path is covered and clean; the (unevaluated) debt file is not in scope.
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/scoped.ts' })],
        drift: async (paths): Promise<DriftPorcelainRow[]> =>
          paths.includes('src/debt.ts') ? [driftRow({ path: 'src/debt.ts', status: 'CHANGED' })] : []
      });

      const result = await evaluateAdvisor(changeset.paths, REPO_ROOT, executors, createMemoryAdvisorMemoState());

      expect(result.decision).toBe('allow');
    });

    it('a pathspec-scoped commit denies when the debt-carrying file IS in the pathspec', async () => {
      const parsed = parseGitCommand('git commit -m "wip" -- src/debt.ts');
      expect(parsed.paths).toEqual(['src/debt.ts']);

      const git = createFakeGitExecutor({
        pathspecPaths: async (): Promise<string[]> => ['src/debt.ts']
      });
      const changeset = await resolveChangeset('commit', false, REPO_ROOT, git, parsed.paths);

      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/debt.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ path: 'src/debt.ts', status: 'CHANGED' })]
      });

      const result = await evaluateAdvisor(changeset.paths, REPO_ROOT, executors, createMemoryAdvisorMemoState());

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('semantic-drift');
    });
  });

  // -------------------------------------------------------------------------
  // evaluateAdvisor — 'report-only' mode (git status)
  // -------------------------------------------------------------------------

  describe("evaluateAdvisor in 'report-only' mode", () => {
    it('semantic drift → allow/semantic-drift-report (never deny), and repeats identically on a second call', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const paths = ['src/app.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      expect(first.decision).toBe('allow');
      expect(first.kind).toBe('semantic-drift-report');
      if (first.kind === 'semantic-drift-report') {
        expect(first.findings).toHaveLength(1);
        expect(first.reason).toContain('This change leaves an implicit dependency out of date:');
      }

      // A status preview never memoizes, so an identical second call reports
      // the same live debt again rather than falling through to already-presented.
      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      expect(second.decision).toBe('allow');
      expect(second.kind).toBe('semantic-drift-report');
    });

    it('uncovered writes → allow/uncovered-writes-report (never deny), and repeats identically on a second call', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const first = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      expect(first.decision).toBe('allow');
      expect(first.kind).toBe('uncovered-writes-report');
      if (first.kind === 'uncovered-writes-report') {
        expect(first.uncovered).toEqual(['src/uncovered.ts', 'src/other.ts']);
      }

      const second = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only');
      expect(second.decision).toBe('allow');
      expect(second.kind).toBe('uncovered-writes-report');
    });

    it('a clean changeset → allow/silent, same as enforce mode', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo, 'report-only');

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('an environmental condition → allow/environmental, same as enforce mode', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'SPARSE_EXCLUDED' })]
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo, 'report-only');

      expect(result.decision).toBe('allow');
      expect(result.kind).toBe('environmental');
    });

    it('a hard scan failure → allow/scan-failed, same as enforce mode', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        drift: async (): Promise<DriftPorcelainRow[]> => {
          throw new AdvisorScanError('fatal: unable to read src/app.ts: Permission denied');
        }
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo, 'report-only');

      expect(result.decision).toBe('allow');
      expect(result.kind).toBe('scan-failed');
    });

    it('never reads or writes the enforce deny-credit digest directly — an inform call only ever touches the orthogonal "seen" marker', async () => {
      const digestCalls: string[] = [];
      const backing = createMemoryAdvisorMemoState();
      const spyingMemo: AdvisorMemoState = {
        has: (d) => {
          digestCalls.push(d);
          return backing.has(d);
        },
        record: (d) => {
          digestCalls.push(d);
          return backing.record(d);
        }
      };
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const paths = ['src/app.ts'];

      const informResult = await evaluateAdvisor(paths, REPO_ROOT, executors, spyingMemo, 'report-only');
      expect(informResult.decision).toBe('allow');
      // The inform pass only ever touches the orthogonal "seen" (rendering
      // verbosity) marker — never the bare deny-credit digest itself.
      expect(digestCalls.every((d) => d.startsWith('seen-'))).toBe(true);
      expect(digestCalls.length).toBeGreaterThan(0);

      // The identical debt state, now evaluated in 'may-hold' mode against the
      // very same memoState: the inform pass above did not consume the
      // digest's one-time deny credit, but it did mark the state as already
      // explained in full, so the advisor — informational, not a hard block —
      // lets it through rather than denying a state the agent has already
      // seen.
      const enforceResult = await evaluateAdvisor(paths, REPO_ROOT, executors, spyingMemo, 'may-hold');
      expect(enforceResult.decision).toBe('allow');
      expect(enforceResult.kind).toBe('already-presented');
    });

    it('the rendered reason never contains deny/retry-flavored phrasing — a status preview held nothing, so there is nothing to retry', async () => {
      const driftMemo = createMemoryAdvisorMemoState();
      const driftExecutors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const driftResult = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, driftExecutors, driftMemo, 'report-only');
      expect(driftResult.kind).toBe('semantic-drift-report');
      if (driftResult.kind === 'semantic-drift-report') {
        expect(driftResult.reason).not.toContain('then retry');
        expect(driftResult.reason).not.toContain('Otherwise retry the command to proceed');
      }

      const uncoveredMemo = createMemoryAdvisorMemoState();
      const uncoveredExecutors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const uncoveredResult = await evaluateAdvisor(
        ['src/uncovered.ts', 'src/other.ts'],
        REPO_ROOT,
        uncoveredExecutors,
        uncoveredMemo,
        'report-only'
      );
      expect(uncoveredResult.kind).toBe('uncovered-writes-report');
      if (uncoveredResult.kind === 'uncovered-writes-report') {
        expect(uncoveredResult.reason).not.toContain('Otherwise retry the command to proceed');
        expect(uncoveredResult.reason).not.toContain('one-time check');
      }
    });
  });

  describe('evaluateAdvisor — harness-specific closing instructions', () => {
    it("a semantic-drift hold with harness 'claude' directs a forked subagent and names the reconcile skill", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo, 'may-hold', undefined, 'claude');

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(result.reason).toContain(
        'Dispatch a forked subagent to bring the coupled files back into agreement (follow confirmed authority)'
      );
      expect(result.reason).toContain('Then retry.');
      expect(result.reason).toContain('Load the `git-span:reconcile` skill in the fork.');
      // The harness form replaces the generic "then reconcile" sentence, never
      // layering on top of it.
      expect(result.reason).not.toContain('then refresh');
      // Full-string pin of the complete closing: one assertion covers the exact
      // reconciliation order, retry placement, and scoped drift requirement.
      expect(result.reason).toContain(
        'Dispatch a forked subagent to bring the coupled files back into agreement (follow confirmed authority) — preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`; update or retire the why only if its meaning changed; require `git span drift billing/checkout-request-flow` to report zero. Then retry. Load the `git-span:reconcile` skill in the fork. The hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.'
      );
    });

    it('a semantic-drift hold with harness \'codex\' names `spawn_agent` with `fork_turns: "all"`', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo, 'may-hold', undefined, 'codex');

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      expect(result.reason).toContain(
        'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to bring the coupled files back into agreement (follow confirmed authority)'
      );
      expect(result.reason).toContain('Load the `git-span:reconcile` skill in the fork.');
      expect(result.reason).not.toContain('Determine if');
      // Full-string pin of the complete closing, exactly as the Codex adapter
      // ships it: `spawn_agent` with `fork_turns: "all"` leads, followed by the
      // reconciliation order, retry, and skill line.
      expect(result.reason).toContain(
        'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to bring the coupled files back into agreement (follow confirmed authority) — preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`; update or retire the why only if its meaning changed; require `git span drift billing/checkout-request-flow` to report zero. Then retry. Load the `git-span:reconcile` skill in the fork. The hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.'
      );
    });

    it("a semantic-drift hold with harness 'generic' or omitted keeps the pre-harness inline prose", async () => {
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const paths = ['src/app.ts'];

      const omitted = await evaluateAdvisor(paths, REPO_ROOT, executors, createMemoryAdvisorMemoState());
      const explicit = await evaluateAdvisor(
        paths,
        REPO_ROOT,
        executors,
        createMemoryAdvisorMemoState(),
        'may-hold',
        undefined,
        'generic'
      );

      for (const result of [omitted, explicit]) {
        expect(result.decision).toBe('hold');
        if (result.kind !== 'semantic-drift') throw new Error('unreachable');
        expect(result.reason).toContain(
          'Bring the coupled files back into agreement (follow confirmed authority), then reconcile'
        );
        // Full-string pin of the byte-identical pre-harness closing.
        expect(result.reason).toContain(
          'Bring the coupled files back into agreement (follow confirmed authority), then reconcile: preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`; update or retire the why only if its meaning changed; require `git span drift billing/checkout-request-flow` to report zero. Retry the command; the hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.'
        );
        expect(result.reason).not.toContain('forked subagent');
      }
    });

    it("a multi-span semantic-drift hold under harness 'claude' uses the plural '<name>' placeholder path", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ name: 'billing/checkout-request-flow', path: 'src/app.ts' }),
          driftRow({ name: 'payments/refund-flow', path: 'src/refund.ts' })
        ]
      });

      const result = await evaluateAdvisor(
        ['src/app.ts', 'src/refund.ts'],
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        undefined,
        'claude'
      );

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      // Two drifted spans: the lead turns plural and the action falls back to
      // the `<name>` placeholder path — both pinned here, in the closing.
      expect(result.reason).toContain('This change leaves implicit dependencies out of date:');
      expect(result.reason).toContain(
        'Dispatch a forked subagent to bring the coupled files back into agreement (follow confirmed authority) — preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`; update or retire the why only if its meaning changed; require `git span drift <name>` to report zero. Then retry. Load the `git-span:reconcile` skill in the fork. The hold will not fire again for the same debt state. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.'
      );
    });

    it("a 'report-only' status preview with harness 'claude' directs a fork but never says retry", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });

      const result = await evaluateAdvisor(
        ['src/app.ts'],
        REPO_ROOT,
        executors,
        memo,
        'report-only',
        undefined,
        'claude'
      );

      expect(result.kind).toBe('semantic-drift-report');
      if (result.kind === 'semantic-drift-report') {
        expect(result.reason).toContain('Dispatch a forked subagent to bring the coupled files back into agreement');
        expect(result.reason).toContain('Load the `git-span:reconcile` skill in the fork.');
        expect(result.reason).not.toContain('then retry');
        expect(result.reason).not.toContain('You may retry this command directly');
      }
    });

    it("a 'report-only' status preview with harness 'codex' names `spawn_agent` but never says retry", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });

      const result = await evaluateAdvisor(
        ['src/app.ts'],
        REPO_ROOT,
        executors,
        memo,
        'report-only',
        undefined,
        'codex'
      );

      expect(result.kind).toBe('semantic-drift-report');
      if (result.kind === 'semantic-drift-report') {
        // Full closing pinned: report-only omits retry and keeps the skill line.
        expect(result.reason).toContain(
          'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to bring the coupled files back into agreement (follow confirmed authority) — preserve anchor shape; if an address changed, swap the old anchor for the new one with `git span replace`; update or retire the why only if its meaning changed; require `git span drift billing/checkout-request-flow` to report zero. Load the `git-span:reconcile` skill in the fork. Conform a side only when confirmed authority or a satisfied gate decides it; report ambiguity or an obsolete dependency.'
        );
        expect(result.reason).not.toContain('then retry');
        expect(result.reason).not.toContain('You may retry this command directly');
      }
    });

    it('a whole-file semantic edit renders the bare path and keeps the preserve-shape closing — never a fabricated `#L` range', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ start: 0, end: 0 })],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED', start: 0, end: 0 })],
        listBlocks: async (): Promise<string> =>
          ['## billing/checkout-request-flow', '- src/app.ts', '', 'Why text.'].join('\n')
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      // Scenario: whole-file semantic edit. start/end of 0 is the whole-file
      // anchor, so the finding renders the bare path with zero `#L` marker —
      // a fabricated range would bias a whole-file refresh toward a new range
      // — and the closing keeps the preserve-shape rule.
      expect(result.reason).toContain('└─ src/app.ts — changed');
      expect(result.reason).not.toContain('app.ts#L');
      expect(result.reason).toContain('preserve anchor shape');
    });

    it('a same-range hash refresh renders the exact range and never suggests remove-then-add', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
        listBlocks: async (): Promise<string> =>
          ['## billing/checkout-request-flow', '- src/app.ts#L1-L10', '', 'Why text.'].join('\n')
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      // Scenario: same-range hash refresh. The logical region did not move, so
      // the message renders the exact `#L1-L10` boundaries, the closing's
      // remove-then-add stays conditional on an address change (never a
      // blanket prescription), and nothing in the message hints at movement.
      expect(result.reason).toContain('└─ src/app.ts #L1-L10 — changed');
      expect(result.reason).toContain(
        'preserve anchor shape; if an address changed, remove its old anchor before adding the new one'
      );
      expect(result.reason).not.toContain('moved');
    });

    it('a post-move CHANGED finding at the destination address renders, never the stale pre-move address', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        // The fixture's MOVED row is positional context only — MOVED is never
        // debt (isDebt('MOVED') is false), so it never annotates a bullet;
        // what renders is the CHANGED finding at the post-re-anchor address
        // (`#L3-L7`).
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'MOVED', start: 3, end: 7 }),
          driftRow({ status: 'CHANGED', start: 3, end: 7 })
        ],
        listBlocks: async (): Promise<string> =>
          ['## billing/checkout-request-flow', '- src/app.ts#L3-L7', '', 'Why text.'].join('\n')
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      // Scenario: post-move CHANGED at the destination address. The message
      // renders `#L3-L7` — the address the agent re-adds after retiring the old
      // one — never a stale `#L1-L10`, and the closing gates the removal on
      // the address change. The move event itself never renders through the
      // advisor.
      expect(result.reason).toContain('└─ src/app.ts #L3-L7 — changed');
      expect(result.reason).not.toContain('app.ts#L1-L10');
      expect(result.reason).toContain('if an address changed, remove its old anchor before adding the new one');
    });

    it('a span holding both a whole-file anchor and a range anchor on one file renders each distinctly', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ start: 0, end: 0 }), porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [
          driftRow({ status: 'CHANGED', start: 0, end: 0 }),
          driftRow({ status: 'CHANGED' })
        ],
        listBlocks: async (): Promise<string> =>
          ['## billing/checkout-request-flow', '- src/app.ts', '- src/app.ts#L1-L10', '', 'Why text.'].join('\n')
      });

      const result = await evaluateAdvisor(['src/app.ts'], REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      if (result.kind !== 'semantic-drift') throw new Error('unreachable');
      // Scenario: whole-file-plus-range duplication. Both anchors on the same
      // file render distinctly — the stacked whole-file entry keeps its
      // explicit `(whole file)` marker, the range keeps its `#L1-L10` column —
      // so the agent can see the overlap and retire the one that no longer
      // reflects the logical region.
      expect(result.reason).toContain('src/app.ts (whole file) — changed');
      expect(result.reason).toContain('#L1-L10 — changed');
    });

    it("a 'report-only' uncovered preview with harness 'codex' names `spawn_agent` and the in-fork skill line", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(
        ['src/uncovered.ts', 'src/other.ts'],
        REPO_ROOT,
        executors,
        memo,
        'report-only',
        undefined,
        'codex'
      );

      expect(result.kind).toBe('uncovered-writes-report');
      if (result.kind === 'uncovered-writes-report') {
        expect(result.reason).toContain(
          'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to determine if these files carry implicit dependencies and to then use `git span` to document them:'
        );
        expect(result.reason).toContain('Load the `git-span:git-span` skill in the fork.');
        // A status preview never held anything: no consider-once retry sentence.
        expect(result.reason).not.toContain('retry the command to proceed');
        expect(result.reason).not.toContain('skill for guidance');
      }
    });

    it("an uncovered-writes hold with harness 'claude' names the fork and swaps the skill line to 'in the fork'", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(
        ['src/uncovered.ts', 'src/other.ts'],
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        undefined,
        'claude'
      );

      expect(result.decision).toBe('hold');
      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain(
        'Dispatch a forked subagent to determine if these files carry implicit dependencies and to then use `git span` to document them:'
      );
      expect(result.reason).toContain('Load the `git-span:git-span` skill in the fork.');
      // Full-string pin of the complete closing sequence: the fork directive,
      // the two `git span` commands, the "<why>" sentence, the one-time-check
      // retry sentence, and the in-fork skill line — order and punctuation all
      // pinned as one contiguous string.
      expect(result.reason).toContain(
        [
          'Dispatch a forked subagent to determine if these files carry implicit dependencies and to then use `git span` to document them:',
          '',
          '`git span add <name> <anchor> [<anchor>] ...`  — an anchor is a path or a `path#Lstart-Lend` range',
          '`git span why <name> "<why>"`',
          '',
          'The "<why>" is one or two complete present-tense clauses stating the relationship and any decisive nonlocal authority, invariant, permitted difference, lifecycle state, evidence gate, or focused conditional verification. Labels are optional but must introduce complete clauses. Omit generic work orders and CLI procedure.',
          '',
          'If none exist, retry the command to proceed (one-time check).',
          '',
          'Load the `git-span:git-span` skill in the fork.',
          '</git-span>'
        ].join('\n')
      );
      expect(result.reason).not.toContain('skill for guidance');
    });

    it('an uncovered-writes hold with harness \'codex\' names `spawn_agent` with `fork_turns: "all"`', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(
        ['src/uncovered.ts', 'src/other.ts'],
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        undefined,
        'codex'
      );

      expect(result.decision).toBe('hold');
      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain(
        'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to determine if these files carry implicit dependencies and to then use `git span` to document them:'
      );
      expect(result.reason).toContain('Load the `git-span:git-span` skill in the fork.');
    });

    it("the singular uncovered wording holds under harness 'claude' — 'this file carries', not 'these files carry'", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(
        ['src/uncovered.ts', 'src/other.ts'],
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        undefined,
        'claude'
      );

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain(
        'Dispatch a forked subagent to determine if this file carries implicit dependencies and to then use `git span` to document them:'
      );
      expect(result.reason).not.toContain('these files carry');
    });

    it("the singular uncovered wording holds under harness 'codex' — 'this file carries', not 'these files carry'", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts' })],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      const result = await evaluateAdvisor(
        ['src/uncovered.ts', 'src/other.ts'],
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        undefined,
        'codex'
      );

      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      expect(result.reason).toContain(
        'Spawn a forked subagent with `spawn_agent`, setting `fork_turns: "all"`, to determine if this file carries implicit dependencies and to then use `git span` to document them:'
      );
      expect(result.reason).not.toContain('these files carry');
    });

    it("an uncovered-writes hold with harness 'generic' or omitted keeps the pre-harness prose", async () => {
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['src/uncovered.ts', 'src/other.ts'];

      const omitted = await evaluateAdvisor(paths, REPO_ROOT, executors, createMemoryAdvisorMemoState());
      const explicit = await evaluateAdvisor(
        paths,
        REPO_ROOT,
        executors,
        createMemoryAdvisorMemoState(),
        'may-hold',
        undefined,
        'generic'
      );

      for (const result of [omitted, explicit]) {
        expect(result.decision).toBe('hold');
        if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
        expect(result.reason).toContain(
          'Determine if these files carry implicit dependencies, then use `git span` to document them:'
        );
        expect(result.reason).toContain('Load the `git-span:git-span` skill for guidance.');
        expect(result.reason).not.toContain('forked subagent');
      }
    });

    it('the condensed already-seen forms are reminders and never read `harness`', async () => {
      // A harness-aware drift retry still condenses to the bare-path reminder.
      const driftMemo = createMemoryAdvisorMemoState();
      const driftExecutors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const driftPaths = ['src/app.ts'];
      await evaluateAdvisor(driftPaths, REPO_ROOT, driftExecutors, driftMemo, 'report-only', undefined, 'claude');
      const condensedDrift = await evaluateAdvisor(
        driftPaths,
        REPO_ROOT,
        driftExecutors,
        driftMemo,
        'report-only',
        undefined,
        'claude'
      );
      expect(condensedDrift.kind).toBe('semantic-drift-report');
      if (condensedDrift.kind === 'semantic-drift-report') {
        expect(condensedDrift.reason).toContain('Already flagged above — restore agreement');
        expect(condensedDrift.reason).not.toContain('forked subagent');
        expect(condensedDrift.reason).not.toContain('reconcile');
      }

      // A harness-aware uncovered retry still condenses to the one-line reminder.
      const uncoveredMemo = createMemoryAdvisorMemoState();
      const uncoveredExecutors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const uncoveredPaths = ['src/uncovered.ts', 'src/other.ts'];
      await evaluateAdvisor(
        uncoveredPaths,
        REPO_ROOT,
        uncoveredExecutors,
        uncoveredMemo,
        'report-only',
        undefined,
        'codex'
      );
      const condensedUncovered = await evaluateAdvisor(
        uncoveredPaths,
        REPO_ROOT,
        uncoveredExecutors,
        uncoveredMemo,
        'report-only',
        undefined,
        'codex'
      );
      expect(condensedUncovered.kind).toBe('uncovered-writes-report');
      if (condensedUncovered.kind === 'uncovered-writes-report') {
        expect(condensedUncovered.reason).toContain('Already flagged for git-span review above.');
        expect(condensedUncovered.reason).not.toContain('forked subagent');
        expect(condensedUncovered.reason).not.toContain('skill for guidance');
      }
    });

    it('a may-hold retry under any harness resolves allow/already-presented with no reason — unchanged from generic', async () => {
      const driftExecutors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
        drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
      });
      const uncoveredExecutors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });

      for (const harness of ['generic', 'claude', 'codex'] as const) {
        // The first may-hold pass holds with the harness-specific closing; the
        // retry on the same debt state collapses to the harness-free
        // allow/already-presented decision — the condensed decision never
        // reads `harness`.
        const driftMemo = createMemoryAdvisorMemoState();
        const firstDrift = await evaluateAdvisor(
          ['src/app.ts'],
          REPO_ROOT,
          driftExecutors,
          driftMemo,
          'may-hold',
          undefined,
          harness
        );
        expect(firstDrift.decision).toBe('hold');
        expect(
          await evaluateAdvisor(['src/app.ts'], REPO_ROOT, driftExecutors, driftMemo, 'may-hold', undefined, harness)
        ).toEqual({ decision: 'allow', kind: 'already-presented' });

        const uncoveredMemo = createMemoryAdvisorMemoState();
        const firstUncovered = await evaluateAdvisor(
          ['src/uncovered.ts', 'src/other.ts'],
          REPO_ROOT,
          uncoveredExecutors,
          uncoveredMemo,
          'may-hold',
          undefined,
          harness
        );
        expect(firstUncovered.decision).toBe('hold');
        expect(
          await evaluateAdvisor(
            ['src/uncovered.ts', 'src/other.ts'],
            REPO_ROOT,
            uncoveredExecutors,
            uncoveredMemo,
            'may-hold',
            undefined,
            harness
          )
        ).toEqual({ decision: 'allow', kind: 'already-presented' });
      }
    });

    it('a churn-suppressed uncovered hold still renders the harness closing (harness × churn)', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const git = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => [
          {
            path: 'package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          },
          {
            path: 'src/app.ts',
            binary: false,
            structural: false,
            hunks: [{ removed: ['const x = 1;'], added: ['const x = 2;'] }]
          }
        ]
      });
      const paths = ['package.json', 'src/app.ts'];

      const result = await evaluateAdvisor(
        paths,
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        { git, range: { kind: 'staged' } },
        'claude'
      );

      expect(result.decision).toBe('hold');
      if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
      // Churn suppression shrank the uncovered set to the semantic file; the
      // hold still renders the harness's fork direction.
      expect(result.uncovered).toEqual(['src/app.ts']);
      expect(result.reason).toContain(
        'Dispatch a forked subagent to determine if this file carries implicit dependencies and to then use `git span` to document them:'
      );
      expect(result.reason).toContain('Load the `git-span:git-span` skill in the fork.');
    });
  });

  // -------------------------------------------------------------------------
  // mechanical-churn suppression
  //
  // `evaluateAdvisor`'s `churn` parameter carries the suppression surface
  // (git + range), consumed by `computeUncoveredPaths` to drop mechanical-only
  // hunks from the uncovered set. These checks fake `changedHunks` the same
  // way the other four GitExecutor methods are faked above, and all run live.
  // -------------------------------------------------------------------------

  describe('evaluateAdvisor — mechanical-churn suppression', () => {
    it('an all-mechanical uncovered set resolves to allow/silent', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const git = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => [
          {
            path: 'package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          },
          {
            path: 'packages/foo/package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          }
        ]
      });
      const paths = ['package.json', 'packages/foo/package.json'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold', {
        git,
        range: { kind: 'staged' }
      });

      expect(result).toEqual({ decision: 'allow', kind: 'silent' });
    });

    it('a mixed set surfaces only the semantic path in uncovered', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const git = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => [
          {
            path: 'package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          },
          {
            path: 'src/app.ts',
            binary: false,
            structural: false,
            hunks: [{ removed: ['const x = 1;'], added: ['const x = 2;'] }]
          }
        ]
      });
      const paths = ['package.json', 'src/app.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold', {
        git,
        range: { kind: 'staged' }
      });

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('uncovered-writes');
      if (result.kind === 'uncovered-writes') {
        expect(result.uncovered).toEqual(['src/app.ts']);
      }
    });

    it('an unbalanced hunk (a genuine semantic edit next to version churn) leaves the path flagged', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const git = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => [
          {
            path: 'packages/extension/package.json',
            binary: false,
            structural: false,
            hunks: [
              {
                removed: ['  "version": "1.0.140",'],
                added: ['  "version":', '    "1.0.141",', '  "extra": true,', '  "another": 1,', '  "more": 2,']
              }
            ]
          }
        ]
      });
      const paths = ['packages/extension/package.json'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold', {
        git,
        range: { kind: 'staged' }
      });

      // A single-file changeset never denies on uncovered writes (no
      // cross-file coupling to check) — the assertion here is that this
      // classification did not silently make the file disappear the way an
      // all-mechanical verdict would; a second, multi-file case pins it.
      expect(result.decision).toBe('allow');
    });

    it('when changedHunks throws, all paths in the uncovered set stay flagged (fail toward reporting)', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const git = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => {
          throw new Error('git diff failed');
        }
      });
      const paths = ['package.json', 'src/app.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold', {
        git,
        range: { kind: 'staged' }
      });

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('uncovered-writes');
      if (result.kind === 'uncovered-writes') {
        expect(result.uncovered).toEqual(['package.json', 'src/app.ts']);
      }
    });

    it("omitting churn entirely leaves all paths flagged — today's behavior, unchanged", async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const paths = ['package.json', 'src/app.ts'];

      const result = await evaluateAdvisor(paths, REPO_ROOT, executors, memo);

      expect(result.decision).toBe('hold');
      expect(result.kind).toBe('uncovered-writes');
      if (result.kind === 'uncovered-writes') {
        expect(result.uncovered).toEqual(['package.json', 'src/app.ts']);
      }
    });

    it(// Digest purity: a suppressed (mechanical) file must not reach
    // advisorStateDigest, so two changesets differing only in their
    // mechanical files produce the same digest. Asserted through the memo
    // rather than by calling advisorStateDigest directly (it is not
    // exported): evaluate the first changeset (records the digest), then
    // the second against the *same* memoState — it must read as
    // already-presented rather than denying fresh.
    'two changesets differing only in their mechanical files share the same advisor-state digest', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      const gitA = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => [
          {
            path: 'package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          },
          {
            path: 'src/app.ts',
            binary: false,
            structural: false,
            hunks: [{ removed: ['const x = 1;'], added: ['const x = 2;'] }]
          }
        ]
      });
      const gitB = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => [
          {
            path: 'packages/foo/package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          },
          {
            path: 'src/app.ts',
            binary: false,
            structural: false,
            hunks: [{ removed: ['const x = 1;'], added: ['const x = 2;'] }]
          }
        ]
      });

      const first = await evaluateAdvisor(['package.json', 'src/app.ts'], REPO_ROOT, executors, memo, 'may-hold', {
        git: gitA,
        range: { kind: 'staged' }
      });
      expect(first.decision).toBe('hold');

      // A different mechanical file (packages/foo/package.json instead of
      // package.json), same semantic file, same memoState — same digest.
      const second = await evaluateAdvisor(
        ['packages/foo/package.json', 'src/app.ts'],
        REPO_ROOT,
        executors,
        memo,
        'may-hold',
        { git: gitB, range: { kind: 'staged' } }
      );

      expect(second).toEqual({ decision: 'allow', kind: 'already-presented' });
    });

    // The two checks below pin the interaction the memo digest has with a failed
    // hunk read, which is where a read failure stops being merely a lost
    // suppression and starts *undoing* a mitigation the design built on purpose.
    // The digest is keyed on the post-filter uncovered set, so a file left in
    // the list because its diff could not be read reaches the digest and mints a
    // new one. A `git status` that suppressed churn followed by a `git commit`
    // whose diff read failed therefore looks like an unseen debt state and holds
    // — re-presenting, in full, the wall the agent already acknowledged in
    // filtered form moments earlier. `wasAlreadySeen`'s doc names that exact
    // status→commit sequence as the thing it exists to prevent.
    //
    // Both failure shapes are covered because both are reachable and they take
    // different code paths into the same outcome: production reaches the *empty*
    // one (an over-1MiB diff throws `ENOBUFS` inside `gitText`, which returns
    // `''`, so `changedHunks` resolves to `[]`), while a throw exercises
    // `computeUncoveredPaths`' `catch` arm.
    const failedReadCases: { label: string; failingRead: () => Promise<FileDiff[]> }[] = [
      { label: 'resolves empty (the ENOBUFS-through-gitText path production takes)', failingRead: async () => [] },
      {
        label: 'throws',
        failingRead: async () => {
          throw new Error('ENOBUFS');
        }
      }
    ];

    for (const { label, failingRead } of failedReadCases) {
      it(`a status preview then a commit whose batched hunk read ${label} still reads as already-presented`, async () => {
        const memo = createMemoryAdvisorMemoState();
        const executors = createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => []
        });
        const paths = ['package.json', 'src/app.ts'];
        const hunks: FileDiff[] = [
          {
            path: 'package.json',
            binary: false,
            structural: false,
            hunks: [{ removed: ['  "version": "1.0.140",'], added: ['  "version": "1.0.141",'] }]
          },
          {
            path: 'src/app.ts',
            binary: false,
            structural: false,
            hunks: [{ removed: ['const x = 1;'], added: ['const x = 2;'] }]
          }
        ];

        // Only the *second* invocation fails — the batched read the `git commit`
        // issues. Everything after it is the per-file fallback, which is what
        // keeps one oversized file from costing the whole changeset its
        // classification; a fake that failed forever would assert the absence of
        // that fallback instead of its presence.
        let call = 0;
        const git = createFakeGitExecutor({
          changedHunks: async (requested: string[]): Promise<FileDiff[]> => {
            call++;
            if (call === 2) return failingRead();
            return hunks.filter((file) => requested.includes(file.path));
          }
        });

        const preview = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'report-only', {
          git,
          range: { kind: 'worktree' }
        });
        expect(preview.kind).toBe('uncovered-writes-report');
        if (preview.kind === 'uncovered-writes-report') {
          expect(preview.uncovered).toEqual(['src/app.ts']);
        }

        // Second call (the `git commit` moments later): the batched read fails,
        // so the per-file fallback re-reads each path on its own. The fallback
        // read fails the same way here, so nothing is classified — but the state
        // the agent has already been shown must not be re-presented as new.
        const commit = await evaluateAdvisor(paths, REPO_ROOT, executors, memo, 'may-hold', {
          git,
          range: { kind: 'worktree' }
        });

        expect(commit).toEqual({ decision: 'allow', kind: 'already-presented' });
      });
    }

    it('a lockfile is suppressed by path shape alone, even when the hunk read fails entirely', async () => {
      const memo = createMemoryAdvisorMemoState();
      const executors = createFakeAdvisorExecutors({
        list: async (): Promise<PorcelainRow[]> => [],
        drift: async (): Promise<DriftPorcelainRow[]> => []
      });
      // Every read fails, batched and per-file alike: the category layer must
      // reach its verdict from the path, before any diff is requested.
      const git = createFakeGitExecutor({
        changedHunks: async (): Promise<FileDiff[]> => {
          throw new Error('git diff failed');
        }
      });

      const result = await evaluateAdvisor(['yarn.lock', 'src/app.ts'], REPO_ROOT, executors, memo, 'may-hold', {
        git,
        range: { kind: 'staged' }
      });

      expect(result.kind).toBe('uncovered-writes');
      if (result.kind === 'uncovered-writes') {
        expect(result.uncovered).toEqual(['src/app.ts']);
      }
    });

    // The hoisted predicate decides path-suppression in production, and every
    // other assertion about it exercises the classifier's functions directly.
    // These pin it *here*, because the two failure directions it guards are
    // both silent: widening it re-silences a hand-authored build script with no
    // diff ever read, and narrowing it re-reports generated output the card
    // assigns to the category layer. Neither shows up anywhere downstream.
    const hoistCases: { label: string; path: string; reported: boolean }[] = [
      { label: 'a lockfile is suppressed', path: 'yarn.lock', reported: false },
      { label: 'a sourcemap is suppressed', path: 'web/static/b.js.map', reported: false },
      { label: 'a minified bundle is suppressed', path: 'web/static/b.min.js', reported: false },
      { label: 'a vendored file is suppressed', path: 'node_modules/dep/index.js', reported: false },
      {
        label: 'a hand-authored script under build/ is reported',
        path: 'packages/extension/scripts/build/build-production.js',
        reported: true
      },
      {
        label: 'an unminified bundle is reported',
        path: 'plugins-claude/git-span/hooks/bin/advisor.mjs',
        reported: true
      },
      { label: 'a tracked log is reported', path: 'test/fixtures/sample.log', reported: true }
    ];

    for (const { label, path, reported } of hoistCases) {
      it(`path-shape suppression at the call site: ${label}`, async () => {
        const memo = createMemoryAdvisorMemoState();
        const executors = createFakeAdvisorExecutors({
          list: async (): Promise<PorcelainRow[]> => [],
          drift: async (): Promise<DriftPorcelainRow[]> => []
        });
        // No diff is ever available — the exact no-diff-read path where the
        // per-file fallback's `if (!file) return true` is the only other guard.
        // Whatever survives here was decided by path shape and nothing else.
        const git = createFakeGitExecutor({ changedHunks: async (): Promise<FileDiff[]> => [] });

        // `src/app.ts` is a companion, not decoration: `computeUncoveredPaths`
        // short-circuits a changeset of fewer than two paths, since a coupling
        // needs two files to exist. A one-path probe of this predicate reports
        // `silent` for every input and would pass while asserting nothing.
        const result = await evaluateAdvisor([path, 'src/app.ts'], REPO_ROOT, executors, memo, 'may-hold', {
          git,
          range: { kind: 'staged' }
        });

        expect(result.kind).toBe('uncovered-writes');
        if (result.kind === 'uncovered-writes') {
          expect(result.uncovered).toEqual(reported ? [path, 'src/app.ts'] : ['src/app.ts']);
        }
      });
    }
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

  describe('buildHunkReadArgs', () => {
    // The content read is the classifier's only source of diff text, and
    // parseUnifiedDiff anchors on a header dialect git does not guarantee: four
    // ordinary personal settings (diff.noprefix, diff.mnemonicPrefix,
    // color.ui=always, diff.external) each rewrite it, at which point every path
    // parses to nothing and churn suppression silently ceases to exist. Nothing
    // errors, so these assertions are the only thing standing between that and a
    // green suite.
    //
    // Each flag is asserted on its own rather than as a whole-argv snapshot: a
    // snapshot fails on any unrelated argv edit and gets re-recorded, which is
    // how a pin like this stops pinning anything.
    for (const flag of ['--no-ext-diff', '--no-color', '--src-prefix=a/', '--dst-prefix=b/']) {
      it(`pins ${flag} against the reader's own git config`, () => {
        expect(buildHunkReadArgs('/repo', { kind: 'staged' }, ['a.ts'])).toContain(flag);
      });
    }

    it('runs the read at the repo root so diff.relative cannot rewrite paths', () => {
      // Unlike the four flags above there is no --no-relative to ask for; `-C
      // repoRoot` is what neutralizes diff.relative, so it is load-bearing for
      // the same reason and equally invisible if dropped.
      expect(buildHunkReadArgs('/repo', { kind: 'staged' }, ['a.ts']).slice(0, 2)).toEqual(['-C', '/repo']);
    });

    it('selects the range git actually needs for each changeset kind', () => {
      expect(buildHunkReadArgs('/repo', { kind: 'staged' }, ['a.ts'])).toContain('--cached');
      expect(buildHunkReadArgs('/repo', { kind: 'worktree' }, ['a.ts'])).toContain('HEAD');
      expect(buildHunkReadArgs('/repo', { kind: 'commits', base: 'origin/main' }, ['a.ts'])).toContain(
        'origin/main..HEAD'
      );
    });

    it('separates pathspecs with -- so a path can never be read as a revision', () => {
      const args = buildHunkReadArgs('/repo', { kind: 'staged' }, ['app/[slug]/page.tsx', 'HEAD']);
      expect(args.slice(args.indexOf('--') + 1)).toEqual(['app/[slug]/page.tsx', 'HEAD']);
    });
  });
});

// ---------------------------------------------------------------------------
// Fail-closed anchor rendering
// ---------------------------------------------------------------------------

/**
 * `evaluateAdvisor` builds `reason: renderDriftReason(...)` *inline* inside
 * its own `try`, and its outer catch resolves any uncaught error to
 * `{ decision: 'allow', kind: 'silent' }`. So an exception escaping the tree
 * renderer would not degrade to a flat list — it would bypass the
 * `decision: 'hold'` construction entirely and silently allow a commit that
 * should have been held. These checks pin the catch that forecloses that, by
 * replacing the shared renderer with one that always throws.
 *
 * The module is stubbed rather than fed malformed input on purpose:
 * `renderAnchorTree` is documented as total for any well-formed `TreeAnchor[]`
 * and the call sites can only build well-formed ones, so a *future* defect in
 * the renderer is the failure being guarded against, and injecting one at the
 * module seam is the only honest way to reach it.
 */
describe('fail-closed anchor rendering', () => {
  afterEach(() => {
    vi.doUnmock('../../src/common/anchor-tree.js');
    vi.resetModules();
  });

  /** Reload advisor-core against a `renderAnchorTree` that always throws. */
  async function withThrowingRenderer(): Promise<typeof import('../../src/common/advisor-core.js')> {
    vi.resetModules();
    vi.doMock('../../src/common/anchor-tree.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/common/anchor-tree.js')>()),
      renderAnchorTree: (): string[] => {
        throw new Error('injected tree-renderer defect');
      }
    }));
    return import('../../src/common/advisor-core.js');
  }

  it('still holds — with a flat-bullet reason — when the tree renderer throws', async () => {
    const { evaluateAdvisor: evaluate } = await withThrowingRenderer();
    const executors = createFakeAdvisorExecutors({
      list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
      drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })],
      listBlocks: async (): Promise<string> => ['## billing/checkout-request-flow', '- src/app.ts#L1-L10'].join('\n')
    });

    const result = await evaluate(['src/app.ts'], REPO_ROOT, executors, createMemoryAdvisorMemoState());

    // The gate is unaffected: a rendering defect costs an uglier message, never
    // a missed hold.
    expect(result.decision).toBe('hold');
    expect(result.kind).toBe('semantic-drift');
    if (result.kind !== 'semantic-drift') throw new Error('unreachable');
    expect(result.reason).toContain('- src/app.ts#L1-L10 — changed');
    expect(result.reason).not.toContain('└─');
  });

  it('degrades the related-spans section to flat bullets rather than losing the uncovered-writes hold', async () => {
    const { evaluateAdvisor: evaluate } = await withThrowingRenderer();
    const executors = createFakeAdvisorExecutors({
      list: async (): Promise<PorcelainRow[]> => [porcelainRow({ path: 'src/other.ts', start: 5, end: 20 })],
      drift: async (): Promise<DriftPorcelainRow[]> => []
    });

    const result = await evaluate(
      ['src/uncovered.ts', 'src/other.ts'],
      REPO_ROOT,
      executors,
      createMemoryAdvisorMemoState()
    );

    expect(result.decision).toBe('hold');
    if (result.kind !== 'uncovered-writes') throw new Error('unreachable');
    expect(result.reason).toContain('- src/other.ts#L5-L20');
    expect(result.reason).not.toContain('└─');
  });

  it('degrades the condensed `alreadySeen` retry to a flat path list rather than throwing', async () => {
    const { evaluateAdvisor: evaluate } = await withThrowingRenderer();
    const memo = createMemoryAdvisorMemoState();
    const executors = createFakeAdvisorExecutors({
      list: async (): Promise<PorcelainRow[]> => [porcelainRow()],
      drift: async (): Promise<DriftPorcelainRow[]> => [driftRow({ status: 'CHANGED' })]
    });

    await evaluate(['src/app.ts'], REPO_ROOT, executors, memo, 'report-only');
    const condensed = await evaluate(['src/app.ts'], REPO_ROOT, executors, memo, 'report-only');

    if (condensed.kind !== 'semantic-drift-report') throw new Error('unreachable');
    expect(condensed.reason).toContain('- src/app.ts');
    expect(condensed.reason).not.toContain('└─');
  });
});
