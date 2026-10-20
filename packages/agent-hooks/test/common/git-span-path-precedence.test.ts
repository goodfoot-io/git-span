/** Hooks must prefer the selected PATH CLI over Git's private executable directory. */
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executableOnPath } from '../../src/common/commit-native-io.js';
import { startContextWarmup, type WarmupSpawner } from '../../src/common/context-warmup.js';
import { resolveGitSpanCommand } from '../../src/common/git-span-command.js';
import { createDefaultDriftExecutor, createDefaultSpanExecutor } from '../../src/common/span-surface.js';
import { createDefaultTouchExecutors } from '../../src/common/touch-core.js';

let scratch: string;
let selected: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'git-span PATH precedence '));
  const pathDirectory = join(scratch, 'path');
  const gitDirectory = join(scratch, 'git-exec');
  mkdirSync(pathDirectory);
  mkdirSync(gitDirectory);
  selected = join(pathDirectory, 'git-span');
  const document = JSON.stringify({
    schema_version: 1,
    scopes: [],
    mutation: {
      requested: false,
      rewritten: false,
      spans_touched: 0,
      anchors_updated: 0,
      anchors_removed: 0,
      identities_collapsed: 0
    },
    spans: []
  });
  writeFileSync(
    selected,
    `#!/bin/sh\nif [ "$1" = context ]; then printf '%s' '${document}'; else printf '%s' path-version; fi\n`,
    { mode: 0o755 }
  );
  writeFileSync(join(gitDirectory, 'git-span'), '#!/bin/sh\nprintf "%s" git-exec-version\n', { mode: 0o755 });
  vi.stubEnv('PATH', `${pathDirectory}${delimiter}${process.env.PATH ?? ''}`);
  vi.stubEnv('GIT_EXEC_PATH', gitDirectory);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe('git-span selected on PATH', () => {
  it('uses PATH for synchronous span listing and drift', () => {
    expect(createDefaultSpanExecutor()([], scratch)).toBe('path-version');
    expect(createDefaultDriftExecutor()([], scratch)).toBe('path-version');
  });

  it('resolves relative PATH entries in the subprocess working directory', () => {
    vi.stubEnv('PATH', 'path');
    expect(createDefaultSpanExecutor()([], scratch)).toBe('path-version');
  });

  it('retains Git exec-path installations when PATH has no git-span', () => {
    symlinkSync(executableOnPath('git'), join(dirname(selected), 'git'));
    rmSync(selected);
    vi.stubEnv('PATH', dirname(selected));
    expect(createDefaultSpanExecutor()([], scratch)).toBe('git-exec-version');
  });

  it('uses PATH for strict context requests', async () => {
    const result = await createDefaultTouchExecutors().context({ repoRoot: scratch, addresses: [], repair: false });
    expect(result).toMatchObject({ ok: true, document: { schema_version: 1 } });
  });

  it('uses PATH for detached warmup clients', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);
    startContextWarmup(scratch, vi.fn(), spawn as unknown as WarmupSpawner);
    expect(spawn.mock.calls[0]?.slice(0, 2)).toEqual([selected, ['context', '--warm']]);
  });

  it('keeps an earlier Windows npm shim ahead of a later native executable', () => {
    writeFileSync(join(dirname(selected), 'git-span.cmd'), 'shim', { mode: 0o755 });
    writeFileSync(join(scratch, 'git-span.exe'), 'native', { mode: 0o755 });
    vi.stubEnv('PATH', `${dirname(selected)};${scratch}`);
    vi.stubEnv('PATHEXT', '.EXE;.CMD');
    expect(resolveGitSpanCommand(['context', 'a b.ts'], scratch, 'git', 'win32')).toEqual({
      executable: 'git',
      argv: [`--exec-path=${dirname(selected)}`, 'span', 'context', 'a b.ts']
    });
  });

  it('invokes a Windows native PATH executable directly', () => {
    const executable = join(dirname(selected), 'git-span.exe');
    writeFileSync(executable, 'native', { mode: 0o755 });
    vi.stubEnv('PATH', dirname(selected));
    vi.stubEnv('PATHEXT', '.EXE;.CMD');
    expect(resolveGitSpanCommand(['notes', 'list'], scratch, 'git', 'win32')).toEqual({
      executable,
      argv: ['notes', 'list']
    });
  });
});
