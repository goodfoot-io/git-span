/**
 * End-to-end pipeline test against a purpose-built temp repository:
 * exercises sync comments, doc references, shared literals, exclusion
 * filtering, and global ranking invariants through the public barrel.
 *
 * @summary Integration test for the full discovery pipeline.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Candidate } from '../src/index.js';
import { discover, resolveConfig } from '../src/index.js';

/**
 * Run a git command in the fixture repo with a deterministic identity.
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

/**
 * Find candidates whose loc paths include every given path.
 *
 * @param candidates - Merged candidates.
 * @param paths - Paths that must all be present.
 * @returns Matching candidates.
 */
function withPaths(candidates: readonly Candidate[], paths: readonly string[]): Candidate[] {
  return candidates.filter((c) => paths.every((p) => c.locs.some((loc) => loc.path === p)));
}

describe('discover (integration)', () => {
  let root: string;
  let candidates: Candidate[];

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-int-'));
    git(['init', '--initial-branch=main'], root);
    write(
      root,
      'src/alpha.ts',
      [
        'export const alphaMarker = "XZQ_DISTINCTIVE_LITERAL_93417";',
        '// keep in sync with src/beta.ts',
        'export function alphaStep(): number {',
        '  return 41;',
        '}',
        ''
      ].join('\n')
    );
    write(root, 'src/beta.ts', 'export const betaStep = 41;\n');
    write(root, 'src/gamma.ts', 'export const gammaMarker = "XZQ_DISTINCTIVE_LITERAL_93417";\n');
    write(root, 'secret/hidden.ts', 'export const hiddenMarker = "XZQ_DISTINCTIVE_LITERAL_93417";\n');
    write(
      root,
      'docs/guide.md',
      '# Guide\n\nThe alpha step lives in [alpha](/src/alpha.ts#L2-L4) and drives the flow.\n'
    );
    write(root, 'docs/setup.md', '# Setup\n\nInstall dependencies and run the build.\n');
    write(root, 'docs/faq.md', '# FAQ\n\nNothing yet.\n');
    git(['add', '.'], root);
    git(['commit', '-m', 'Initial fixture'], root);
    candidates = discover(root, resolveConfig({ minScore: 0.3 })).candidates;
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds the sync-comment pair with high confidence', () => {
    const matches = withPaths(candidates, ['src/alpha.ts', 'src/beta.ts']);
    expect(matches.length).toBeGreaterThan(0);
    const best = matches.reduce((a, b) => (a.score >= b.score ? a : b));
    expect(best.score).toBeGreaterThanOrEqual(0.8);
  });

  it('finds the anchored doc reference and preserves its line range', () => {
    const matches = withPaths(candidates, ['docs/guide.md', 'src/alpha.ts']);
    expect(matches.length).toBeGreaterThan(0);
    const anchored = matches.flatMap((c) => c.locs).filter((loc) => loc.path === 'src/alpha.ts');
    expect(anchored.some((loc) => loc.start === 2 && loc.end === 4)).toBe(true);
  });

  it('finds the shared rare literal group', () => {
    const gammaGroups = candidates.filter((c) => c.locs.some((loc) => loc.path === 'src/gamma.ts'));
    expect(gammaGroups.length).toBeGreaterThan(0);
    const partners = gammaGroups.flatMap((c) => c.locs.map((loc) => loc.path));
    expect(partners.some((p) => p === 'src/alpha.ts' || p === 'secret/hidden.ts')).toBe(true);
  });

  it('emits only multi-location candidates, ranked by non-increasing score', () => {
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.locs.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 1; i < candidates.length; i++) {
      const previous = candidates[i - 1];
      const current = candidates[i];
      if (previous === undefined || current === undefined) {
        throw new Error('candidate list mutated during iteration');
      }
      expect(current.score).toBeLessThanOrEqual(previous.score);
    }
  });

  it('never emits paths under an excluded prefix', () => {
    const excluded = discover(root, resolveConfig({ minScore: 0.3, exclude: ['secret'] })).candidates;
    for (const candidate of excluded) {
      for (const loc of candidate.locs) {
        expect(loc.path.startsWith('secret/')).toBe(false);
      }
    }
    const literalPair = withPaths(excluded, ['src/alpha.ts', 'src/gamma.ts']);
    expect(literalPair.length).toBeGreaterThan(0);
  });
});
