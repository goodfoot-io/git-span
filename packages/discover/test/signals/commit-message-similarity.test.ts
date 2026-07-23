/**
 * Real (unskipped) tests for src/signals/commit-message-similarity.ts.
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
import commitMessageSimilaritySignal from '../../src/signals/commit-message-similarity.js';
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

describe('commit-message-similarity signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-commit-message-similarity-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('groups two files whose commit messages share a lexical vocabulary', async () => {
    writeAndCommit(repoRoot, { 'retry.ts': 'v1\n' }, 'retry backoff');
    writeAndCommit(repoRoot, { 'retry.ts': 'v2\n' }, 'retry backoff');
    writeAndCommit(repoRoot, { 'retry-consumer.ts': 'v1\n' }, 'retry backoff');
    writeAndCommit(repoRoot, { 'retry-consumer.ts': 'v2\n' }, 'retry backoff');
    writeAndCommit(repoRoot, { 'unrelated.ts': 'v1\n' }, 'currency format');
    writeAndCommit(repoRoot, { 'unrelated.ts': 'v2\n' }, 'currency format');

    const ctx = createRepoContext(repoRoot);
    const groups = await commitMessageSimilaritySignal(ctx);

    expect(groups.length).toBeGreaterThan(0);

    const retryPair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('retry.ts') && paths.includes('retry-consumer.ts');
    });
    expect(retryPair).toBeDefined();
    expect(retryPair?.evidence).toHaveLength(1);
    expect(retryPair?.evidence[0].signal).toBe('lexical-similarity');
    expect(retryPair?.evidence[0].strength).toBeGreaterThan(0);
    expect(retryPair?.evidence[0].strength).toBeLessThanOrEqual(1);
    expect(retryPair?.score).toBe(retryPair?.evidence[0].strength);
    expect(retryPair?.evidence[0].commits?.length).toBeGreaterThan(0);

    // The currency formatter's commit messages share essentially no
    // vocabulary with the retry files' commit messages — it must not be
    // grouped with either of them.
    const unrelatedPair = groups.find((group) => group.anchors.some((anchor) => anchor.path === 'unrelated.ts'));
    expect(unrelatedPair).toBeUndefined();
  });

  it('documents the lexical-not-semantic limitation: synonymous commit-message vocabulary scores near zero', async () => {
    // "retry with backoff" vs. "reattempt after delay" describe the same
    // kind of change but share almost no tokens — this is the exact
    // limitation the module header states explicitly (design decision 2). A
    // real embedding model would catch this; TF-IDF/cosine deliberately does
    // not.
    writeAndCommit(repoRoot, { 'a.ts': 'v1\n' }, 'Retry network request with exponential backoff');
    writeAndCommit(repoRoot, { 'b.ts': 'v1\n' }, 'Reattempt operation after a fixed delay');

    const ctx = createRepoContext(repoRoot);
    const groups = await commitMessageSimilaritySignal(ctx);

    const synonymPair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    // Never grouped: below the similarity threshold because the vocabularies
    // barely overlap despite being conceptually related.
    expect(synonymPair).toBeUndefined();
  });

  it('does not report near-maximal similarity for files touched only by generically-messaged commits', async () => {
    // Reproduces the false-positive: two unrelated files whose commits are
    // all boilerplate ("fix", "update", "wip") share no real vocabulary but
    // previously vectorized to a cosine similarity at or near 1.0 purely
    // from the shared filler words.
    writeAndCommit(repoRoot, { 'alpha.ts': 'v1\n' }, 'fix');
    writeAndCommit(repoRoot, { 'alpha.ts': 'v2\n' }, 'update');
    writeAndCommit(repoRoot, { 'alpha.ts': 'v3\n' }, 'wip');
    writeAndCommit(repoRoot, { 'beta.ts': 'v1\n' }, 'fix');
    writeAndCommit(repoRoot, { 'beta.ts': 'v2\n' }, 'update');
    writeAndCommit(repoRoot, { 'beta.ts': 'v3\n' }, 'wip');

    const ctx = createRepoContext(repoRoot);
    const groups = await commitMessageSimilaritySignal(ctx);

    const boilerplatePair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('alpha.ts') && paths.includes('beta.ts');
    });
    expect(boilerplatePair).toBeUndefined();
  });

  it('produces no groups when there is only one file in history', async () => {
    writeAndCommit(repoRoot, { 'only.ts': 'v1\n' }, 'Add the only file');

    const ctx = createRepoContext(repoRoot);
    const groups = await commitMessageSimilaritySignal(ctx);
    expect(groups).toEqual([]);
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['no-tags-repo', buildNoTagsRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws or NaN) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await commitMessageSimilaritySignal(ctx);
    expect(groups).toEqual([]);
  });
});
