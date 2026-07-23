/**
 * Real (unskipped) tests for src/signals/association-rules.ts.
 *
 * Uses real fixture repos (built directly here, plus the three shared
 * degenerate-repo builders) rather than fakes, since the signal reads
 * through RepoContext's real git-backed accessors.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../../src/prefilter.js';
import associationRulesSignal from '../../src/signals/association-rules.js';
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

describe('association-rules signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-association-rules-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('groups a pair of files that always change together with high support and confidence', async () => {
    // a.ts and b.ts co-change in every one of 4 commits: support = 4/4 = 1,
    // confidence in both directions = 4/4 = 1.
    writeAndCommit(repoRoot, { 'a.ts': 'v1\n', 'b.ts': 'v1\n' }, 'Initial commit');
    writeAndCommit(repoRoot, { 'a.ts': 'v2\n', 'b.ts': 'v2\n' }, 'Second commit');
    writeAndCommit(repoRoot, { 'a.ts': 'v3\n', 'b.ts': 'v3\n' }, 'Third commit');
    writeAndCommit(repoRoot, { 'a.ts': 'v4\n', 'b.ts': 'v4\n' }, 'Fourth commit');

    const ctx = createRepoContext(repoRoot);
    const groups = await associationRulesSignal(ctx);

    expect(groups.length).toBe(1);
    const group = groups[0];
    const paths = group.anchors.map((anchor) => anchor.path);
    expect(paths).toEqual(expect.arrayContaining(['a.ts', 'b.ts']));
    expect(group.anchors.every((anchor) => anchor.startLine === undefined && anchor.endLine === undefined)).toBe(true);
    expect(group.evidence).toHaveLength(1);
    expect(group.evidence[0].signal).toBe('association-rules');
    expect(group.evidence[0].strength).toBe(1);
    expect(group.score).toBe(1);
    expect(group.evidence[0].commits).toHaveLength(4);
    expect(group.evidence[0].detail).toContain('support=1.000');
    expect(group.evidence[0].detail).toContain('confidence(a.ts -> b.ts)=1.000');
    expect(group.evidence[0].detail).toContain('confidence(b.ts -> a.ts)=1.000');
  });

  it('computes asymmetric confidence when one file changes far more often than its co-changing partner', async () => {
    // shared.ts changes in every commit; frequent.ts changes on its own in
    // several additional commits. confidence(shared -> frequent) is high
    // (every shared.ts commit also touches frequent.ts), but
    // confidence(frequent -> shared) is much lower since frequent.ts changes
    // alone most of the time.
    writeAndCommit(repoRoot, { 'shared.ts': 'v1\n', 'frequent.ts': 'v1\n' }, 'Commit 1');
    writeAndCommit(repoRoot, { 'shared.ts': 'v2\n', 'frequent.ts': 'v2\n' }, 'Commit 2');
    writeAndCommit(repoRoot, { 'frequent.ts': 'v3\n' }, 'Commit 3');
    writeAndCommit(repoRoot, { 'frequent.ts': 'v4\n' }, 'Commit 4');
    writeAndCommit(repoRoot, { 'frequent.ts': 'v5\n' }, 'Commit 5');
    writeAndCommit(repoRoot, { 'frequent.ts': 'v6\n' }, 'Commit 6');

    const ctx = createRepoContext(repoRoot);
    const groups = await associationRulesSignal(ctx);

    // support = 2/6 = 0.333 (above MIN_SUPPORT), and confidence(shared ->
    // frequent) = 2/2 = 1 clears MIN_CONFIDENCE even though confidence
    // (frequent -> shared) = 2/6 = 0.333 does not — the signal reports the
    // pair because at least one direction is a strong rule.
    expect(groups.length).toBe(1);
    const group = groups[0];
    expect(group.evidence[0].detail).toContain('confidence(frequent.ts -> shared.ts)=0.333');
    expect(group.evidence[0].detail).toContain('confidence(shared.ts -> frequent.ts)=1.000');
    expect(group.score).toBe(1);
  });

  it('does not group files whose co-occurrence support is too low', async () => {
    // a.ts and b.ts co-occur in exactly one commit out of many unrelated
    // commits: support is far below MIN_SUPPORT.
    writeAndCommit(repoRoot, { 'a.ts': 'v1\n', 'b.ts': 'v1\n' }, 'Commit 1');
    for (let i = 0; i < 15; i++) {
      writeAndCommit(repoRoot, { [`unrelated-${i}.ts`]: 'v1\n' }, `Unrelated commit ${i}`);
    }

    const ctx = createRepoContext(repoRoot);
    const groups = await associationRulesSignal(ctx);

    const pair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    expect(pair).toBeUndefined();
  });

  it('produces no groups when there is only one file in history', async () => {
    writeAndCommit(repoRoot, { 'only.ts': 'v1\n' }, 'Add the only file');

    const ctx = createRepoContext(repoRoot);
    const groups = await associationRulesSignal(ctx);
    expect(groups).toEqual([]);
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['no-tags-repo', buildNoTagsRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws or NaN) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await associationRulesSignal(ctx);
    expect(groups).toEqual([]);
  });
});
