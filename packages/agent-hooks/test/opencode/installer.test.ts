/**
 * Witness tests for the opencode-git-span installer
 * (plugins-opencode/git-span/bin/opencode-git-span.mjs).
 *
 * Canonical contract (evaluation F1, upstream PR #6132): the `--global` target
 * is the XDG config directory OpenCode actually scans — `$XDG_CONFIG_HOME/opencode`
 * when set, else `~/.config/opencode` — never `~/.opencode`. The project target
 * stays `<cwd>/.opencode`, re-running over existing files is safe (idempotency),
 * and the success summary names the real destination.
 *
 * The suite spawns the real bin with stubbed HOME/XDG env and temp cwds, so it
 * exercises exactly what ships.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const packageRoot = join(process.cwd(), '..', '..', 'plugins-opencode', 'git-span');
const binPath = join(packageRoot, 'bin', 'opencode-git-span.mjs');
const skillsSource = join(packageRoot, 'skills');

/** Skill directory names shipped by the package (the install manifest). */
function skillNames(): string[] {
  return readdirSync(skillsSource).filter((name) =>
    readdirSync(join(skillsSource, name)).some((f) => f === 'SKILL.md')
  );
}

interface InstallResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runInstaller(args: string[], cwd: string, env: Record<string, string>): InstallResult {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

function expectInstalled(target: string): void {
  for (const name of skillNames()) {
    expect(existsSync(join(target, 'skills', name, 'SKILL.md')), join(target, 'skills', name)).toBe(true);
  }
  expect(existsSync(join(target, 'agents', 'expert.md'))).toBe(true);
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe('opencode-git-span installer — project target', () => {
  it('installs skills + expert agent under <cwd>/.opencode and names the destination', () => {
    const cwd = scratchDir('installer-project-');
    const result = runInstaller(['install'], cwd, {});
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expectInstalled(join(cwd, '.opencode'));
    // The summary names the real destination (relative to cwd here).
    expect(result.stdout).toContain('.opencode');
    for (const name of skillNames()) {
      expect(result.stdout).toContain(join(cwd, '.opencode', 'skills', name));
    }
    expect(result.stdout).toContain(join(cwd, '.opencode', 'agents', 'expert.md'));
  });

  it('re-running over existing files is safe (idempotency)', () => {
    const cwd = scratchDir('installer-idem-');
    expect(runInstaller(['install'], cwd, {}).status).toBe(0);
    const second = runInstaller(['install'], cwd, {});
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
    expectInstalled(join(cwd, '.opencode'));
  });
});

describe('opencode-git-span installer — --global target is the XDG config dir', () => {
  it('targets $XDG_CONFIG_HOME/opencode when XDG_CONFIG_HOME is set', () => {
    const xdg = scratchDir('installer-xdg-');
    const home = scratchDir('installer-home-');
    const result = runInstaller(['install', '--global'], home, {
      HOME: home,
      XDG_CONFIG_HOME: xdg
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    // The host's own discovery honors $XDG_CONFIG_HOME/opencode first…
    expectInstalled(join(xdg, 'opencode'));
    // …and the legacy ~/.opencode tree must stay untouched.
    expect(existsSync(join(home, '.opencode'))).toBe(false);
    // The success output names the real (absolute) destination — never a
    // confusing relative path reaching outside the cwd.
    expect(result.stdout).toContain(join(xdg, 'opencode'));
  });

  it('falls back to ~/.config/opencode when XDG_CONFIG_HOME is unset or empty', () => {
    const home = scratchDir('installer-home2-');
    const withoutVar = runInstaller(['install', '--global'], home, { HOME: home, XDG_CONFIG_HOME: '' });
    expect(withoutVar.status).toBe(0);
    expectInstalled(join(home, '.config', 'opencode'));
    expect(existsSync(join(home, '.opencode'))).toBe(false);
    expect(withoutVar.stdout).toContain(join(home, '.config', 'opencode'));

    const home3 = scratchDir('installer-home3-');
    const deleted = { ...process.env };
    delete deleted.XDG_CONFIG_HOME;
    const result = spawnSync(process.execPath, [binPath, 'install', '--global'], {
      cwd: home3,
      env: { ...deleted, HOME: home3 },
      encoding: 'utf8'
    });
    expect(result.status).toBe(0);
    expectInstalled(join(home3, '.config', 'opencode'));
  });
});
