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
  it.each(['git show', 'git show HEAD', 'git show --stat HEAD', 'git show --name-only HEAD'])(
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

  it.each(['git log', 'git log --oneline', 'git log -p', 'git log --format="message only" --graph --stat'])(
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

  it('preserves count and skip rather than expanding a truncated log to all history', async () => {
    const { repo, other, introduce } = fixture();
    expect(await resolveCommitInspection('git log -n 2 --skip=1', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [other, introduce]
    });
  });

  it('handles show ranges and multiple explicit objects through native show semantics', async () => {
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

  it.each(['-S TOKEN', '-G TOKEN', '--grep=token', '--author="Selection Fixture" --grep=token'])(
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

  it('keeps pathspec selection separate from presentation', async () => {
    const { repo, other } = fixture();
    expect(await resolveCommitInspection('git log --name-status -- y', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [other]
    });
  });

  it('preserves first-parent and merge-diff-dependent pickaxe membership', async () => {
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

  it('resolves repeated relative -C and a literal cd prefix in the effective repository', async () => {
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

  it('selects an alternate repository rather than the invoking workspace HEAD', async () => {
    const source = fixture();
    const target = fixture();
    const targetHead = target.commit('target only', 'z', 'target\n');
    expect(await resolveCommitInspection(`git -C '${target.repo}' show`, source.repo)).toEqual({
      kind: 'selected',
      repoRoot: target.repo,
      commits: [targetHead]
    });
  });

  it('accepts a successful empty selection', async () => {
    const { repo } = fixture();
    expect(await resolveCommitInspection('git log --grep=never-matches', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: []
    });
  });

  it('reports failed revision resolution without returning a partial selection', async () => {
    const { repo } = fixture();
    expect(await resolveCommitInspection('git show HEAD missing-revision', repo)).toEqual({
      kind: 'failed',
      reason: expect.any(String)
    });
  });

  it('supports full identities in SHA-256 repositories', async () => {
    const { repo, remove } = fixture('sha256');
    expect(remove).toHaveLength(64);
    expect(await resolveCommitInspection('git show', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [remove]
    });
  });

  it.each([
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

  it.each(['git show HEAD:x', 'git show HEAD:x | cat', 'cat x', 'git status'])(
    'leaves blob reads and unrelated shell operations unclaimed: %s',
    async (command) => {
      const { repo } = fixture();
      expect(await resolveCommitInspection(command, repo)).toEqual({ kind: 'unsupported', recognized: false });
    }
  );

  it.each([
    'git show | head',
    'git log --oneline -n1 | cat',
    'git log; git status',
    'git show "$REV"',
    'GIT_DIR=elsewhere git show',
    'git -c alias.show=status show',
    'git show > output',
    'false && git show'
  ])('recognizes ambiguous commit intent without inferring selected commits: %s', async (command) => {
    const { repo } = fixture();
    expect(await resolveCommitInspection(command, repo)).toEqual({ kind: 'unsupported', recognized: true });
  });

  it.each(['--pretty', '--abbrev', '--pretty=oneline', '--abbrev=8', '--date iso', '--encoding UTF-8'])(
    'normalizes presentation option arity without consuming a revision: %s',
    async (option) => {
      const { repo, introduce } = fixture();
      expect(await resolveCommitInspection(`git show ${option} HEAD~2`, repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [introduce]
      });
    }
  );

  it('preserves subdirectory and implicit path disambiguation', async () => {
    const { repo, commit } = fixture();
    mkdirSync(join(repo, 'sub'));
    const local = commit('local path', 'sub/local', 'local\n');
    expect(await resolveCommitInspection('git log local', join(repo, 'sub'))).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [local]
    });
    expect(await resolveCommitInspection('git log -- y', join(repo, 'sub'))).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: []
    });
  });

  it('rejects annotated tags and explicit non-commit object identities', async () => {
    const { repo } = fixture();
    git(repo, 'tag', '-am', 'annotation', 'annotated');
    for (const revision of ['annotated', git(repo, 'rev-parse', 'HEAD^{tree}'), git(repo, 'rev-parse', 'HEAD:x')]) {
      expect(await resolveCommitInspection(`git show ${revision}`, repo)).toEqual({
        kind: 'unsupported',
        recognized: true
      });
    }
  });

  it('rejects replacement refs rather than changing the inspected history', async () => {
    const { repo, introduce, remove } = fixture();
    git(repo, 'replace', remove, introduce);
    expect(await resolveCommitInspection('git log', repo)).toEqual({ kind: 'unsupported', recognized: true });
  });

  it('rejects configured external diff and text conversion helpers', async () => {
    const { repo } = fixture();
    git(repo, 'config', 'diff.custom.textconv', 'a-helper-that-must-never-run');
    expect(await resolveCommitInspection('git log -S TOKEN', repo)).toEqual({ kind: 'unsupported', recognized: true });
  });

  it.each(['git log -n1 &', 'git show&', 'cd . && git log -n1&'])(
    'recognizes background inspection without treating it as completed: %s',
    async (command) => {
      const { repo } = fixture();
      expect(await resolveCommitInspection(command, repo)).toEqual({ kind: 'unsupported', recognized: true });
    }
  );

  it.each(["git log --grep='root&literal'", 'git log --grep="root&literal"', 'git log --grep=root\\&literal'])(
    'allows literal quoted or escaped ampersands in arguments: %s',
    async (command) => {
      const { repo } = fixture();
      expect(await resolveCommitInspection(command, repo)).toEqual({ kind: 'selected', repoRoot: repo, commits: [] });
    }
  );

  it.each([
    { options: '', selected: true },
    { options: '--oneline', selected: false },
    { options: '--pretty', selected: false },
    { options: '--pretty=medium', selected: false },
    { options: '--format=%H', selected: false },
    { options: '--notes', selected: true },
    { options: '--show-notes', selected: true },
    { options: '--oneline --notes', selected: true },
    { options: '--notes --oneline', selected: true },
    { options: '--no-notes', selected: false },
    { options: '--notes --no-notes', selected: false },
    { options: '--no-notes --notes', selected: true }
  ])('preserves note-sensitive grep selection with $options', async ({ options, selected }) => {
    const { repo, root } = fixture();
    git(repo, 'notes', 'add', '-m', 'NOTETOKEN', root);
    const args = options === '' ? [] : options.split(' ');
    expect(git(repo, 'log', ...args, '--grep=NOTETOKEN').includes(root.slice(0, 7))).toBe(selected);
    expect(await resolveCommitInspection(`git log ${options} --grep=NOTETOKEN`, repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: selected ? [root] : []
    });
  });

  it('preserves notes with all-match and inverted grep filters', async () => {
    const { repo, root, introduce, other, remove } = fixture();
    git(repo, 'notes', 'add', '-m', 'NOTETOKEN', root);
    expect(await resolveCommitInspection('git log --grep=root --grep=NOTETOKEN --all-match', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [root]
    });
    expect(await resolveCommitInspection('git log --grep=NOTETOKEN --invert-grep', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [remove, other, introduce]
    });
  });

  it('retains explicit custom notes refs and configured default display refs', async () => {
    const { repo, root } = fixture();
    git(repo, 'notes', '--ref=custom', 'add', '-m', 'CUSTOMTOKEN', root);
    expect(await resolveCommitInspection('git log --oneline --notes=custom --grep=CUSTOMTOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [root]
    });
    git(repo, 'config', 'notes.displayRef', 'refs/notes/custom');
    expect(await resolveCommitInspection('git log --grep=CUSTOMTOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [root]
    });
    expect(await resolveCommitInspection('git log --oneline --grep=CUSTOMTOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: []
    });
  });

  it('uses inherited native notes ref selection without affecting repository discovery', async () => {
    const { repo, root } = fixture();
    git(repo, 'notes', '--ref=custom', 'add', '-m', 'CUSTOMTOKEN', root);
    const original = process.env.GIT_NOTES_REF;
    process.env.GIT_NOTES_REF = 'refs/notes/custom';
    try {
      expect(await resolveCommitInspection('git log --grep=CUSTOMTOKEN', repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [root]
      });
    } finally {
      if (original === undefined) delete process.env.GIT_NOTES_REF;
      else process.env.GIT_NOTES_REF = original;
    }
  });

  it('keeps implicit notes selection when formatting comes from repository configuration', async () => {
    const { repo, root } = fixture();
    git(repo, 'notes', 'add', '-m', 'NOTETOKEN', root);
    git(repo, 'config', 'format.pretty', 'oneline');
    expect(await resolveCommitInspection('git log --grep=NOTETOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [root]
    });
  });

  it.each([
    { format: '%N', selected: true },
    { format: '%+N', selected: true },
    { format: '%-N', selected: true },
    { format: '% N', selected: true },
    { format: '%%N', selected: false },
    { format: '%%%N', selected: true },
    { format: '%x25N', selected: false },
    { format: '%x%N', selected: true }
  ])('uses native note-placeholder semantics for $format', async ({ format, selected }) => {
    const { repo, root } = fixture();
    git(repo, 'notes', 'add', '-m', 'NOTETOKEN', root);
    expect(Boolean(git(repo, 'log', `--format=${format}`, '--grep=NOTETOKEN'))).toBe(selected);
    expect(await resolveCommitInspection(`git log --format='${format}' --grep=NOTETOKEN`, repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: selected ? [root] : []
    });
  });

  it.each(['format:%N', 'format:%%N', 'format:%+N'])(
    'keeps implicit note filtering with configured format.pretty=$format',
    async (format) => {
      const { repo, root } = fixture();
      git(repo, 'notes', 'add', '-m', 'NOTETOKEN', root);
      git(repo, 'config', 'format.pretty', format);
      expect(Boolean(git(repo, 'log', '--grep=NOTETOKEN'))).toBe(true);
      expect(await resolveCommitInspection('git log --grep=NOTETOKEN', repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [root]
      });
    }
  );

  it.each(["--format='%(trailers:key=%N)'", '--format=%N --pretty=medium', '--pretty=custom'])(
    'fails closed on unresolved note-sensitive formatting interactions: %s',
    async (options) => {
      const { repo } = fixture();
      git(repo, 'config', 'pretty.custom', '%N');
      expect(await resolveCommitInspection(`git log ${options} --grep=NOTETOKEN`, repo)).toEqual({
        kind: 'unsupported',
        recognized: true
      });
    }
  );

  it('preserves explicit no-notes and custom refs even when a userformat requests notes', async () => {
    const { repo, root } = fixture();
    git(repo, 'notes', 'add', '-m', 'NOTETOKEN', root);
    git(repo, 'notes', '--ref=custom', 'add', '-m', 'CUSTOMTOKEN', root);
    expect(await resolveCommitInspection('git log --no-notes --format=%N --grep=NOTETOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: []
    });
    expect(await resolveCommitInspection('git log --format=%N --notes=custom --grep=CUSTOMTOKEN', repo)).toEqual({
      kind: 'selected',
      repoRoot: repo,
      commits: [root]
    });
  });

  it('inherits native GIT_NOTES_DISPLAY_REF for implicit note filtering', async () => {
    const { repo, root } = fixture();
    git(repo, 'notes', '--ref=custom', 'add', '-m', 'CUSTOMTOKEN', root);
    const original = process.env.GIT_NOTES_DISPLAY_REF;
    process.env.GIT_NOTES_DISPLAY_REF = 'refs/notes/custom';
    try {
      expect(await resolveCommitInspection('git log --grep=CUSTOMTOKEN', repo)).toEqual({
        kind: 'selected',
        repoRoot: repo,
        commits: [root]
      });
    } finally {
      if (original === undefined) delete process.env.GIT_NOTES_DISPLAY_REF;
      else process.env.GIT_NOTES_DISPLAY_REF = original;
    }
  });

  it('fails closed when the selected history exceeds 4096 commits', async () => {
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
