/**
 * Tests for the doc-to-code reference signal: anchored links score higher in
 * a docs directory than elsewhere, plain (unanchored) links form their own
 * lower-scored group once there are at least two, URLs and bare fragment
 * links resolve to nothing, and an out-of-range anchor degrades to an
 * unanchored (plain) reference rather than being dropped.
 *
 * @summary Verifies docReferencesSignal against synthetic scan fixtures.
 */

import { describe, expect, it } from 'vitest';
import { docReferencesSignal } from '../../src/signals/docReferences.js';
import type { DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

/**
 * Build a minimal RepoScan for a fixed set of files, with scannable text
 * content for every file that participates in a test.
 *
 * @param files - Every tracked file path the fixture scan should list.
 * @param textFiles - Content for the subset of `files` that should be scannable.
 * @param docsDirs - Directory prefixes (with trailing `/`) classified as documentation.
 * @returns A minimal RepoScan built from the given files and content.
 */
function makeScan(
  files: readonly string[],
  textFiles: Readonly<Record<string, string>> = {},
  docsDirs: readonly string[] = []
): RepoScan {
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
  return { root: '/repo', files: [...files].sort(), text, lines, topLevelDirs, docsDirs };
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

describe('docReferencesSignal', () => {
  describe('applies', () => {
    it('is false when no scannable markdown page exists', () => {
      const scan = makeScan(['packages/a/one.ts'], { 'packages/a/one.ts': 'export const one = 1;' });
      expect(docReferencesSignal.applies(scan, history, config)).toBe(false);
    });

    it('is true once at least one markdown page has scannable text', () => {
      const scan = makeScan(['documentation/guide.md'], { 'documentation/guide.md': '# Guide' });
      expect(docReferencesSignal.applies(scan, history, config)).toBe(true);
    });
  });

  describe('run', () => {
    it('scores an anchored reference higher when the page lives in a docs directory', () => {
      const files = ['documentation/guide.md', 'other/notes.md', 'packages/a/one.ts'];
      const textFiles = {
        'documentation/guide.md': 'See [one](packages/a/one.ts#L1-L3) for the implementation.',
        'other/notes.md': 'See [one](packages/a/one.ts#L1-L3) for the implementation.',
        'packages/a/one.ts': Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join('\n')
      };
      const docsScan = makeScan(files, textFiles, ['documentation/']);
      const elseScan = makeScan(files, textFiles, []);

      const docsCandidates = docReferencesSignal.run(docsScan, history, config);
      const elseCandidates = docReferencesSignal.run(elseScan, history, config);

      const docsGroup = docsCandidates.find((c) => c.locs[0]?.path === 'documentation/guide.md');
      const elseGroup = elseCandidates.find((c) => c.locs[0]?.path === 'other/notes.md');

      expect(docsGroup?.score).toBe(0.68);
      expect(elseGroup?.score).toBe(0.62);
      expect(docsGroup?.locs).toEqual([
        { path: 'documentation/guide.md' },
        { path: 'packages/a/one.ts', start: 1, end: 3 }
      ]);
    });

    it('groups two or more plain (unanchored) references at a lower score than anchored ones', () => {
      const scan = makeScan(
        ['documentation/guide.md', 'packages/a/one.ts', 'packages/a/two.ts'],
        {
          'documentation/guide.md': 'See packages/a/one.ts and packages/a/two.ts for details.',
          'packages/a/one.ts': 'export const one = 1;',
          'packages/a/two.ts': 'export const two = 1;'
        },
        ['documentation/']
      );

      const candidates = docReferencesSignal.run(scan, history, config);
      const group = candidates.find((c) => c.score === 0.52 && c.locs.some((l) => l.path === 'packages/a/one.ts'));

      expect(group).toBeDefined();
      expect(group?.locs.map((l) => l.path).sort()).toEqual(
        ['documentation/guide.md', 'packages/a/one.ts', 'packages/a/two.ts'].sort()
      );
    });

    it('does not resolve a plain URL or a bare fragment link to any target', () => {
      const scan = makeScan(
        ['documentation/guide.md'],
        {
          'documentation/guide.md': 'See https://example.com/path/to/thing and [section](#overview) for context.'
        },
        ['documentation/']
      );

      const candidates = docReferencesSignal.run(scan, history, config);

      expect(candidates).toEqual([]);
    });

    it('degrades an out-of-range anchor to an unanchored reference instead of dropping it', () => {
      const scan = makeScan(
        ['documentation/guide.md', 'packages/a/one.ts', 'packages/a/two.ts'],
        {
          'documentation/guide.md': 'See [one](packages/a/one.ts#L50) and packages/a/two.ts for details.',
          'packages/a/one.ts': ['line 1', 'line 2', 'line 3'].join('\n'),
          'packages/a/two.ts': 'export const two = 1;'
        },
        ['documentation/']
      );

      const candidates = docReferencesSignal.run(scan, history, config);
      const anchoredGroup = candidates.find((c) => c.score === 0.68);
      const plainGroup = candidates.find((c) => c.score === 0.52);

      expect(anchoredGroup).toBeUndefined();
      expect(plainGroup?.locs.map((l) => l.path).sort()).toEqual(
        ['documentation/guide.md', 'packages/a/one.ts', 'packages/a/two.ts'].sort()
      );
    });
  });
});
