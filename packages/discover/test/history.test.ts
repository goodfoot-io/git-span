/**
 * Tests for the git history loader: rename resolution, release detection,
 * change-group merging, message quality, conflict-trailer stripping, and
 * exclude-pathspec filtering — all exercised against real temporary git
 * repositories rather than mocked git output.
 *
 * @summary Verifies loadHistory against real temporary git repositories.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHistory } from '../src/history.js';
import type { DiscoverConfig, RepoScan } from '../src/types.js';

const tempDirs: string[] = [];

/**
 * Create a fresh, empty git repository in a new temporary directory.
 *
 * @returns Absolute path to the repository root.
 */
function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-'));
  tempDirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/**
 * Write a file (creating parent directories as needed) inside a repo.
 *
 * @param dir - Repository root.
 * @param relPath - Repository-relative file path.
 * @param content - Bytes to write, replacing any existing content.
 */
function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/**
 * Stage every change and commit with a deterministic author/committer date.
 *
 * @param dir - Repository root.
 * @param message - Commit message (subject only).
 * @param date - ISO date used for both author and committer date.
 * @param authorEmail - Author email; defaults to a fixed test address.
 */
function commitAll(dir: string, message: string, date: string, authorEmail = 'a@x'): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', `user.email=${authorEmail}`, '-c', 'user.name=tester', 'commit', '-q', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  });
}

/**
 * Commit using a full message file (subject + body) rather than `-m`.
 *
 * @param dir - Repository root.
 * @param messageFile - Absolute path to a file holding the full commit message.
 * @param date - ISO date used for both author and committer date.
 */
function commitAllWithFile(dir: string, messageFile: string, date: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=a@x', '-c', 'user.name=tester', 'commit', '-q', '-F', messageFile], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  });
}

/**
 * Build a minimal RepoScan fixture whose files reflect a repo's final tree.
 *
 * @param dir - Repository root (used as the scan root).
 * @param files - Repository-relative file paths present at HEAD.
 * @returns A plain RepoScan with empty text/line maps.
 */
function makeScan(dir: string, files: string[]): RepoScan {
  return {
    root: dir,
    files: [...files].sort(),
    text: new Map(),
    lines: new Map(),
    topLevelDirs: new Set(),
    docsDirs: []
  };
}

/**
 * Build a DiscoverConfig with sensible test defaults.
 *
 * @param overrides - Field overrides.
 * @returns A complete config object.
 */
function makeConfig(overrides: Partial<DiscoverConfig> = {}): DiscoverConfig {
  return {
    exclude: [],
    maxCandidates: 300,
    minScore: 0.5,
    useCommitMessages: true,
    maxFileBytes: 524288,
    ...overrides
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadHistory', () => {
  it('resolves a renamed path to its current name across a rename chain', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', 'hello\n');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z');
    execFileSync('git', ['mv', 'a.ts', 'b.ts'], { cwd: dir });
    commitAll(dir, 'rename a to b', '2024-01-01T10:05:00Z');
    writeFile(dir, 'b.ts', 'hello\nworld\n');
    commitAll(dir, 'edit b', '2024-01-01T10:10:00Z');

    const history = loadHistory(dir, makeScan(dir, ['b.ts']), makeConfig());

    expect(history.commits).toHaveLength(3);
    const addCommit = history.commits.find((c) => c.subject === 'add a');
    expect(addCommit?.files).toEqual(['b.ts']);
  });

  it('flags a version-tag subject as a release commit', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', 'x');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z');
    writeFile(dir, 'a.ts', 'y');
    commitAll(dir, 'v1.2.3', '2024-01-01T10:05:00Z');

    const history = loadHistory(dir, makeScan(dir, ['a.ts']), makeConfig());

    expect(history.commits.find((c) => c.subject === 'v1.2.3')?.isRelease).toBe(true);
    expect(history.commits.find((c) => c.subject === 'add a')?.isRelease).toBe(false);
  });

  it('flags a package.json-only commit as a release commit', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', 'x');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z');
    writeFile(dir, 'package.json', '{"version":"1.0.0"}');
    commitAll(dir, 'update deps', '2024-01-01T10:05:00Z');

    const history = loadHistory(dir, makeScan(dir, ['a.ts', 'package.json']), makeConfig());

    expect(history.commits.find((c) => c.subject === 'update deps')?.isRelease).toBe(true);
  });

  it('merges consecutive commits by the same author within 45 minutes into one change group', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', '1');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z', 'same@x');
    writeFile(dir, 'b.ts', '1');
    commitAll(dir, 'add b', '2024-01-01T10:10:00Z', 'same@x');

    const history = loadHistory(dir, makeScan(dir, ['a.ts', 'b.ts']), makeConfig());

    expect(history.changeGroups).toHaveLength(1);
    expect(history.changeGroups[0]?.files).toEqual(['a.ts', 'b.ts']);
    expect(history.changeGroups[0]?.commitCount).toBe(2);
  });

  it('does not merge consecutive commits by different authors', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', '1');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z', 'one@x');
    writeFile(dir, 'b.ts', '1');
    commitAll(dir, 'add b', '2024-01-01T10:10:00Z', 'two@x');

    const history = loadHistory(dir, makeScan(dir, ['a.ts', 'b.ts']), makeConfig());

    expect(history.changeGroups).toHaveLength(2);
  });

  it('scores messageQuality higher when commit messages name real repository paths', () => {
    const goodDir = initRepo();
    writeFile(goodDir, 'src/a.ts', '1');
    commitAll(goodDir, 'update src/a.ts', '2024-01-01T10:00:00Z');
    writeFile(goodDir, 'src/a.ts', '2');
    commitAll(goodDir, 'fix bug in src/a.ts', '2024-01-01T10:05:00Z');
    const goodHistory = loadHistory(goodDir, makeScan(goodDir, ['src/a.ts']), makeConfig());

    const badDir = initRepo();
    writeFile(badDir, 'src/a.ts', '1');
    commitAll(badDir, 'initial work', '2024-01-01T10:00:00Z');
    writeFile(badDir, 'src/a.ts', '2');
    commitAll(badDir, 'more changes', '2024-01-01T10:05:00Z');
    const badHistory = loadHistory(badDir, makeScan(badDir, ['src/a.ts']), makeConfig());

    expect(badHistory.messageQuality).toBe(0);
    expect(goodHistory.messageQuality).toBeGreaterThan(badHistory.messageQuality);
  });

  it('strips a Conflicts: trailer block from stored commit messages but keeps trailing content', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', '1');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z');
    writeFile(dir, 'a.ts', '2');
    const messageFile = path.join(dir, '.msg');
    fs.writeFileSync(messageFile, 'Merge conflict fix\n\nSome body text.\n\nConflicts:\n\ta.ts\n\nTrailing note.\n');
    commitAllWithFile(dir, messageFile, '2024-01-01T10:05:00Z');

    const history = loadHistory(dir, makeScan(dir, ['a.ts']), makeConfig());
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const message = history.messages.get(sha);

    expect(message).toBeDefined();
    expect(message).not.toMatch(/Conflicts:/);
    expect(message).not.toContain('a.ts');
    expect(message).toContain('Merge conflict fix');
    expect(message).toContain('Trailing note.');
  });

  it('drops commits that only touch an excluded path prefix', () => {
    const dir = initRepo();
    writeFile(dir, 'a.ts', '1');
    commitAll(dir, 'add a', '2024-01-01T10:00:00Z');
    writeFile(dir, 'vendor/x.txt', 'secret');
    commitAll(dir, 'add vendor file', '2024-01-01T10:05:00Z');

    const history = loadHistory(dir, makeScan(dir, ['a.ts']), makeConfig({ exclude: ['vendor'] }));

    expect(history.commits.some((c) => c.subject === 'add vendor file')).toBe(false);
    expect(history.commits.some((c) => c.subject === 'add a')).toBe(true);
  });
});
