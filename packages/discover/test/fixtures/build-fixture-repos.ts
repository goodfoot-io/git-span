/**
 * Builds the shared degenerate-repo fixtures (design decision 9): a
 * single-commit repo, a repo with commits but no tags, a shallow clone, and a
 * freshly-`git init`'d repo with zero commits. Every Stage-1 signal's test
 * suite must additionally run its concrete signal against the first three
 * and assert `[]` — this module is the shared builder those suites (and
 * Stage 0's own skipped contract tests) import.
 *
 * Fixtures are real git checkouts, built fresh on demand under this
 * directory (gitignored — a nested `.git` committed into this repo would be
 * tracked as a gitlink, not real content) rather than embedded as static
 * fixtures.
 *
 * Each builder allocates a fresh, unique directory per call via
 * `fs.mkdtempSync` rather than a fixed shared path — Vitest runs test files
 * in separate parallel worker threads by default, so two test files calling
 * the same builder concurrently would otherwise race on the same directory
 * (concurrent `git init`/`git commit`/`git clone` against one path fails
 * nondeterministically).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function uniqueDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `git-span-discover-${prefix}-`));
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

/** A repo with exactly one commit and no tags — degenerate-repo fixture #1. */
export function buildSingleCommitRepo(): string {
  const dir = uniqueDir('single-commit-repo');
  initRepo(dir);
  writeAndCommit(dir, { 'a.txt': 'hello\n', 'b.txt': 'world\n' }, 'Initial commit');
  return dir;
}

/** A freshly-initialized repo with zero commits — degenerate-repo fixture #0. `git log` exits non-zero here ("does not have any commits yet"); the whole point of this fixture is to hit that boundary. */
export function buildZeroCommitRepo(): string {
  const dir = uniqueDir('zero-commit-repo');
  initRepo(dir);
  return dir;
}

/** A repo with several commits but zero tags — degenerate-repo fixture #2. Hits release-tag-delta directly. */
export function buildNoTagsRepo(): string {
  const dir = uniqueDir('no-tags-repo');
  initRepo(dir);
  writeAndCommit(dir, { 'a.txt': 'line1\n' }, 'First commit');
  writeAndCommit(dir, { 'a.txt': 'line1\nline2\n' }, 'Second commit');
  writeAndCommit(dir, { 'b.txt': 'new file\n' }, 'Third commit');
  return dir;
}

/**
 * A shallow clone (`--depth 1`) of a multi-commit origin — degenerate-repo
 * fixture #3. History-walking accessors see only the truncated, grafted
 * history a shallow clone provides.
 */
export function buildShallowCloneRepo(): string {
  const originDir = uniqueDir('shallow-clone-origin');
  initRepo(originDir);
  writeAndCommit(originDir, { 'a.txt': 'v1\n' }, 'Commit 1');
  writeAndCommit(originDir, { 'a.txt': 'v2\n' }, 'Commit 2');
  writeAndCommit(originDir, { 'a.txt': 'v3\n' }, 'Commit 3');

  const dir = uniqueDir('shallow-clone-repo');
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${originDir}`, dir], { stdio: 'ignore' });
  return dir;
}
