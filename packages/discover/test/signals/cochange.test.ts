/**
 * Tests for the co-change signal: significance ranking, the group-size
 * cutoff, version-in-unison exclusions, the applies() gate, and the
 * emitted-candidate cap — all exercised against in-memory RepoHistory/
 * RepoScan fixtures (no git involved).
 *
 * @summary Verifies cochangeSignal against synthetic RepoHistory fixtures.
 */

import { describe, expect, it } from 'vitest';
import { cochangeSignal } from '../../src/signals/cochange.js';
import type { ChangeGroup, DiscoverConfig, RepoHistory, RepoScan } from '../../src/types.js';

/**
 * Build a ChangeGroup fixture.
 *
 * @param files - Member files (deduplicated, sorted).
 * @param timestamp - Newest-member timestamp, unix seconds.
 * @param commitCount - Number of commits merged into the group.
 * @returns A ChangeGroup.
 */
function group(files: readonly string[], timestamp: number, commitCount = 1): ChangeGroup {
  return { files: [...new Set(files)].sort(), timestamp, commitCount };
}

/**
 * Wrap change groups in a minimal RepoHistory fixture.
 *
 * @param changeGroups - The change groups under test.
 * @returns A RepoHistory with empty commits/messages.
 */
function makeHistory(changeGroups: readonly ChangeGroup[]): RepoHistory {
  return { commits: [], messages: new Map(), changeGroups, messageQuality: 0 };
}

const scan: RepoScan = {
  root: '/repo',
  files: [],
  text: new Map(),
  lines: new Map(),
  topLevelDirs: new Set(),
  docsDirs: []
};

const config: DiscoverConfig = {
  exclude: [],
  maxCandidates: 300,
  minScore: 0.5,
  useCommitMessages: true,
  maxFileBytes: 524288
};

describe('cochangeSignal', () => {
  it('applies only once there are at least 30 change groups', () => {
    const below = makeHistory(Array.from({ length: 29 }, (_, i) => group([`x${i}.ts`, `y${i}.ts`], i)));
    const atThreshold = makeHistory(Array.from({ length: 30 }, (_, i) => group([`x${i}.ts`, `y${i}.ts`], i)));

    expect(cochangeSignal.applies(scan, below, config)).toBe(false);
    expect(cochangeSignal.applies(scan, atThreshold, config)).toBe(true);
  });

  it('scores a tightly co-occurring pair above one diluted by many solo appearances', () => {
    const groups: ChangeGroup[] = [];
    let ts = 1;
    for (let i = 0; i < 486; i += 1) {
      groups.push(group([`filler${i}a.ts`, `filler${i}b.ts`], ts));
      ts += 1;
    }
    // pair B: 3 shared occurrences diluted among 3 solo appearances each side
    for (let i = 0; i < 3; i += 1) groups.push(group(['b1.ts', `bsolo${i}.ts`], ts++));
    for (let i = 0; i < 3; i += 1) groups.push(group(['b2.ts', `bsolo${i + 3}.ts`], ts++));
    for (let i = 0; i < 3; i += 1) groups.push(group(['b1.ts', 'b2.ts'], ts++));
    // pair A: 5 tight co-occurrences, never appearing solo
    for (let i = 0; i < 5; i += 1) groups.push(group(['a1.ts', 'a2.ts'], ts++));

    const history = makeHistory(groups);
    const candidates = cochangeSignal.run(scan, history, config);

    const a = candidates.find((c) => c.locs.some((l) => l.path === 'a1.ts'));
    const b = candidates.find((c) => c.locs.some((l) => l.path === 'b1.ts'));

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a?.score ?? 0).toBeGreaterThan(0.75);
    expect(b?.score ?? 0).toBeLessThan(0.65);
    expect(a?.score ?? 0).toBeGreaterThan(b?.score ?? 0);
  });

  it('does not emit a pair that only co-occurs inside mega-groups larger than the cutoff', () => {
    const groups: ChangeGroup[] = [];
    let ts = 1;
    for (let i = 0; i < 30; i += 1) {
      groups.push(group([`filler${i}a.ts`, `filler${i}b.ts`], ts++));
    }
    const megaExtrasA = Array.from({ length: 98 }, (_, i) => `mega1_extra${i}.ts`);
    const megaExtrasB = Array.from({ length: 98 }, (_, i) => `mega2_extra${i}.ts`);
    groups.push(group(['mega1.ts', 'mega2.ts', ...megaExtrasA], ts++));
    groups.push(group(['mega1.ts', 'mega2.ts', ...megaExtrasB], ts++));

    const history = makeHistory(groups);
    const candidates = cochangeSignal.run(scan, history, config);

    expect(candidates.some((c) => c.locs.some((l) => l.path === 'mega1.ts' || l.path === 'mega2.ts'))).toBe(false);
  });

  it('gives a perfectly-correlated pair across 40 groups a very low p-value and a high score', () => {
    const groups: ChangeGroup[] = [];
    let ts = 1;
    for (let i = 0; i < 25; i += 1) {
      groups.push(group([`filler${i}a.ts`, `filler${i}b.ts`], ts++));
    }
    for (let i = 0; i < 15; i += 1) {
      groups.push(group(['x.ts', 'y.ts'], ts++));
    }

    const history = makeHistory(groups);
    const candidates = cochangeSignal.run(scan, history, config);
    const xy = candidates.find((c) => c.locs.some((l) => l.path === 'x.ts'));

    expect(xy).toBeDefined();
    expect(xy?.evidence[0]).toBe('cochange:15/15,15');
    expect(xy?.score ?? 0).toBeGreaterThan(0.75);
  });

  it('excludes a package.json <-> CHANGELOG.md pair even when it co-occurs significantly', () => {
    const groups: ChangeGroup[] = [];
    let ts = 1;
    for (let i = 0; i < 40; i += 1) {
      groups.push(group(['package.json', 'CHANGELOG.md'], ts++));
    }
    for (let i = 0; i < 40; i += 1) {
      groups.push(group([`vfiller${i}a.ts`, `vfiller${i}b.ts`], ts++));
    }

    const history = makeHistory(groups);
    const candidates = cochangeSignal.run(scan, history, config);

    expect(candidates.some((c) => c.locs.some((l) => l.path === 'package.json'))).toBe(false);
  });

  it('caps emitted candidates at 180 even when more pairs are significant', () => {
    const clique = Array.from({ length: 25 }, (_, i) => `clique${i}.ts`);
    const groups: ChangeGroup[] = [];
    let ts = 1;
    for (let i = 0; i < 20; i += 1) {
      groups.push(group(clique, ts++));
    }
    for (let i = 0; i < 40; i += 1) {
      groups.push(group([`capfiller${i}a.ts`, `capfiller${i}b.ts`], ts++));
    }

    const history = makeHistory(groups);
    const candidates = cochangeSignal.run(scan, history, config);

    expect(candidates).toHaveLength(180);
  });
});
