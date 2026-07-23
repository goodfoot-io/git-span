/**
 * Real (unskipped) tests for src/signals/shared-config-keys.ts: file pairs
 * that share a rare identifier-like token (SCREAMING_SNAKE_CASE, camelCase,
 * kebab-case) across their historical diff hunks. Exercises real fixture
 * repos built at test time (not fakes) since the signal reads through
 * RepoContext's real git-subprocess-backed accessors.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../../src/prefilter.js';
import sharedConfigKeysSignal from '../../src/signals/shared-config-keys.js';
import { buildNoTagsRepo, buildShallowCloneRepo, buildSingleCommitRepo } from '../fixtures/build-fixture-repos.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(dir: string): void {
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

describe('shared-config-keys signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-shared-config-keys-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('groups two files that share a rare SCREAMING_SNAKE_CASE config key across their historical diffs', async () => {
    writeAndCommit(
      repoRoot,
      {
        'server.ts': 'const port = 3000;\n',
        'client.ts': 'const url = "localhost";\n'
      },
      'Initial commit'
    );
    writeAndCommit(
      repoRoot,
      {
        'server.ts': 'const port = 3000;\nconst timeout = process.env.REQUEST_TIMEOUT_MS;\n',
        'client.ts': 'const url = "localhost";\nconst timeout = window.REQUEST_TIMEOUT_MS;\n'
      },
      'Wire REQUEST_TIMEOUT_MS through both server and client'
    );

    const ctx = createRepoContext(repoRoot);
    const groups = await sharedConfigKeysSignal(ctx);

    const pair = groups.find((g) => g.anchors.some((a) => a.path === 'server.ts'));
    expect(pair).toBeDefined();
    expect(pair?.anchors.map((a) => a.path).sort()).toEqual(['client.ts', 'server.ts']);
    expect(pair?.evidence).toHaveLength(1);
    expect(pair?.evidence[0].signal).toBe('shared-config-key');
    expect(pair?.evidence[0].detail).toContain('REQUEST_TIMEOUT_MS');
    expect(pair?.evidence[0].strength).toBeGreaterThan(0);
    expect(pair?.evidence[0].strength).toBeLessThanOrEqual(1);
    expect(pair?.evidence[0].commits?.length).toBeGreaterThan(0);
  });

  it('groups two files that share a rare camelCase feature-flag identifier', async () => {
    writeAndCommit(repoRoot, { 'a.ts': 'export const x = 1;\n', 'b.ts': 'export const y = 2;\n' }, 'Initial commit');
    writeAndCommit(
      repoRoot,
      {
        'a.ts': 'export const x = 1;\nif (enableNewCheckoutFlow) { x; }\n',
        'b.ts': 'export const y = 2;\nif (enableNewCheckoutFlow) { y; }\n'
      },
      'Gate both paths behind enableNewCheckoutFlow'
    );

    const ctx = createRepoContext(repoRoot);
    const groups = await sharedConfigKeysSignal(ctx);

    const pair = groups.find((g) => g.evidence[0].detail?.includes('enableNewCheckoutFlow'));
    expect(pair).toBeDefined();
    expect(pair?.anchors.map((a) => a.path).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('does not group files on a token that is common across many files (rarity/specificity filter)', async () => {
    writeAndCommit(
      repoRoot,
      {
        'f1.ts': 'const commonIdentifier = 1;\n',
        'f2.ts': 'const commonIdentifier = 2;\n',
        'f3.ts': 'const commonIdentifier = 3;\n',
        'f4.ts': 'const commonIdentifier = 4;\n',
        'f5.ts': 'const commonIdentifier = 5;\n'
      },
      'Introduce commonIdentifier everywhere — five files, above the rarity threshold'
    );

    const ctx = createRepoContext(repoRoot);
    const groups = await sharedConfigKeysSignal(ctx);

    const anyCommonIdentifierGroup = groups.some((g) => g.evidence[0].detail?.includes('commonIdentifier'));
    expect(anyCommonIdentifierGroup).toBe(false);
  });

  it('does not group unrelated files that share no tokens', async () => {
    writeAndCommit(
      repoRoot,
      { 'unrelated1.ts': 'const alpha = 1;\n', 'unrelated2.ts': 'const beta = 2;\n' },
      'Two files with no shared vocabulary'
    );

    const ctx = createRepoContext(repoRoot);
    const groups = await sharedConfigKeysSignal(ctx);

    expect(groups).toEqual([]);
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['no-tags-repo', buildNoTagsRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws or NaN) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await sharedConfigKeysSignal(ctx);

    expect(groups).toEqual([]);
  });
});
