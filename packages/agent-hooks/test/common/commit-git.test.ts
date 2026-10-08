import { describe, expect, it } from 'vitest';
import { parseCommitGitInvocation } from '../../src/common/commit-git.js';

describe('actual Git argv classification', () => {
  it('preserves argv while resolving repeated relative -C and repository global options', () => {
    const argv = [
      '-C',
      'parent',
      '-C',
      '../repo',
      '-c',
      'user.name=Agent',
      '--config-env=user.email=EMAIL',
      '--git-dir=.git',
      '--work-tree=.',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'initial'
    ];
    const result = parseCommitGitInvocation(argv, '/base');
    expect(result).toMatchObject({
      ok: true,
      value: {
        argv,
        effectiveCwd: '/base/repo',
        command: 'commit',
        builtinCommit: true,
        dryRun: false,
        gitDirectory: '.git',
        workTree: '.'
      }
    });
    if (result.ok) expect(result.value.globalArguments).toEqual(argv.slice(0, 9));
  });
  it.each(
    [
      ['--git-dir', '/repo/.git', '--work-tree', '/repo', 'commit'],
      ['-C/repo', '-cuser.name=Agent', 'commit'],
      ['--no-pager', 'commit']
    ].map((argv) => ({ argv }))
  )('recognizes supported global layout %#', ({ argv }) => {
    expect(parseCommitGitInvocation(argv, '/base')).toMatchObject({ ok: true, value: { builtinCommit: true } });
  });
  it.each(['checkout', 'reset', 'fetch', 'push', 'merge', 'commit-tree', 'ci'])(
    'forwards %s without builtin commit evidence',
    (command) => {
      expect(parseCommitGitInvocation([command], '/repo')).toMatchObject({
        ok: true,
        value: { command, builtinCommit: false }
      });
    }
  );
  it.each(
    [
      ['commit', '--dry-run'],
      ['commit', '-n', '--dry-run'],
      ['commit', '-m', '--dry-run']
    ].map((argv) => ({ argv }))
  )('distinguishes dry-run from consumed option text %#', ({ argv }) => {
    expect(parseCommitGitInvocation(argv, '/repo')).toMatchObject({
      ok: true,
      value: { dryRun: argv.indexOf('-m') < 0 }
    });
  });
  it.each(
    [
      [],
      ['-C'],
      ['-c'],
      ['--config-env'],
      ['--git-dir'],
      ['--work-tree'],
      ['--unknown', 'commit'],
      ['--', 'commit']
    ].map((argv) => ({ argv }))
  )('suppresses unknown or incomplete global layout %#', ({ argv }) => {
    expect(parseCommitGitInvocation(argv, '/repo').ok).toBe(false);
  });
});
