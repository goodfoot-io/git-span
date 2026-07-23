/**
 * Real (unskipped) tests for src/signals/same-author-session.ts.
 *
 * Uses real fixture repos (built directly here, plus the three shared
 * degenerate-repo builders) rather than fakes, since the signal reads
 * through RepoContext's real git-backed accessors. Author identity and
 * commit timestamps are controlled explicitly per commit (via `-c user.*`
 * overrides and GIT_AUTHOR_DATE/GIT_COMMITTER_DATE) so the same-author and
 * tight-window constraints can be asserted precisely rather than relying on
 * incidental wall-clock timing.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepoContext } from '../../src/prefilter.js';
import sameAuthorSessionSignal from '../../src/signals/same-author-session.js';
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

interface CommitAs {
  author?: string;
  email?: string;
  /** ISO 8601 date used for both author and committer date. */
  date: string;
}

/** Writes files and commits them as a specific author at a specific timestamp. */
function writeAndCommitAt(dir: string, files: Record<string, string>, message: string, opts: CommitAs): void {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, ['add', '-A']);
  const author = opts.author ?? 'Fixture Builder';
  const email = opts.email ?? 'fixture@example.com';
  execFileSync('git', ['-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '--quiet', '-m', message], {
    cwd: dir,
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_DATE: opts.date, GIT_COMMITTER_DATE: opts.date }
  });
}

describe('same-author-session signal', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-same-author-session-'));
    initRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('pairs two hunks by the same author within the tight window into an AnchorGroup anchored on hunk line ranges', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n' }, 'Add a.ts', { date: '2024-01-01T09:00:00-05:00' });
    // 30 minutes later, same author, a different file — well within the 2h window.
    writeAndCommitAt(repoRoot, { 'b.ts': 'line1\nline2\nline3\n' }, 'Add b.ts', {
      date: '2024-01-01T09:30:00-05:00'
    });

    const ctx = createRepoContext(repoRoot);
    const groups = await sameAuthorSessionSignal(ctx);

    expect(groups.length).toBeGreaterThan(0);
    const pair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    expect(pair).toBeDefined();
    expect(pair?.evidence).toHaveLength(1);
    expect(pair?.evidence[0].signal).toBe('same-author-session');
    expect(pair?.evidence[0].strength).toBeGreaterThan(0);
    expect(pair?.evidence[0].strength).toBeLessThanOrEqual(1);
    expect(pair?.score).toBe(pair?.evidence[0].strength);
    expect(pair?.evidence[0].commits?.length).toBe(2);

    // Anchors carry the hunk's actual line range, not the whole file.
    const aAnchor = pair?.anchors.find((anchor) => anchor.path === 'a.ts');
    const bAnchor = pair?.anchors.find((anchor) => anchor.path === 'b.ts');
    expect(aAnchor).toEqual({ path: 'a.ts', startLine: 1, endLine: 1 });
    expect(bAnchor).toEqual({ path: 'b.ts', startLine: 1, endLine: 3 });
  });

  it('does not pair two hunks by the same author when they fall outside the tight window', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n' }, 'Add a.ts', { date: '2024-01-01T09:00:00-05:00' });
    // 3 hours later — outside the 2h tight window, even though it is the same author.
    writeAndCommitAt(repoRoot, { 'b.ts': 'line1\n' }, 'Add b.ts', { date: '2024-01-01T12:00:00-05:00' });

    const ctx = createRepoContext(repoRoot);
    const groups = await sameAuthorSessionSignal(ctx);

    const pair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    expect(pair).toBeUndefined();
  });

  it('never pairs a same-time edit by a different author, even inside the tight window', async () => {
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n' }, 'Add a.ts', {
      author: 'Alice',
      email: 'alice@example.com',
      date: '2024-01-01T09:00:00-05:00'
    });
    // Same instant, different author — must never match this signal, which
    // is scoped to a single author's own session.
    writeAndCommitAt(repoRoot, { 'b.ts': 'line1\n' }, 'Add b.ts', {
      author: 'Bob',
      email: 'bob@example.com',
      date: '2024-01-01T09:00:00-05:00'
    });

    const ctx = createRepoContext(repoRoot);
    const groups = await sameAuthorSessionSignal(ctx);

    const pair = groups.find((group) => {
      const paths = group.anchors.map((anchor) => anchor.path);
      return paths.includes('a.ts') && paths.includes('b.ts');
    });
    expect(pair).toBeUndefined();
  });

  it('does not pair hunks from within the same commit', async () => {
    // One commit touching two files is a trivial same-instant co-change, not
    // a cross-commit "session" — this signal must not manufacture a pair out
    // of it.
    writeAndCommitAt(repoRoot, { 'a.ts': 'line1\n', 'b.ts': 'line1\n' }, 'Add both files', {
      date: '2024-01-01T09:00:00-05:00'
    });

    const ctx = createRepoContext(repoRoot);
    const groups = await sameAuthorSessionSignal(ctx);
    expect(groups).toEqual([]);
  });

  it('produces no groups when there is only one commit in history', async () => {
    writeAndCommitAt(repoRoot, { 'only.ts': 'v1\n' }, 'Add the only file', { date: '2024-01-01T09:00:00-05:00' });

    const ctx = createRepoContext(repoRoot);
    const groups = await sameAuthorSessionSignal(ctx);
    expect(groups).toEqual([]);
  });

  it.each([
    ['single-commit-repo', buildSingleCommitRepo],
    ['shallow-clone-repo', buildShallowCloneRepo]
  ])('returns [] (never throws or NaN) against the %s degenerate fixture', async (_name, buildFixture) => {
    const ctx = createRepoContext(buildFixture());
    const groups = await sameAuthorSessionSignal(ctx);
    // Both fixtures reduce to exactly one commit reachable from HEAD (the
    // shallow clone is a --depth 1 clone), and this signal never pairs hunks
    // from the same commit — so both are structurally empty regardless of
    // window width.
    expect(groups).toEqual([]);
  });

  it('never throws or produces NaN against the no-tags-repo degenerate fixture', async () => {
    // Unlike the single-commit and shallow-clone fixtures, no-tags-repo has
    // three real, distinct commits by the same fixture author created
    // moments apart in wall-clock time — which is exactly the pattern this
    // signal is designed to detect (a same-author edit session). So, unlike
    // the sibling signals whose triggering conditions this fixture happens
    // not to satisfy, asserting a strict `[]` here would be asserting this
    // signal fails to find a real same-author, same-window pair that
    // genuinely exists in the fixture's history. The safety net design
    // decision 9 actually requires — never throwing, never NaN, always valid
    // evidence shapes — is asserted instead.
    const ctx = createRepoContext(buildNoTagsRepo());
    const groups = await sameAuthorSessionSignal(ctx);

    for (const group of groups) {
      expect(Number.isFinite(group.score)).toBe(true);
      expect(group.score).toBeGreaterThanOrEqual(0);
      expect(group.score).toBeLessThanOrEqual(1);
      for (const evidence of group.evidence) {
        expect(Number.isFinite(evidence.strength)).toBe(true);
      }
      for (const anchor of group.anchors) {
        if (anchor.startLine !== undefined) expect(Number.isFinite(anchor.startLine)).toBe(true);
        if (anchor.endLine !== undefined) expect(Number.isFinite(anchor.endLine)).toBe(true);
      }
    }
  });
});
