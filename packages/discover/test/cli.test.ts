/**
 * CLI-level tests for src/cli.ts's `main`: error presentation for a
 * non-git/missing path (finding 2) and stage-boundary progress breadcrumbs
 * on stderr (finding 3). The full mining pipeline itself is covered by
 * pipeline.test.ts — these tests exercise only `main`'s argv/exit-code/output
 * plumbing around it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';

describe('main', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('prints a short, clean message and exits non-zero for a non-git directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-not-a-repo-'));
    try {
      const exitCode = await main([dir]);

      expect(exitCode).not.toBe(0);
      const stderrOutput = stderrSpy.mock.calls.map((call: unknown[]) => call[0]).join('');
      expect(stderrOutput).toContain(`not a git repository: ${dir}`);
      // The raw internal git argv/command dump must not leak to the user.
      expect(stderrOutput).not.toContain('--unified=0');
      expect(stderrOutput).not.toContain('Command failed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints a short, clean message and exits non-zero for a missing path', async () => {
    const missing = path.join(os.tmpdir(), 'git-span-discover-does-not-exist-xyz');
    fs.rmSync(missing, { recursive: true, force: true });

    const exitCode = await main([missing]);

    expect(exitCode).not.toBe(0);
    const stderrOutput = stderrSpy.mock.calls.map((call: unknown[]) => call[0]).join('');
    expect(stderrOutput).toContain(`not a git repository: ${missing}`);
    expect(stderrOutput).not.toContain('Command failed');
  });

  it('emits stage-boundary progress breadcrumbs to stderr during a real run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-span-discover-progress-'));
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('git', ['-C', dir, 'init', '--quiet', '--initial-branch=main']);
      execFileSync('git', ['-C', dir, 'config', 'user.email', 'fixture@example.com']);
      execFileSync('git', ['-C', dir, 'config', 'user.name', 'Fixture Builder']);
      fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
      execFileSync('git', ['-C', dir, 'add', '-A']);
      execFileSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'Initial commit']);

      const exitCode = await main([dir, '--json']);

      expect(exitCode).toBe(0);
      const stderrOutput = stderrSpy.mock.calls.map((call: unknown[]) => call[0]).join('');
      expect(stderrOutput).toContain('running signals');
      expect(stderrOutput).toContain('rendering report');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
