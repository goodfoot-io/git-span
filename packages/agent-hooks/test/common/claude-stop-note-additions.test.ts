import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Logger, type StopInput } from '@goodfoot/agent-hooks/claude-code';
import { describe, expect, it } from 'vitest';
import { createHandler } from '../../src/claude/stop.js';
import { resolveGitSpanCommand } from '../../src/common/git-span-command.js';
import { makeTempLayout } from '../session-layout-helpers.js';

function fixture() {
  const temp = makeTempLayout();
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', temp.parent, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args]);
  git('init', '-q');
  const input: StopInput = {
    hook_event_name: 'Stop',
    cwd: temp.parent,
    session_id: 'note-additions-session',
    transcript_path: '',
    permission_mode: 'default',
    stop_hook_active: false
  };
  const context = { logger: new Logger() };
  let sequence = 0;
  const commit = (...paths: string[]) => {
    for (const path of paths) {
      const absolute = join(temp.parent, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `change ${++sequence}\n`);
    }
    git('add', '--', ...paths);
    git('commit', '-q', '-m', 'fixture');
  };
  const addNote = () => {
    const command = resolveGitSpanCommand(['notes', 'add', 'HEAD', '--format', 'json'], temp.parent);
    execFileSync(command.executable, command.argv, {
      cwd: temp.parent,
      input: JSON.stringify({
        kind: 'git-span/uncovered-commit',
        schema_version: 1,
        session_id: input.session_id,
        sequence: ++sequence
      })
    });
  };
  // Construct each handler afresh, as separate hook processes do in production.
  const stop = (cwd = input.cwd) => createHandler(undefined, temp.layout)({ ...input, cwd }, context);
  return { ...temp, git, commit, addNote, stop };
}

describe('Claude Stop only reviews newly added non-metadata notes', () => {
  it('does not repeat unchanged shared notes after switching linked worktrees', async () => {
    const repo = fixture();
    try {
      repo.commit('source.ts');
      repo.addNote();
      const linked = join(repo.parent, 'linked');
      repo.git('worktree', 'add', '--detach', linked, 'HEAD');
      expect((await repo.stop())?.stdout.decision).toBe('block');
      expect(await repo.stop(linked)).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it('persists the last stop and detects an additional note on the same commit', async () => {
    const repo = fixture();
    try {
      repo.commit('source.ts');
      repo.addNote();
      expect((await repo.stop())?.stdout.decision).toBe('block');
      expect(await repo.stop()).toBeNull();
      repo.addNote();
      expect((await repo.stop())?.stdout.decision).toBe('block');
      expect(await repo.stop()).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it.each(['.span', '.spans', 'custom-spans'])(
    'ignores notes about %s alone but reviews mixed commits',
    async (root) => {
      const repo = fixture();
      try {
        if (root === 'custom-spans') repo.git('config', 'git-span.dir', root);
        repo.commit(`${root}/metadata.json`);
        repo.addNote();
        expect(await repo.stop()).toBeNull();
        repo.commit(`${root}/metadata.json`, 'source.ts');
        repo.addNote();
        expect((await repo.stop())?.stdout.decision).toBe('block');
        expect(await repo.stop()).toBeNull();
      } finally {
        repo.cleanup();
      }
    }
  );
});
