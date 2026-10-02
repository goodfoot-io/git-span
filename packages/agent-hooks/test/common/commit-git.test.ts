import { describe, expect, it } from 'vitest';
import {
  type CommitCreationEvidence,
  parseCommitGitInvocation,
  validateCommitCreationEvidence
} from '../../src/common/commit-git.js';
import { nonce, sha } from './commit-fixtures.js';

function record(previous = '0'.repeat(40), next = sha, action = nonce): string {
  return `${previous} ${next} Agent <agent@example.test> 1700000000 +0000\t${action}: initial\n`;
}
function evidence(text = record()): CommitCreationEvidence {
  const bytes = new TextEncoder().encode(text);
  return {
    checkpoint: { existed: false, offset: 0 },
    append: { device: '1', inode: '2', fileSize: bytes.length, bytes, exceededBudget: false },
    nonce,
    objectFormat: 'sha1',
    gitExitCode: 0,
    gitSignal: null,
    builtinCommit: true,
    dryRun: false
  };
}

describe('actual Git argv classification', () => {
  it.skip('preserves argv while resolving repeated relative -C and repository global options', () => {
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
  it.skip.each(
    [
      ['--git-dir', '/repo/.git', '--work-tree', '/repo', 'commit'],
      ['-C/repo', '-cuser.name=Agent', 'commit'],
      ['--no-pager', 'commit']
    ].map((argv) => ({ argv }))
  )('recognizes supported global layout %#', ({ argv }) => {
    expect(parseCommitGitInvocation(argv, '/base')).toMatchObject({ ok: true, value: { builtinCommit: true } });
  });
  it.skip.each(['checkout', 'reset', 'fetch', 'push', 'merge', 'commit-tree', 'ci'])(
    'forwards %s without builtin commit evidence',
    (command) => {
      expect(parseCommitGitInvocation([command], '/repo')).toMatchObject({
        ok: true,
        value: { command, builtinCommit: false }
      });
    }
  );
  it.skip.each(
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
  it.skip.each(
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

describe('nonce-tagged reflog creation witness', () => {
  it.skip('captures unborn commit SHA independently of any later HEAD or stdout', () => {
    expect(validateCommitCreationEvidence(evidence())).toEqual({ ok: true, value: sha });
  });
  it.skip('ignores unrelated records and tolerates an incomplete trailing record', () => {
    expect(
      validateCommitCreationEvidence(evidence(`${record('b'.repeat(40), sha, 'other')}${record()}partial`))
    ).toEqual({ ok: true, value: sha });
  });
  it.skip('accepts appended evidence from the original inode and offset', () => {
    const value = evidence();
    expect(
      validateCommitCreationEvidence({
        ...value,
        checkpoint: { existed: true, device: '1', inode: '2', offset: 10 },
        append: { ...value.append!, fileSize: value.append!.fileSize + 10 }
      })
    ).toEqual({ ok: true, value: sha });
  });
  it.skip('uses the actual SHA-256 object format', () => {
    const fullSha = 'd'.repeat(64);
    expect(
      validateCommitCreationEvidence({ ...evidence(record('0'.repeat(64), fullSha)), objectFormat: 'sha256' })
    ).toEqual({ ok: true, value: fullSha });
  });
  it.skip.each([
    { gitExitCode: 1 },
    { gitExitCode: null, gitSignal: 'SIGTERM' },
    { dryRun: true },
    { builtinCommit: false },
    { append: null }
  ])('rejects failed, signalled, unsupported or missing evidence %#', (changed) => {
    expect(validateCommitCreationEvidence({ ...evidence(), ...changed }).ok).toBe(false);
  });
  it.skip.each([
    record() + record(),
    record('0'.repeat(40), sha, `prefix-${nonce}`),
    record('0'.repeat(40), '0'.repeat(40)),
    record('0'.repeat(40), 'z'.repeat(40)),
    record().trimEnd(),
    'spoofed stdout'
  ])('rejects ambiguous, forged or truncated records %#', (text) => {
    expect(validateCommitCreationEvidence(evidence(text)).ok).toBe(false);
  });
  it.skip.each([{ inode: 'replacement' }, { device: 'replacement' }, { fileSize: 0 }, { exceededBudget: true }])(
    'rejects replacement, truncation or overflow %#',
    (changed) => {
      const value = evidence();
      expect(
        validateCommitCreationEvidence({
          ...value,
          checkpoint: { existed: true, device: '1', inode: '2', offset: 10 },
          append: { ...value.append!, fileSize: value.append!.fileSize + 10, ...changed }
        }).ok
      ).toBe(false);
    }
  );
});
