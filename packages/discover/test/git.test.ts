/**
 * Tests for the frozen {@link defaultGitRunner} against a real temporary git
 * repository: successful invocations return stdout, and failures throw.
 *
 * @summary Tests for defaultGitRunner against a real temp git repository.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultGitRunner } from '../src/git.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Discover Test',
  GIT_AUTHOR_EMAIL: 'discover-test@example.com',
  GIT_COMMITTER_NAME: 'Discover Test',
  GIT_COMMITTER_EMAIL: 'discover-test@example.com',
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z'
};

describe('defaultGitRunner', () => {
  let cleanupDir: string | undefined;

  afterEach(() => {
    if (cleanupDir !== undefined) {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanupDir = undefined;
    }
  });

  it('returns stdout for a successful invocation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-git-'));
    cleanupDir = dir;
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' });

    const output = defaultGitRunner(['rev-parse', '--is-inside-work-tree'], dir);

    expect(output).toBe('true\n');
  });

  it('throws when the git invocation fails', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-git-'));
    cleanupDir = dir;
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' });

    expect(() => defaultGitRunner(['rev-parse', '--verify', 'HEAD'], dir)).toThrow();
  });

  it('returns complete stdout reflecting real commit history', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-git-'));
    cleanupDir = dir;
    execFileSync('git', ['init', '--initial-branch=main'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'Add file'], {
      cwd: dir,
      env: GIT_ENV,
      stdio: 'ignore'
    });

    const output = defaultGitRunner(['ls-files'], dir);

    expect(output).toBe('file.txt\n');
  });
});
