/**
 * Builds the three shared degenerate-repo fixtures (design decision 9): a
 * single-commit repo, a repo with commits but no tags, and a shallow clone.
 * Every Stage-1 signal's test suite must additionally run its concrete
 * signal against all three and assert `[]` — this module is the shared
 * builder those suites (and Stage 0's own skipped contract tests) import.
 *
 * Fixtures are real git checkouts, built fresh on demand under this
 * directory (gitignored — a nested `.git` committed into this repo would be
 * tracked as a gitlink, not real content) rather than embedded as static
 * fixtures.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_ROOT = path.dirname(fileURLToPath(import.meta.url));

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
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

/** A repo with exactly one commit and no tags — degenerate-repo fixture #1. */
export function buildSingleCommitRepo(): string {
  const dir = path.join(FIXTURES_ROOT, 'single-commit-repo');
  initRepo(dir);
  writeAndCommit(dir, { 'a.txt': 'hello\n', 'b.txt': 'world\n' }, 'Initial commit');
  return dir;
}

/** A repo with several commits but zero tags — degenerate-repo fixture #2. Hits release-tag-delta directly. */
export function buildNoTagsRepo(): string {
  const dir = path.join(FIXTURES_ROOT, 'no-tags-repo');
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
  const originDir = path.join(FIXTURES_ROOT, '.shallow-clone-origin');
  initRepo(originDir);
  writeAndCommit(originDir, { 'a.txt': 'v1\n' }, 'Commit 1');
  writeAndCommit(originDir, { 'a.txt': 'v2\n' }, 'Commit 2');
  writeAndCommit(originDir, { 'a.txt': 'v3\n' }, 'Commit 3');

  const dir = path.join(FIXTURES_ROOT, 'shallow-clone-repo');
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${originDir}`, dir], { stdio: 'ignore' });
  return dir;
}
