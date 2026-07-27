/**
 * Behavioral tests for {@link pathLiteralsSignal}: path literals embedded in
 * glue scripts couple at a higher score than in ordinary code, targets named
 * only on import/require lines are ignored, package.json and markdown files
 * are never scanned as referencing files, self-references are dropped, and a
 * glue file naming several targets close together earns a bonus grouped
 * candidate.
 *
 * @summary Tests for the path-literals coupling signal.
 */

import { describe, expect, it } from 'vitest';
import { pathLiteralsSignal } from '../../src/signals/pathLiterals.js';
import type { DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

/**
 * Splits fixture content into the line array a real scan would store.
 *
 * @param text - Fixture file content to split.
 * @returns The content split on `\n`, one entry per line.
 */
function linesOf(text: string): string[] {
  return text.split('\n');
}

/**
 * Builds a minimal {@link RepoScan} for a fixed set of files.
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
    lines.set(path, linesOf(content));
  }
  const topLevelDirs = new Set<string>();
  for (const file of files) {
    const slash = file.indexOf('/');
    if (slash > 0) {
      topLevelDirs.add(file.slice(0, slash));
    }
  }
  return {
    root: '/repo',
    files: [...files].sort(),
    text,
    lines,
    topLevelDirs,
    docsDirs: []
  };
}

/**
 * Builds an empty {@link RepoHistory} fixture; the signal under test ignores
 * history entirely, but the pipeline contract requires a value.
 *
 * @returns A minimal, empty RepoHistory.
 */
function makeHistory(): RepoHistory {
  return { commits: [], messages: new Map(), changeGroups: [], messageQuality: 0 };
}

/**
 * Builds a default {@link DiscoverConfig} fixture; the signal under test
 * ignores config entirely, but the pipeline contract requires a value.
 *
 * @returns A minimal DiscoverConfig with permissive defaults.
 */
function makeConfig(): DiscoverConfig {
  return { exclude: [], maxCandidates: 100, minScore: 0, useCommitMessages: true, maxFileBytes: 1_000_000 };
}

const history = makeHistory();
const config = makeConfig();

describe('pathLiteralsSignal', () => {
  it('couples a glue script with a path it embeds as a literal', () => {
    const scan = makeScan(['scripts/deploy.sh', 'packages/foo/bar.ts', 'packages/foo/baz.ts'], {
      'scripts/deploy.sh': ['#!/bin/bash', 'cp packages/foo/bar.ts dist/bar.ts'].join('\n')
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates).toContainEqual({
      locs: [{ path: 'scripts/deploy.sh', start: 2, end: 2 }, { path: 'packages/foo/bar.ts' }],
      score: 0.58,
      signal: 'path-literals',
      evidence: ['pathlit:scripts/deploy.sh#L2']
    });
  });

  it('does not couple a path named only on an import line', () => {
    const scan = makeScan(['packages/foo/importer.ts', 'packages/foo/bar.ts'], {
      'packages/foo/importer.ts': "import { bar } from './bar.ts';",
      'packages/foo/bar.ts': 'export const bar = 1;'
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates.filter((c) => c.locs[0]?.path === 'packages/foo/importer.ts')).toEqual([]);
  });

  it('does not scan package.json for path literals', () => {
    const scan = makeScan(['package.json', 'packages/foo/bar.ts'], {
      'package.json': '{\n  "main": "packages/foo/bar.ts"\n}',
      'packages/foo/bar.ts': 'export const bar = 1;'
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates).toEqual([]);
  });

  it('does not scan markdown files for path literals', () => {
    const scan = makeScan(['documentation/guide.md', 'packages/foo/bar.ts'], {
      'documentation/guide.md': 'See packages/foo/bar.ts for details.',
      'packages/foo/bar.ts': 'export const bar = 1;'
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates).toEqual([]);
  });

  it('does not couple a file to itself', () => {
    const scan = makeScan(['packages/foo/bar.ts'], {
      'packages/foo/bar.ts': '// packages/foo/bar.ts implements this'
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates).toEqual([]);
  });

  it('scores a non-glue file lower than a glue file for the same kind of reference', () => {
    const scan = makeScan(['packages/foo/loader.ts', 'packages/foo/bar.ts'], {
      'packages/foo/loader.ts': '// see packages/foo/bar.ts for the reference implementation',
      'packages/foo/bar.ts': 'export const bar = 1;'
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates).toContainEqual({
      locs: [{ path: 'packages/foo/loader.ts', start: 1, end: 1 }, { path: 'packages/foo/bar.ts' }],
      score: 0.48,
      signal: 'path-literals',
      evidence: ['pathlit:packages/foo/loader.ts#L1']
    });
  });

  it('adds a bonus grouped candidate when a glue file names 2-4 targets within a 10-line window', () => {
    const scan = makeScan(['scripts/multi.sh', 'packages/foo/bar.ts', 'packages/foo/baz.ts', 'packages/foo/qux.ts'], {
      'scripts/multi.sh': [
        '#!/bin/bash',
        'echo start',
        'cp packages/foo/bar.ts dist/',
        'cp packages/foo/baz.ts dist/',
        'cp packages/foo/qux.ts dist/',
        'echo done'
      ].join('\n')
    });

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates).toContainEqual({
      locs: [
        { path: 'scripts/multi.sh' },
        { path: 'packages/foo/bar.ts' },
        { path: 'packages/foo/baz.ts' },
        { path: 'packages/foo/qux.ts' }
      ],
      score: 0.63,
      signal: 'path-literals',
      evidence: ['pathlit:scripts/multi.sh#L3']
    });
  });

  it('orders candidates by descending score, then ascending referencing path', () => {
    const scan = makeScan(
      ['scripts/deploy.sh', 'packages/foo/loader.ts', 'packages/foo/bar.ts', 'packages/foo/baz.ts'],
      {
        'scripts/deploy.sh': 'cp packages/foo/bar.ts dist/',
        'packages/foo/loader.ts': '// see packages/foo/baz.ts for details',
        'packages/foo/bar.ts': 'export const bar = 1;',
        'packages/foo/baz.ts': 'export const baz = 1;'
      }
    );

    const candidates = pathLiteralsSignal.run(scan, history, config);

    expect(candidates.map((c) => [c.locs[0]?.path, c.score])).toEqual([
      ['scripts/deploy.sh', 0.58],
      ['packages/foo/loader.ts', 0.48]
    ]);
  });
});
