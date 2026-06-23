/**
 * Tests for fork-dispatch executable resolution and invocation building
 * (packages/agent-hooks/src/fork-dispatch.ts).
 *
 * The chain walk and resolution run against a simulated process tree via an
 * injected ProcReader — no real /proc, no spawn.
 */

import { describe, expect, it } from 'vitest';
import { buildForkInvocation, type ProcReader, resolveClaudeExecutable } from '../src/fork-dispatch.js';

// ---------------------------------------------------------------------------
// Simulated process tree
// ---------------------------------------------------------------------------

interface FakeProc {
  comm: string;
  ppid: number | null;
  exe?: string | null;
  cmdline?: string[] | null;
  pathEnv?: string | null;
}

function makeReader(procs: Record<number, FakeProc>, existing: Iterable<string> = []): ProcReader {
  const present = new Set(existing);
  return {
    ppidOf: (pid) => procs[pid]?.ppid ?? null,
    commOf: (pid) => procs[pid]?.comm ?? null,
    exeOf: (pid) => procs[pid]?.exe ?? null,
    cmdlineOf: (pid) => procs[pid]?.cmdline ?? null,
    pathEnvOf: (pid) => procs[pid]?.pathEnv ?? null,
    exists: (p) => present.has(p)
  };
}

// ---------------------------------------------------------------------------
// resolveClaudeExecutable
// ---------------------------------------------------------------------------

describe('resolveClaudeExecutable: standalone binary', () => {
  it('resolves a standalone claude via PATH when /proc/exe is "(deleted)"', () => {
    // Mirrors the live environment: comm=claude, argv0=claude, the install path
    // swapped out from under the running process, the stable binary on PATH.
    const reader = makeReader(
      {
        90: { comm: 'zsh', ppid: 80 }, // the shell that ran the hook
        80: {
          comm: 'claude',
          ppid: 70,
          exe: '/install/.claude-code-Xyz/bin/claude.exe (deleted)',
          cmdline: ['claude'],
          pathEnv: '/usr/local/bin:/bin'
        }
      },
      ['/usr/local/bin/claude']
    );

    const resolved = resolveClaudeExecutable(90, reader);
    expect(resolved).toEqual({ command: '/usr/local/bin/claude', baseArgs: [] });
  });

  it('uses /proc/exe directly when it points at a live standalone binary', () => {
    const reader = makeReader(
      {
        80: { comm: 'claude', ppid: 1, exe: '/usr/local/bin/claude', cmdline: ['claude'] }
      },
      ['/usr/local/bin/claude']
    );

    const resolved = resolveClaudeExecutable(80, reader);
    expect(resolved).toEqual({ command: '/usr/local/bin/claude', baseArgs: [] });
  });
});

describe('resolveClaudeExecutable: node <cli.js> shape', () => {
  it('returns the node binary plus the cli.js entry as baseArgs', () => {
    const reader = makeReader(
      {
        80: {
          comm: 'node',
          ppid: 1,
          exe: '/usr/bin/node',
          cmdline: ['node', '/opt/claude/cli.js'],
          pathEnv: '/usr/bin'
        }
      },
      ['/usr/bin/node']
    );

    const resolved = resolveClaudeExecutable(80, reader);
    expect(resolved).toEqual({ command: '/usr/bin/node', baseArgs: ['/opt/claude/cli.js'] });
  });

  it('falls back to PATH for node when /proc/exe is unreadable', () => {
    const reader = makeReader(
      {
        80: {
          comm: 'node',
          ppid: 1,
          exe: null,
          cmdline: ['node', '/opt/claude/cli.js'],
          pathEnv: '/usr/bin'
        }
      },
      ['/usr/bin/node']
    );

    const resolved = resolveClaudeExecutable(80, reader);
    expect(resolved).toEqual({ command: '/usr/bin/node', baseArgs: ['/opt/claude/cli.js'] });
  });
});

describe('resolveClaudeExecutable: chain walk', () => {
  it('skips nested shells to find the launching claude', () => {
    const reader = makeReader(
      {
        70: { comm: 'bash', ppid: 60 },
        60: { comm: 'sh', ppid: 50 },
        50: { comm: 'zsh', ppid: 40 },
        40: { comm: 'claude', ppid: 1, cmdline: ['claude'], pathEnv: '/usr/local/bin' }
      },
      ['/usr/local/bin/claude']
    );

    const resolved = resolveClaudeExecutable(70, reader);
    expect(resolved).toEqual({ command: '/usr/local/bin/claude', baseArgs: [] });
  });

  it('steps over a non-shell ancestor that is not claude and keeps walking', () => {
    const reader = makeReader(
      {
        80: { comm: 'python3', ppid: 70, exe: '/usr/bin/python3', cmdline: ['python3', 'x.py'], pathEnv: '/usr/bin' },
        70: {
          comm: 'claude',
          ppid: 1,
          exe: '/install/claude.exe (deleted)',
          cmdline: ['claude'],
          pathEnv: '/usr/local/bin'
        }
      },
      ['/usr/bin/python3', '/usr/local/bin/claude']
    );

    const resolved = resolveClaudeExecutable(80, reader);
    expect(resolved).toEqual({ command: '/usr/local/bin/claude', baseArgs: [] });
  });

  it('returns null when no claude-like ancestor exists', () => {
    const reader = makeReader(
      {
        80: { comm: 'python3', ppid: 70, exe: '/usr/bin/python3', cmdline: ['python3', 'x.py'], pathEnv: '/usr/bin' },
        70: { comm: 'zsh', ppid: 1 }
      },
      ['/usr/bin/python3']
    );

    expect(resolveClaudeExecutable(80, reader)).toBeNull();
  });

  it('returns null when the walk only ever sees shells', () => {
    const reader = makeReader({
      90: { comm: 'zsh', ppid: 1 }
    });
    expect(resolveClaudeExecutable(90, reader)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildForkInvocation
// ---------------------------------------------------------------------------

describe('buildForkInvocation', () => {
  it('builds the headless fork invocation for a standalone binary', () => {
    const { command, args } = buildForkInvocation(
      { command: '/usr/local/bin/claude', baseArgs: [] },
      'sess-1',
      'PROMPT TEXT'
    );
    expect(command).toBe('/usr/local/bin/claude');
    expect(args).toEqual(['-p', '--resume', 'sess-1', '--fork-session', 'PROMPT TEXT']);
  });

  it('prepends the cli.js entry for the node shape', () => {
    const { command, args } = buildForkInvocation(
      { command: '/usr/bin/node', baseArgs: ['/opt/claude/cli.js'] },
      'sess-2',
      'PROMPT'
    );
    expect(command).toBe('/usr/bin/node');
    expect(args).toEqual(['/opt/claude/cli.js', '-p', '--resume', 'sess-2', '--fork-session', 'PROMPT']);
  });
});
