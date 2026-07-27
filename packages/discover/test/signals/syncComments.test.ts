/**
 * Tests for the "keep in sync" comment signal: phrase detection, path-target
 * resolution at the higher score, the backticked-identifier fallback at the
 * lower score, and the too-common-identifier rejection (more than 3 matches).
 *
 * @summary Verifies syncCommentsSignal against synthetic scan fixtures.
 */

import { describe, expect, it } from 'vitest';
import { syncCommentsSignal } from '../../src/signals/syncComments.js';
import type { DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

/**
 * Build a minimal RepoScan for a fixed set of files, with scannable text
 * content for every file that participates in a test.
 *
 * @param files - Every tracked file path the fixture scan should list.
 * @param textFiles - Content for the subset of `files` that should be scannable.
 * @returns A minimal RepoScan built from the given files and content.
 */
function makeScan(files: readonly string[], textFiles: Readonly<Record<string, string>> = {}): RepoScan {
  const text = new Map<string, string>();
  const lines = new Map<string, readonly string[]>();
  for (const [path, content] of Object.entries(textFiles)) {
    text.set(path, content);
    lines.set(path, content.split('\n'));
  }
  const topLevelDirs = new Set<string>();
  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash > 0) topLevelDirs.add(file.slice(0, slash));
  }
  return { root: '/repo', files: [...files].sort(), text, lines, topLevelDirs, docsDirs: [] };
}

/**
 * Build an empty RepoHistory fixture; the signal under test ignores history
 * entirely, but the pipeline contract requires a value.
 *
 * @returns A minimal, empty RepoHistory.
 */
function makeHistory(): RepoHistory {
  return { commits: [], messages: new Map(), changeGroups: [], messageQuality: 0 };
}

/**
 * Build a DiscoverConfig with sensible test defaults.
 *
 * @returns A minimal DiscoverConfig.
 */
function makeConfig(): DiscoverConfig {
  return { exclude: [], maxCandidates: 300, minScore: 0.5, useCommitMessages: true, maxFileBytes: 524288 };
}

const history = makeHistory();
const config = makeConfig();

describe('syncCommentsSignal', () => {
  it('couples a sync comment with the path it explicitly names', () => {
    const scan = makeScan(['packages/a/one.ts', 'packages/a/two.ts'], {
      'packages/a/one.ts': ['// keep this in sync with packages/a/two.ts', 'export const one = 1;'].join('\n'),
      'packages/a/two.ts': 'export const two = 1;'
    });

    const candidates = syncCommentsSignal.run(scan, history, config);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.score).toBe(0.86);
    expect(candidates[0]?.signal).toBe('sync-comments');
    expect(candidates[0]?.evidence).toEqual(['sync:packages/a/one.ts#L1']);
    expect(candidates[0]?.locs.map((l) => l.path)).toEqual(['packages/a/one.ts', 'packages/a/two.ts']);
  });

  it('falls back to a backticked identifier when no path is named', () => {
    const scan = makeScan(['packages/a/one.ts', 'packages/a/two.ts'], {
      'packages/a/one.ts': ['// must match `computeChecksum` exactly', 'export const one = 1;'].join('\n'),
      'packages/a/two.ts': 'export function computeChecksum() { return 0; }'
    });

    const candidates = syncCommentsSignal.run(scan, history, config);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.score).toBe(0.6);
    expect(candidates[0]?.locs.map((l) => l.path)).toEqual(['packages/a/one.ts', 'packages/a/two.ts']);
  });

  it('skips an identifier that matches in more than 3 other files', () => {
    const scan = makeScan(
      ['packages/a/one.ts', 'packages/a/two.ts', 'packages/a/three.ts', 'packages/a/four.ts', 'packages/a/five.ts'],
      {
        'packages/a/one.ts': ['// must match `sharedHelper` exactly', 'export const one = 1;'].join('\n'),
        'packages/a/two.ts': 'export function sharedHelper() { return 1; }',
        'packages/a/three.ts': 'export function sharedHelper() { return 2; }',
        'packages/a/four.ts': 'export function sharedHelper() { return 3; }',
        'packages/a/five.ts': 'export function sharedHelper() { return 4; }'
      }
    );

    const candidates = syncCommentsSignal.run(scan, history, config);

    expect(candidates).toHaveLength(0);
  });

  it('does not flag a line that lacks a sync phrase', () => {
    const scan = makeScan(['packages/a/one.ts', 'packages/a/two.ts'], {
      'packages/a/one.ts': ['// see packages/a/two.ts for details', 'export const one = 1;'].join('\n'),
      'packages/a/two.ts': 'export const two = 1;'
    });

    const candidates = syncCommentsSignal.run(scan, history, config);

    expect(candidates).toHaveLength(0);
  });

  it('prefers a resolved path target over the identifier fallback on the same line', () => {
    const scan = makeScan(['packages/a/one.ts', 'packages/a/two.ts'], {
      'packages/a/one.ts': [
        '// keep in sync with packages/a/two.ts and its `computeChecksum` helper',
        'export const one = 1;'
      ].join('\n'),
      'packages/a/two.ts': 'export function computeChecksum() { return 0; }'
    });

    const candidates = syncCommentsSignal.run(scan, history, config);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.score).toBe(0.86);
  });
});
