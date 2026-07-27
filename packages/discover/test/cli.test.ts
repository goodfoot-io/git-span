/**
 * Tests for the CLI layer: loc/line rendering, argv handling, exit codes,
 * and an end-to-end run against a real temp repository.
 *
 * @summary Verifies CLI parsing, rendering, and exit behavior.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatCandidateLine, formatLoc, runCli } from '../src/cli.js';

/**
 * Run a git command in a fixture repo with a deterministic identity.
 *
 * @param args - Git arguments.
 * @param cwd - Repository directory.
 */
function git(args: readonly string[], cwd: string): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2024-03-01T10:00:00Z',
      GIT_COMMITTER_DATE: '2024-03-01T10:00:00Z'
    }
  });
}

/**
 * Write a fixture file, creating parent directories.
 *
 * @param root - Repository root.
 * @param relPath - Repository-relative path.
 * @param content - File content.
 */
function write(root: string, relPath: string, content: string): void {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('formatLoc', () => {
  it('renders a whole-file loc as the bare path', () => {
    expect(formatLoc({ path: 'src/a.ts' })).toBe('src/a.ts');
  });

  it('renders a range loc in L-notation', () => {
    expect(formatLoc({ path: 'src/a.ts', start: 3, end: 9 })).toBe('src/a.ts:L3-L9');
  });

  it('collapses a start-only loc to a single-line range', () => {
    expect(formatLoc({ path: 'src/a.ts', start: 5 })).toBe('src/a.ts:L5-L5');
  });
});

describe('formatCandidateLine', () => {
  it('joins rendered locs with comma-space', () => {
    const line = formatCandidateLine({
      locs: [{ path: 'a.ts', start: 1, end: 2 }, { path: 'b.sql' }],
      score: 0.9,
      signal: 'x',
      evidence: []
    });
    expect(line).toBe('a.ts:L1-L2, b.sql');
  });
});

describe('runCli', () => {
  it('prints usage and exits 0 on --help', () => {
    const out: string[] = [];
    const code = runCli(
      ['--help'],
      (l) => out.push(l),
      () => {}
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('Usage: discover');
  });

  it('exits 2 with usage on an unknown flag', () => {
    const err: string[] = [];
    const code = runCli(
      ['--bogus'],
      () => {},
      (l) => err.push(l)
    );
    expect(code).toBe(2);
    expect(err.join('\n')).toContain('Usage: discover');
  });

  it('fails closed (exit 1) on a non-numeric --min-score', () => {
    const err: string[] = [];
    const code = runCli(
      ['--min-score', 'abc'],
      () => {},
      (l) => err.push(l)
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('--min-score');
  });

  it('fails closed (exit 1) on an invalid repo', () => {
    const err: string[] = [];
    const code = runCli(
      ['--repo', '/nonexistent-discover-test-dir'],
      () => {},
      (l) => err.push(l)
    );
    expect(code).toBe(1);
    expect(err.length).toBeGreaterThan(0);
  });

  describe('against a real repository', () => {
    let root: string;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-cli-'));
      git(['init', '--initial-branch=main'], root);
      write(root, 'src/alpha.ts', 'export const alpha = 1;\n// keep in sync with src/beta.ts\nexport const a2 = 2;\n');
      write(root, 'src/beta.ts', 'export const beta = 1;\n');
      git(['add', '.'], root);
      git(['commit', '-m', 'Add alpha and beta'], root);
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('prints ranked coupling lines in the path[:Lstart-Lend] notation', () => {
      const out: string[] = [];
      const err: string[] = [];
      const code = runCli(
        ['--repo', root, '--min-score', '0.3'],
        (l) => out.push(l),
        (l) => err.push(l)
      );
      expect(code).toBe(0);
      expect(err).toEqual([]);
      expect(out.length).toBeGreaterThan(0);
      const lineFormat = /^\S+(?::L\d+-L\d+)?(?:, \S+(?::L\d+-L\d+)?)+$/;
      for (const line of out) {
        expect(line).toMatch(lineFormat);
      }
      const joined = out.join('\n');
      expect(joined).toContain('src/alpha.ts');
      expect(joined).toContain('src/beta.ts');
    });

    it('writes a JSON report matching the printed candidates when --json is given', () => {
      const jsonPath = path.join(root, 'report.json');
      const out: string[] = [];
      const code = runCli(
        ['--repo', root, '--min-score', '0.3', '--json', jsonPath],
        (l) => out.push(l),
        () => {}
      );
      expect(code).toBe(0);
      const parsed: unknown = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const candidates = (parsed as { candidates: { locs: { path: string }[]; score: number }[] }).candidates;
      expect(candidates).toHaveLength(out.length);
      expect(candidates[0]!.score).toBeGreaterThan(0);
    });
  });
});
