/**
 * Real (unskipped) tests for src/signals/conceptual-similarity.ts.
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
import conceptualSimilaritySignal from '../../src/signals/conceptual-similarity.js';
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

describe('conceptual-similarity signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-conceptual-similarity-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('groups two files that share a lexical vocabulary of identifiers', async () => {
    writeAndCommit(
      repoRoot,
      {
        'retry.ts': `
          // Retry a network request with exponential backoff.
          function retryRequest(requestFn, maxRetries) {
            let backoffDelayMs = 100;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              const backoffResult = requestFn();
              if (backoffResult) return backoffResult;
              backoffDelayMs *= 2;
            }
          }
        `,
        'unrelated.ts': `
          // Formats a currency amount for display.
          function formatCurrencyAmount(amountCents, currencyCode) {
            const dollars = amountCents / 100;
            return dollars.toFixed(2) + ' ' + currencyCode;
          }
        `
      },
      'Add retry helper and currency formatter'
    );
    writeAndCommit(
      repoRoot,
      {
        'retry-consumer.ts': `
          // Calls retryRequest with backoff-aware retry semantics.
          function callWithRetryBackoff(requestFn) {
            let backoffDelayMs = 100;
            return retryRequest(requestFn, 5, backoffDelayMs);
          }
        `
      },
      'Add retry consumer'
    );

    const ctx = createRepoContext(repoRoot);
    const groups = await conceptualSimilaritySignal(ctx);

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

    // The currency formatter shares essentially no vocabulary with the retry
    // files — it must not be grouped with either of them.
    const unrelatedPair = groups.find((group) => group.anchors.some((anchor) => anchor.path === 'unrelated.ts'));
    expect(unrelatedPair).toBeUndefined();
  });

  it('documents the lexical-not-semantic limitation: synonymous vocabulary scores near zero', async () => {
    // retry/backoff vs. reattempt/delay describe the same behavior but share
    // almost no tokens — this is the exact limitation the module header
    // states explicitly (design decision 2). A real embedding model would
    // catch this; TF-IDF/cosine deliberately does not.
    writeAndCommit(
      repoRoot,
      {
        'a.ts': `
          // Retry a network request with exponential backoff.
          function retryRequest(requestFn, maxRetries) {
            let backoffDelayMs = 100;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              backoffDelayMs *= 2;
            }
          }
        `,
        'b.ts': `
          // Reattempt an operation after a fixed delay.
          function reattemptOperation(operationFn, maxAttempts) {
            let delayMs = 100;
            for (let count = 0; count < maxAttempts; count++) {
              delayMs *= 2;
            }
          }
        `
      },
      'Add synonymous-vocabulary files'
    );

    const ctx = createRepoContext(repoRoot);
    const groups = await conceptualSimilaritySignal(ctx);

    const synonymPair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    // Never grouped: below the similarity threshold because the vocabularies
    // barely overlap despite being conceptually related.
    expect(synonymPair).toBeUndefined();
  });

  it('produces no groups when there is only one file in history', async () => {
    writeAndCommit(repoRoot, { 'only.ts': 'function onlyOne() { return 1; }\n' }, 'Single file');

    const ctx = createRepoContext(repoRoot);
    const groups = await conceptualSimilaritySignal(ctx);
    expect(groups).toEqual([]);
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['no-tags-repo', buildNoTagsRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws or NaN) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await conceptualSimilaritySignal(ctx);
    expect(groups).toEqual([]);
  });
});
