/**
 * Tests for the near-duplicate ("clones") coupling signal.
 *
 * @summary Verifies winnowed fingerprint matching, boilerplate dropping, and loc ranges.
 */

import { describe, expect, it } from 'vitest';
import { clonesSignal } from '../../src/signals/clones.js';
import type { DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

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

function makeHistory(): RepoHistory {
  return { commits: [], messages: new Map(), changeGroups: [], messageQuality: 0 };
}

function makeConfig(): DiscoverConfig {
  return { exclude: [], maxCandidates: 300, minScore: 0.5, useCommitMessages: true, maxFileBytes: 1_200_000 };
}

/**
 * Lines that are mutually distinct (across tags/offsets) so shingle hashes don't collide by accident.
 *
 * @param tag - Identifier mixed into each line so different calls never overlap in content.
 * @param count - Number of lines to generate.
 * @returns The generated lines.
 */
function uniqueLines(tag: string, count: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`const ${tag}Value${i} = computeSomething(${tag}, ${i}, "${tag}-${i}-marker");`);
  }
  return lines;
}

/**
 * A block of lines meant to be duplicated verbatim across files under test.
 *
 * @param count - Number of lines in the block.
 * @returns The generated lines.
 */
function sharedBlock(count: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`function handleCase${i}(payload) { return normalize(payload, ${i}, "case-${i}-token"); }`);
  }
  return lines;
}

describe('clonesSignal', () => {
  it('always applies', () => {
    expect(clonesSignal.applies(makeScan({}), makeHistory(), makeConfig())).toBe(true);
  });

  it('finds a pair sharing a near-duplicate 20-line block', () => {
    const block = sharedBlock(20);
    const fileA = [...uniqueLines('a', 15), ...block, ...uniqueLines('a2', 15)].join('\n');
    const fileB = [...uniqueLines('b', 10), ...block, ...uniqueLines('b2', 15)].join('\n');
    const scan = makeScan({ 'src/a.ts': fileA, 'src/b.ts': fileB });

    const [candidate] = clonesSignal.run(scan, makeHistory(), makeConfig());

    expect(candidate).toBeDefined();
    expect(candidate?.signal).toBe('clones');
    const locsA = candidate?.locs.filter((loc) => loc.path === 'src/a.ts') ?? [];
    const locsB = candidate?.locs.filter((loc) => loc.path === 'src/b.ts') ?? [];
    expect(locsA.length).toBeGreaterThan(0);
    expect(locsB.length).toBeGreaterThan(0);
    // the shared block occupies lines 16-35 of file A (after 15 unique lines)
    const overlapsBlockA = locsA.some((loc) => (loc.start ?? 0) <= 35 && (loc.end ?? 0) >= 16);
    expect(overlapsBlockA).toBe(true);
    // the shared block occupies lines 11-30 of file B (after 10 unique lines)
    const overlapsBlockB = locsB.some((loc) => (loc.start ?? 0) <= 30 && (loc.end ?? 0) >= 11);
    expect(overlapsBlockB).toBe(true);
  });

  it('finds nothing for two unrelated files', () => {
    const scan = makeScan({
      'src/a.ts': uniqueLines('x', 35).join('\n'),
      'src/b.ts': uniqueLines('y', 35).join('\n')
    });
    const candidates = clonesSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('drops a boilerplate block shared by six or more files', () => {
    const boilerplate = sharedBlock(12);
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      files[`src/f${i}.ts`] = [...uniqueLines(`f${i}`, 20), ...boilerplate].join('\n');
    }
    const candidates = clonesSignal.run(makeScan(files), makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });

  it('ignores files with fewer than 30 raw lines even if content is identical', () => {
    const block = sharedBlock(20);
    const scan = makeScan({ 'src/a.ts': block.join('\n'), 'src/b.ts': block.join('\n') });
    const candidates = clonesSignal.run(scan, makeHistory(), makeConfig());
    expect(candidates).toHaveLength(0);
  });
});
