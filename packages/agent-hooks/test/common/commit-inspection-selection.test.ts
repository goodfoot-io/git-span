import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCommitInspection } from '../../src/common/commit-inspection-selection.js';

const roots: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function fixture(objectFormat: 'sha1' | 'sha256' = 'sha1') {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'commit-selection-')));
  roots.push(repo);
  git(repo, 'init', '-q', '--initial-branch=main', `--object-format=${objectFormat}`);
  git(repo, 'config', 'user.name', 'Selection Fixture');
  git(repo, 'config', 'user.email', 'selection@example.invalid');
  function commit(message: string, path: string, content: string): string {
    writeFileSync(join(repo, path), content);
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', message);
    return git(repo, 'rev-parse', 'HEAD');
  }
  const root = commit('root', 'x', 'root\n');
  const introduce = commit('introduce token', 'x', 'root\nTOKEN\n');
  const other = commit('other file', 'y', 'other\n');
  const remove = commit('remove token', 'x', 'root\n');
  return { repo, root, introduce, other, remove, commit };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('commit inspection selection contract', () => {
  it.skip.each(['git show', 'git show HEAD', 'git show --stat HEAD', 'git show --name-only HEAD'])(
    'selects one complete immutable commit with %s',
    async (command) => {
      const { repo, remove } = fixture();
      expect(await resolveCommitInspection(command, repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [remove]
      });
    }
  );

  it.skip.each(['git log', 'git log --oneline', 'git log -p', 'git log --format="message only" --graph --stat'])(
    'preserves complete log membership independently of presentation: %s',
    async (command) => {
      const { repo, root, introduce, other, remove } = fixture();
      expect(await resolveCommitInspection(command, repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [remove, other, introduce, root]
      });
    }
  );

  it.skip('preserves count and skip rather than expanding a truncated log to all history', async () => {
    const { repo, other, introduce } = fixture();
    expect(await resolveCommitInspection('git log -n 2 --skip=1', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [other, introduce]
    });
  });

  it.skip('handles show ranges and multiple explicit objects through native show semantics', async () => {
    const { repo, root, introduce, other, remove } = fixture();
    expect(await resolveCommitInspection(`git show ${root}..${remove}`, repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [remove, other, introduce]
    });
    expect(await resolveCommitInspection(`git show ${introduce} ${remove}`, repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [introduce, remove]
    });
  });

  it.skip.each(['-S TOKEN', '-G TOKEN', '--grep=token', '--author="Selection Fixture" --grep=token'])(
    'preserves native filtered selection: %s',
    async (filter) => {
      const { repo, introduce, remove } = fixture();
      expect(await resolveCommitInspection(`git log ${filter} -- x`, repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [remove, introduce]
      });
    }
  );

  it.skip('keeps pathspec selection separate from presentation', async () => {
    const { repo, other } = fixture();
    expect(await resolveCommitInspection('git log --name-status -- y', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [other]
    });
  });

  it.skip('preserves first-parent and merge-diff-dependent pickaxe membership', async () => {
    const { repo, introduce, remove, commit } = fixture();
    git(repo, 'checkout', '-qb', 'side', introduce);
    commit('side branch', 'z', 'side\n');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'merge', '--no-ff', '-qm', 'merge', 'side');
    const merge = git(repo, 'rev-parse', 'HEAD');
    expect(await resolveCommitInspection('git log --first-parent -n 2', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [merge, remove]
    });
    expect(await resolveCommitInspection('git log --diff-merges=separate -S TOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [merge, remove, introduce]
    });
    expect(await resolveCommitInspection('git log --diff-merges=first-parent -S TOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [remove, introduce]
    });
  });

  it.skip('resolves repeated relative -C and a literal cd prefix in the effective repository', async () => {
    const { repo, remove } = fixture();
    mkdirSync(join(repo, 'sub'));
    for (const command of ['git -C sub -C .. show HEAD', 'cd sub && git -C .. show HEAD']) {
      expect(await resolveCommitInspection(command, repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [remove]
      });
    }
  });

  it.skip('selects an alternate repository rather than the invoking workspace HEAD', async () => {
    const source = fixture();
    const target = fixture();
    const targetHead = target.commit('target only', 'z', 'target\n');
    expect(await resolveCommitInspection(`git -C '${target.repo}' show`, source.repo)).toEqual({
      kind: 'selected',
      repoRoot: target.repo,
      commits: [targetHead]
    });
  });

  it.skip('accepts a successful empty selection', async () => {
    const { repo } = fixture();
    expect(await resolveCommitInspection('git log --grep=never-matches', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: []
    });
  });

  it.skip('reports failed revision resolution without returning a partial selection', async () => {
    const { repo } = fixture();
    expect(await resolveCommitInspection('git show HEAD missing-revision', repo)).toEqual({
      kind: 'failed',
      reason: expect.any(String)
    });
  });

  it.skip('supports full identities in SHA-256 repositories', async () => {
    const { repo, remove } = fixture('sha256');
    expect(remove).toHaveLength(64);
    expect(await resolveCommitInspection('git show', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [remove]
    });
  });

  it.skip.each([
    'git show HEAD:x',
    'git show HEAD^{tree}',
    'git log --output=stolen',
    'git log --ext-diff',
    'git log --textconv',
    'git log --unknown-option',
    'git log -L 1,2:x',
    'git log --walk-reflogs'
  ])('recognizes unsupported inspection without guessing commit membership: %s', async (command) => {
    const { repo } = fixture();
    expect(await resolveCommitInspection(command, repo)).toEqual({ kind: 'unsupported', recognized: true });
  });

  it.skip.each([
    'cat x',
    'git status',
    'git show | head',
    'git log; git status',
    'git show "$REV"',
    'GIT_DIR=elsewhere git show',
    'git -c alias.show=status show',
    'git show > output',
    'false && git show'
  ])('rejects an unrelated or ambiguous shell operation: %s', async (command) => {
    const { repo } = fixture();
    expect(await resolveCommitInspection(command, repo)).toEqual({ kind: 'unsupported', recognized: false });
  });

  it.skip('fails closed when the selected history exceeds 4096 commits', async () => {
    const { repo } = fixture();
    const records = ['blob\nmark :1\ndata 1\nx\n'];
    for (let index = 0; index < 4097; index++) {
      records.push(
        `commit refs/heads/large\ncommitter Fixture <fixture@example.invalid> ${index + 1} +0000\ndata 1\nx\nM 100644 :1 x\n\n`
      );
    }
    execFileSync('git', ['-C', repo, 'fast-import', '--quiet'], { input: records.join('') });
    expect(await resolveCommitInspection('git log large', repo)).toEqual({
      kind: 'failed',
      reason: expect.any(String)
    });
  });
});
