/**
 * Real (unskipped) tests for src/signals/release-tag-delta.ts.
 *
 * Uses real fixture repos (built directly here, plus the three shared
 * degenerate-repo builders) rather than fakes, since the signal reads through
 * RepoContext's real git-backed accessors and shells out to `git tag`/`git
 * diff` via src/git.ts.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../../src/prefilter.js';
import releaseTagDeltaSignal from '../../src/signals/release-tag-delta.js';
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

function writeAndCommit(dir: string, files: Record<string, string>, message: string): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', message]);
}

function tag(dir: string, name: string): void {
  git(dir, ['tag', name]);
}

describe('release-tag-delta signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-release-tag-delta-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('groups two files that co-change across multiple consecutive tag intervals', async () => {
    writeAndCommit(repoRoot, { 'a.ts': 'v0\n', 'b.ts': 'v0\n', 'unrelated.ts': 'v0\n' }, 'Initial commit');
    tag(repoRoot, 'v1');

    // Interval v1..v2: a.ts and b.ts both change together.
    writeAndCommit(repoRoot, { 'a.ts': 'v1\n', 'b.ts': 'v1\n' }, 'Update a and b');
    tag(repoRoot, 'v2');

    // Interval v2..v3: a.ts and b.ts change together again; unrelated.ts changes alone.
    writeAndCommit(repoRoot, { 'a.ts': 'v2\n', 'b.ts': 'v2\n', 'unrelated.ts': 'v1\n' }, 'Update a, b, and unrelated');
    tag(repoRoot, 'v3');

    const ctx = createRepoContext(repoRoot);
    const groups = await releaseTagDeltaSignal(ctx);

    expect(groups.length).toBeGreaterThan(0);

    const abPair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    expect(abPair).toBeDefined();
    expect(abPair?.evidence).toHaveLength(1);
    expect(abPair?.evidence[0].signal).toBe('release-tag-delta');
    expect(abPair?.evidence[0].strength).toBeGreaterThan(0);
    expect(abPair?.evidence[0].strength).toBeLessThanOrEqual(1);
    expect(abPair?.evidence[0].tags).toEqual(['v2', 'v3']);
    expect(abPair?.score).toBe(abPair?.evidence[0].strength);
    // Whole-file anchors: tag-interval deltas don't carry hunk granularity.
    for (const anchor of abPair?.anchors ?? []) {
      expect(anchor.startLine).toBeUndefined();
      expect(anchor.endLine).toBeUndefined();
    }

    // unrelated.ts only co-occurred with a.ts/b.ts in one interval (v2..v3) —
    // below the minimum-co-occurrence threshold, so it must not be grouped.
    const unrelatedPair = groups.find((group) => group.anchors.some((anchor) => anchor.path === 'unrelated.ts'));
    expect(unrelatedPair).toBeUndefined();
  });

  it('produces no groups when there are fewer than two tags', async () => {
    writeAndCommit(repoRoot, { 'a.ts': 'v0\n' }, 'Initial commit');
    tag(repoRoot, 'only-tag');

    const ctx = createRepoContext(repoRoot);
    const groups = await releaseTagDeltaSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('returns [] (never throws or NaN) against a repo with commits but zero tags', async () => {
    // Design decision 9: release-tag-delta is the signal a tagless repo hits
    // directly — a dedicated assertion beyond the shared three-fixture run.
    writeAndCommit(repoRoot, { 'a.ts': 'v0\n' }, 'First commit');
    writeAndCommit(repoRoot, { 'a.ts': 'v1\n' }, 'Second commit');

    const ctx = createRepoContext(repoRoot);
    const groups = await releaseTagDeltaSignal(ctx);
    expect(groups).toEqual([]);
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['no-tags-repo', buildNoTagsRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws or NaN) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await releaseTagDeltaSignal(ctx);
    expect(groups).toEqual([]);
  });
});
