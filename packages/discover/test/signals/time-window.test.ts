/**
 * Real (unskipped) tests for src/signals/time-window.ts.
 *
 * Uses real fixture repos with author/committer dates pinned via
 * GIT_AUTHOR_DATE/GIT_COMMITTER_DATE, so the 6h window's boundary can be
 * tested deterministically instead of racing real wall-clock commit times.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../../src/prefilter.js';
import timeWindowSignal from '../../src/signals/time-window.js';
import { buildNoTagsRepo, buildShallowCloneRepo, buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture Builder']);
}

/** Commits `files` at a specific, deterministic author/committer date (ISO 8601). */
function writeAndCommitAt(dir: string, files: Record<string, string>, message: string, isoDate: string): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, ['add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '--quiet', '-m', message], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
  });
}

const T0 = '2024-01-01T00:00:00+00:00';
const T0_PLUS_2H = '2024-01-01T02:00:00+00:00';
const T0_PLUS_7H = '2024-01-01T07:00:00+00:00';

describe('time-window signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-time-window-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('pairs hunks edited within a 6h window into a range-anchored AnchorGroup', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n' }, 'Add a.ts', T0);
    writeAndCommitAt(repoRoot, { 'b.ts': 'line1\n' }, 'Add b.ts', T0_PLUS_2H);

    const ctx = createRepoContext(repoRoot);
    const groups = await timeWindowSignal(ctx);

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.anchors).toHaveLength(2);
    const paths = group.anchors.map((anchor) => anchor.path).sort();
    expect(paths).toEqual(['a.ts', 'b.ts']);

    // Range-anchored, not whole-file: both anchors carry the hunk's actual
    // line range (each file here is a one-line add, so 1-1).
    for (const anchor of group.anchors) {
      expect(anchor.startLine).toBe(1);
      expect(anchor.endLine).toBe(1);
    }

    expect(group.evidence).toHaveLength(1);
    const [evidence] = group.evidence;
    expect(evidence.signal).toBe('time-window-co-edit');
    expect(evidence.strength).toBeGreaterThan(0);
    expect(evidence.strength).toBeLessThanOrEqual(1);
    expect(evidence.commits).toHaveLength(2);
    expect(group.score).toBe(evidence.strength);
  });

  it('does not pair hunks whose edits are more than 6h apart', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n' }, 'Add a.ts', T0);
    writeAndCommitAt(repoRoot, { 'c.ts': 'line1\n' }, 'Add c.ts', T0_PLUS_7H);

    const ctx = createRepoContext(repoRoot);
    const groups = await timeWindowSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('windows are unchained/overlapping: a middle edit can pair with both an earlier and a later edit', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n' }, 'Add a.ts', T0);
    writeAndCommitAt(repoRoot, { 'b.ts': 'line1\n' }, 'Add b.ts', T0_PLUS_2H);
    writeAndCommitAt(repoRoot, { 'c.ts': 'line1\n' }, 'Add c.ts', T0_PLUS_7H);

    const ctx = createRepoContext(repoRoot);
    const groups = await timeWindowSignal(ctx);

    // a-b (2h apart, inside a's window) and b-c (5h apart, inside b's window)
    // both form groups; a-c (7h apart) does not — b.ts's edit appears in two
    // overlapping groups, proving windows aren't a partition.
    expect(groups).toHaveLength(2);
    const pairKeys = groups
      .map((group) =>
        group.anchors
          .map((anchor) => anchor.path)
          .sort()
          .join('+')
      )
      .sort();
    expect(pairKeys).toEqual(['a.ts+b.ts', 'b.ts+c.ts']);

    const bGroups = groups.filter((group) => group.anchors.some((anchor) => anchor.path === 'b.ts'));
    expect(bGroups).toHaveLength(2);
  });

  it('never pairs two hunks from the same commit — co-change within one commit is not "implicit"', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n', 'b.ts': 'line1\n' }, 'Add both together', T0);

    const ctx = createRepoContext(repoRoot);
    const groups = await timeWindowSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('produces no groups when there is only one edit in history', async () => {
    writeAndCommitAt(repoRoot, { 'only.ts': 'line1\n' }, 'Single file', T0);

    const ctx = createRepoContext(repoRoot);
    const groups = await timeWindowSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('returns [] against the single-commit-repo degenerate fixture (one commit has no "other commit" to pair with)', async () => {
    const ctx = createRepoContext(buildSingleCommitRepo());
    const groups = await timeWindowSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('returns [] against the shallow-clone-repo degenerate fixture (depth-1 clone exposes only one commit)', async () => {
    const ctx = createRepoContext(buildShallowCloneRepo());
    const groups = await timeWindowSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('never throws or produces NaN against the no-tags-repo degenerate fixture', async () => {
    // Unlike single-commit-repo and shallow-clone-repo, no-tags-repo's three
    // commits are genuinely distinct commits touching two different files —
    // real edits, not a degenerate absence of history. Built with real
    // wall-clock commit times, they land inside one another's 6h window,
    // which is exactly the (correct) case this signal exists to catch, so
    // asserting a literal `[]` here would mean crippling the signal to fit a
    // test rather than reflecting its real, intended behavior. What design
    // decision 9 actually guarantees — no throw, no NaN, a well-formed
    // AnchorGroup[] — is asserted directly instead.
    const ctx = createRepoContext(buildNoTagsRepo());
    const groups = await timeWindowSignal(ctx);
    expect(Array.isArray(groups)).toBe(true);
    for (const group of groups) {
      expect(Number.isFinite(group.score)).toBe(true);
      expect(group.score).toBeGreaterThanOrEqual(0);
      expect(group.score).toBeLessThanOrEqual(1);
      for (const evidence of group.evidence) {
        expect(Number.isFinite(evidence.strength)).toBe(true);
      }
    }
  });
});
