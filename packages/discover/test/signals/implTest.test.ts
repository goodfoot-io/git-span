/**
 * Tests for the impl<->test naming coupling signal.
 *
 * @summary Verifies stem resolution, directory-prefix disambiguation, and corroboration scoring.
 */

import { describe, expect, it } from 'vitest';
import { implTestSignal } from '../../src/signals/implTest.js';
import type { ChangeGroup, DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

function makeScan(files: Record<string, string>): RepoScan {
  const paths = Object.keys(files).sort();
  const text = new Map<string, string>();
  const lines = new Map<string, readonly string[]>();
  for (const path of paths) {
    const content = files[path] ?? '';
    text.set(path, content);
    lines.set(path, content.split('\n'));
  }
  return {
    root: '/repo',
    files: paths,
    text,
    lines,
    topLevelDirs: new Set(),
    docsDirs: []
  };
}

function makeHistory(changeGroups: readonly ChangeGroup[] = []): RepoHistory {
  return { commits: [], messages: new Map(), changeGroups, messageQuality: 0 };
}

function makeConfig(): DiscoverConfig {
  return { exclude: [], maxCandidates: 300, minScore: 0.5, useCommitMessages: true, maxFileBytes: 1_200_000 };
}

function changeGroup(files: readonly string[]): ChangeGroup {
  return { files, timestamp: 1_700_000_000, commitCount: 1 };
}

describe('implTestSignal', () => {
  it('applies when there is history or scannable text, not when both are empty', () => {
    const emptyScan = makeScan({});
    expect(implTestSignal.applies(emptyScan, makeHistory(), makeConfig())).toBe(false);
    expect(implTestSignal.applies(emptyScan, makeHistory([changeGroup(['a', 'b'])]), makeConfig())).toBe(true);
    const nonEmptyScan = makeScan({ 'src/foo.ts': 'export const foo = 1;\n' });
    expect(implTestSignal.applies(nonEmptyScan, makeHistory(), makeConfig())).toBe(true);
  });

  it('emits an impl<->test pair corroborated by two co-change groups', () => {
    const scan = makeScan({
      'src/foo.ts': 'export function foo() { return 1; }\n',
      'test/foo.test.ts': 'import { foo } from "../src/foo.js";\ntest("foo", () => { foo(); });\n'
    });
    const history = makeHistory([
      changeGroup(['src/foo.ts', 'test/foo.test.ts']),
      changeGroup(['src/foo.ts', 'test/foo.test.ts', 'README.md'])
    ]);

    const [candidate] = implTestSignal.run(scan, history, makeConfig());

    expect(candidate).toBeDefined();
    expect(candidate?.signal).toBe('impl-test');
    expect(candidate?.score).toBeCloseTo(0.6);
    expect(candidate?.evidence).toContain('impltest:2');
    expect(candidate?.locs.map((loc) => loc.path).sort()).toEqual(['src/foo.ts', 'test/foo.test.ts']);
  });

  it('does not emit when there is neither co-change corroboration nor a shared literal', () => {
    const scan = makeScan({
      'src/foo.ts': 'export function foo() { return 1; }\n',
      'test/foo.test.ts': 'import { foo } from "../src/foo.js";\ntest("foo", () => { foo(); });\n'
    });
    const candidates = implTestSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('emits at 0.60 when corroborated only by a shared distinctive literal', () => {
    const scan = makeScan({
      'src/foo.ts': 'export const marker = "totallyUniqueMarkerValue";\n',
      'test/foo.test.ts':
        'import { marker } from "../src/foo.js";\ntest("marker", () => { expect(marker).toBe("totallyUniqueMarkerValue"); });\n'
    });
    const [candidate] = implTestSignal.run(scan, makeHistory(), makeConfig());
    expect(candidate).toBeDefined();
    expect(candidate?.score).toBeCloseTo(0.6);
  });

  it('emits at 0.66 when corroborated by both co-change groups and a shared literal', () => {
    const scan = makeScan({
      'src/foo.ts': 'export const marker = "totallyUniqueMarkerValue";\n',
      'test/foo.test.ts':
        'import { marker } from "../src/foo.js";\ntest("marker", () => { expect(marker).toBe("totallyUniqueMarkerValue"); });\n'
    });
    const history = makeHistory([
      changeGroup(['src/foo.ts', 'test/foo.test.ts']),
      changeGroup(['src/foo.ts', 'test/foo.test.ts'])
    ]);

    const [candidate] = implTestSignal.run(scan, history, makeConfig());

    expect(candidate).toBeDefined();
    expect(candidate?.score).toBeCloseTo(0.66);
    expect(candidate?.evidence).toContain('impltest:2');
  });

  it('resolves an ambiguous stem via the longest shared directory prefix', () => {
    const scan = makeScan({
      'packages/widgets/src/render.ts': 'export function render() { return 1; }\n',
      'packages/other/src/render.ts': 'export function render() { return 2; }\n',
      'packages/widgets/test/render.test.ts':
        'import { render } from "../src/render.js";\ntest("render", () => { render(); });\n'
    });
    const history = makeHistory([
      changeGroup(['packages/widgets/src/render.ts', 'packages/widgets/test/render.test.ts']),
      changeGroup(['packages/widgets/src/render.ts', 'packages/widgets/test/render.test.ts'])
    ]);

    const candidates = implTestSignal.run(scan, history, makeConfig());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.locs.map((loc) => loc.path).sort()).toEqual([
      'packages/widgets/src/render.ts',
      'packages/widgets/test/render.test.ts'
    ]);
  });
});
