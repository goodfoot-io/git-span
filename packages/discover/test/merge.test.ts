/**
 * Tests for the merge layer: noisy-or combination, doc-only damping,
 * subset/superset dedup, ranking, filtering, and the fail-closed exclude
 * assertion.
 *
 * @summary Verifies candidate merging, damping, dedup, and ranking.
 */

import { describe, expect, it } from 'vitest';
import { mergeCandidates } from '../src/merge.js';
import type { Candidate, DiscoverConfig } from '../src/types.js';

/**
 * Build a DiscoverConfig with sensible test defaults.
 *
 * @param over - Field overrides.
 * @returns A complete config object.
 */
function cfg(over: Partial<DiscoverConfig> = {}): DiscoverConfig {
  return {
    exclude: [],
    maxCandidates: 300,
    minScore: 0.1,
    useCommitMessages: true,
    maxFileBytes: 524288,
    ...over
  };
}

/**
 * Build a whole-file candidate over the given paths.
 *
 * @param paths - Coupled file paths.
 * @param score - Signal confidence.
 * @param signal - Producing signal name.
 * @param evidence - Evidence tags.
 * @returns A Candidate.
 */
function cand(paths: string[], score: number, signal: string, evidence: string[] = []): Candidate {
  return { locs: paths.map((p) => ({ path: p })), score, signal, evidence };
}

describe('mergeCandidates', () => {
  it('combines same-set candidates with attenuated noisy-or', () => {
    const merged = mergeCandidates(
      [cand(['a.ts', 'b.ts'], 0.8, 'sig1', ['e1']), cand(['b.ts', 'a.ts'], 0.6, 'sig2', ['e2'])],
      cfg()
    );
    expect(merged).toHaveLength(1);
    // 1 - (1 - 0.8) * (1 - 0.6 * 0.55) = 0.866
    expect(merged[0]!.score).toBeCloseTo(0.866, 3);
    expect(merged[0]!.evidence).toEqual(['e1', 'e2']);
  });

  it('keeps the locs of the highest-scoring member', () => {
    const ranged: Candidate = {
      locs: [{ path: 'a.ts', start: 3, end: 9 }, { path: 'b.ts' }],
      score: 0.8,
      signal: 'sig1',
      evidence: []
    };
    const merged = mergeCandidates([cand(['a.ts', 'b.ts'], 0.5, 'sig2'), ranged], cfg());
    expect(merged).toHaveLength(1);
    expect(merged[0]!.locs).toEqual([{ path: 'a.ts', start: 3, end: 9 }, { path: 'b.ts' }]);
  });

  it('caps merged evidence at five entries without duplicates', () => {
    const merged = mergeCandidates(
      [
        cand(['a.ts', 'b.ts'], 0.7, 'sig1', ['e1', 'e2', 'e3']),
        cand(['a.ts', 'b.ts'], 0.6, 'sig2', ['e2', 'e4', 'e5', 'e6', 'e7'])
      ],
      cfg()
    );
    expect(merged[0]!.evidence).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('records the distinct contributing signals on the merged candidate', () => {
    const merged = mergeCandidates([cand(['a.ts', 'b.ts'], 0.7, 'sig-b'), cand(['a.ts', 'b.ts'], 0.6, 'sig-a')], cfg());
    expect(merged[0]!.signal).toBe('sig-a+sig-b');
  });

  it('damps doc-only groups lacking commit-message or sync-comment backing', () => {
    const dampened = mergeCandidates([cand(['docs/a.md', 'docs/b.md'], 0.6, 'doc-references')], cfg());
    expect(dampened[0]!.score).toBeCloseTo(0.6 * 0.78, 5);
    const backed = mergeCandidates(
      [cand(['docs/a.md', 'docs/b.md'], 0.6, 'doc-references'), cand(['docs/a.md', 'docs/b.md'], 0.5, 'sync-comments')],
      cfg()
    );
    // noisy-or of 0.6 and 0.5 * 0.55, undamped
    expect(backed[0]!.score).toBeCloseTo(1 - 0.4 * (1 - 0.275), 5);
  });

  it('does not damp mixed doc/code groups', () => {
    const merged = mergeCandidates([cand(['docs/a.md', 'src/b.ts'], 0.6, 'doc-references')], cfg());
    expect(merged[0]!.score).toBeCloseTo(0.6, 5);
  });

  it('drops weak strict subsets and supersets of stronger groups', () => {
    const merged = mergeCandidates(
      [
        cand(['a.ts', 'b.ts'], 0.9, 'sig1'),
        cand(['a.ts', 'b.ts', 'c.ts'], 0.5, 'sig1'),
        cand(['a.ts', 'b.ts', 'd.ts'], 0.8, 'sig1')
      ],
      cfg()
    );
    const sets = merged.map((m) => m.locs.map((l) => l.path).join(','));
    expect(sets).toContain('a.ts,b.ts');
    expect(sets).toContain('a.ts,b.ts,d.ts');
    expect(sets).not.toContain('a.ts,b.ts,c.ts');
  });

  it('keeps unrelated groups intact and ranks by score', () => {
    const merged = mergeCandidates([cand(['a.ts', 'b.ts'], 0.6, 'sig1'), cand(['c.ts', 'd.ts'], 0.9, 'sig1')], cfg());
    expect(merged.map((m) => m.score)).toEqual([0.9, 0.6]);
  });

  it('discards single-path candidates', () => {
    const merged = mergeCandidates(
      [
        {
          locs: [
            { path: 'a.ts', start: 1, end: 5 },
            { path: 'a.ts', start: 10, end: 12 }
          ],
          score: 0.9,
          signal: 'sig1',
          evidence: []
        }
      ],
      cfg()
    );
    expect(merged).toHaveLength(0);
  });

  it('applies minScore and maxCandidates', () => {
    const merged = mergeCandidates(
      [cand(['a.ts', 'b.ts'], 0.9, 'sig1'), cand(['c.ts', 'd.ts'], 0.7, 'sig1'), cand(['e.ts', 'f.ts'], 0.3, 'sig1')],
      cfg({ minScore: 0.5, maxCandidates: 1 })
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.score).toBeCloseTo(0.9, 5);
  });

  it('fails closed on a candidate naming an excluded path', () => {
    expect(() => mergeCandidates([cand(['private/a.ts', 'b.ts'], 0.9, 'sig1')], cfg({ exclude: ['private'] }))).toThrow(
      /excluded path/
    );
  });

  it('orders deterministically on score ties', () => {
    const merged = mergeCandidates([cand(['x.ts', 'y.ts'], 0.6, 'sig1'), cand(['a.ts', 'b.ts'], 0.6, 'sig1')], cfg());
    expect(merged.map((m) => m.locs[0]!.path)).toEqual(['a.ts', 'x.ts']);
  });
});
