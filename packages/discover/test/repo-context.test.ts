/**
 * Real (unskipped) tests for src/prefilter.ts's createRepoContext: the
 * memoized RepoContext construction that every signal/disqualifier reads
 * through. Exercises real fixture repos rather than fakes, since commits(),
 * tags(), and fileAt() are thin wrappers over real git subprocess calls
 * (src/git.ts) and a fake would hide git-format-string bugs.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../src/prefilter.js';
import {
  buildNoTagsRepo,
  buildShallowCloneRepo,
  buildSingleCommitRepo,
  buildZeroCommitRepo
} from './fixtures/build-fixture-repos.js';

describe('createRepoContext against fixture repos', () => {
  it('returns an empty commit list for a zero-commit repo instead of throwing', async () => {
    const repoRoot = buildZeroCommitRepo();
    const ctx = createRepoContext(repoRoot);

    await expect(ctx.commits()).resolves.toEqual([]);
  });

  it('sees the one commit and no tags in the single-commit fixture', async () => {
    const repoRoot = buildSingleCommitRepo();
    const ctx = createRepoContext(repoRoot);

    const commits = await ctx.commits();
    expect(commits).toHaveLength(1);
    expect(commits[0].files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);

    const tags = await ctx.tags();
    expect(tags).toEqual([]);
  });

  it('memoizes commits() — a second call does not re-invoke git', async () => {
    const repoRoot = buildSingleCommitRepo();
    const ctx = createRepoContext(repoRoot);

    const first = await ctx.commits();
    const second = await ctx.commits();
    expect(second).toBe(first); // same array identity — proves memoization, not just equal content
  });

  it('sees three commits and no tags in the no-tags fixture', async () => {
    const repoRoot = buildNoTagsRepo();
    const ctx = createRepoContext(repoRoot);

    expect(await ctx.commits()).toHaveLength(3);
    expect(await ctx.tags()).toEqual([]);
  });

  it('reads history from a shallow clone without throwing', async () => {
    const repoRoot = buildShallowCloneRepo();
    const ctx = createRepoContext(repoRoot);

    // A shallow clone's grafted history is truncated to the requested depth
    // (1 commit here) — commits() must reflect that, not throw or hang.
    const commits = await ctx.commits();
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.length).toBeLessThanOrEqual(1);
  });

  it('fileAt reads real file content at HEAD', async () => {
    const repoRoot = buildSingleCommitRepo();
    const ctx = createRepoContext(repoRoot);

    expect(await ctx.fileAt('a.txt', 'HEAD')).toBe('hello\n');
  });

  it('fileAt returns null for a path that never existed', async () => {
    const repoRoot = buildSingleCommitRepo();
    const ctx = createRepoContext(repoRoot);

    expect(await ctx.fileAt('does-not-exist.txt', 'HEAD')).toBeNull();
  });

  it('excludes a sweep commit above the configured threshold', async () => {
    const repoRoot = buildSingleCommitRepo();
    // The fixture's one commit touches 2 files — a threshold of 1 makes it a sweep commit.
    const ctx = createRepoContext(repoRoot, { maxFilesPerCommit: 1 });

    expect(await ctx.commits()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// .span/ guard (design decision 5) — the history-walk exclusion is
// independent from, and in addition to, the content-read guard.
// ---------------------------------------------------------------------------

describe('.span/ is never read by RepoContext construction or commits()', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-span-guard-'));
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repoRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: repoRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Fixture Builder'], { cwd: repoRoot, stdio: 'ignore' });

    fs.mkdirSync(path.join(repoRoot, '.span'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.span', 'record.json'), '{"secret":"span-data"}\n');
    fs.writeFileSync(path.join(repoRoot, 'src.ts'), 'export const x = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: repoRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '--quiet', '-m', 'Commit touching both src and .span/'], {
      cwd: repoRoot,
      stdio: 'ignore'
    });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('strips .span/ paths from commits() even though the commit touched them', async () => {
    const ctx = createRepoContext(repoRoot);
    const commits = await ctx.commits();

    expect(commits).toHaveLength(1);
    const paths = commits[0].files.map((f) => f.path);
    expect(paths).toContain('src.ts');
    expect(paths.some((p) => p === '.span' || p.startsWith('.span/'))).toBe(false);
  });

  it('fileAt refuses to resolve a .span/ path even when asked directly', async () => {
    const ctx = createRepoContext(repoRoot);
    // Prove the file really exists in git (i.e. this isn't a false negative
    // from a missing-path null), then prove fileAt still refuses it.
    const raw = execFileSync('git', ['-C', repoRoot, 'show', 'HEAD:.span/record.json'], { encoding: 'utf8' });
    expect(raw).toContain('span-data');

    expect(await ctx.fileAt('.span/record.json', 'HEAD')).toBeNull();
  });
});
