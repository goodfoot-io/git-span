/**
 * Tests for src/grouping.ts — the anchor-overlap primitives retained after the
 * n-ary redesign deleted `mergeAnchorGroups`/`UnionFind`: `anchorsOverlap`,
 * `collapseAnchors`, and `anchorSetsFullyMatch` (kept, per the
 * Testable-Uncertainty-2 spike, as `cli.ts`'s 2-node secondary reportability
 * gate). Pure over anchors; no git needed.
 */

import { describe, expect, it } from 'vitest';
import { anchorSetsFullyMatch, anchorsOverlap, collapseAnchors } from '../src/grouping.js';
import type { Anchor } from '../src/types.js';

describe('anchorsOverlap', () => {
  it('is false across different paths', () => {
    expect(
      anchorsOverlap({ path: 'a.ts', startLine: 1, endLine: 10 }, { path: 'b.ts', startLine: 1, endLine: 10 })
    ).toBe(false);
  });

  it('treats a whole-file anchor as 100% overlap with any range on the same path (design decision 8)', () => {
    expect(anchorsOverlap({ path: 'a.ts' }, { path: 'a.ts', startLine: 40, endLine: 90 })).toBe(true);
    expect(anchorsOverlap({ path: 'a.ts', startLine: 40, endLine: 90 }, { path: 'a.ts' })).toBe(true);
  });

  it('merges ranges at or above 80% IoU and not below', () => {
    // 1-10 vs 1-10 → identical → IoU 1.
    expect(
      anchorsOverlap({ path: 'a.ts', startLine: 1, endLine: 10 }, { path: 'a.ts', startLine: 1, endLine: 10 })
    ).toBe(true);
    // 1-10 (10 lines) vs 1-100 → intersection 10 / union 100 = 0.1 → no merge.
    expect(
      anchorsOverlap({ path: 'a.ts', startLine: 1, endLine: 10 }, { path: 'a.ts', startLine: 1, endLine: 100 })
    ).toBe(false);
  });
});

describe('collapseAnchors', () => {
  it('drops a whole-file anchor superseded by a range anchor on the same path', () => {
    const collapsed = collapseAnchors([{ path: 'a.ts' }, { path: 'a.ts', startLine: 10, endLine: 20 }]);
    expect(collapsed).toEqual([{ path: 'a.ts', startLine: 10, endLine: 20 }]);
  });

  it('merges overlapping/touching ranges into their bounding range and keeps disjoint ranges separate', () => {
    const collapsed = collapseAnchors([
      { path: 'a.ts', startLine: 1, endLine: 10 },
      { path: 'a.ts', startLine: 8, endLine: 15 },
      { path: 'a.ts', startLine: 500, endLine: 510 }
    ]);
    expect(collapsed).toEqual([
      { path: 'a.ts', startLine: 1, endLine: 15 },
      { path: 'a.ts', startLine: 500, endLine: 510 }
    ]);
  });

  it('sorts anchors deterministically by path then range', () => {
    const collapsed = collapseAnchors([{ path: 'b.ts' }, { path: 'a.ts', startLine: 5, endLine: 6 }]);
    expect(collapsed).toEqual([{ path: 'a.ts', startLine: 5, endLine: 6 }, { path: 'b.ts' }]);
  });
});

describe('anchorSetsFullyMatch', () => {
  function pair(pathA: string, pathB: string): Anchor[] {
    return [{ path: pathA }, { path: pathB }];
  }

  it('matches two identical two-file pairings (the legitimate merge case)', () => {
    expect(anchorSetsFullyMatch(pair('a.ts', 'b.ts'), pair('a.ts', 'b.ts'))).toBe(true);
  });

  it('matches a whole-file pairing against the same pair anchored by ranges on both paths', () => {
    const whole = pair('a.ts', 'b.ts');
    const ranged: Anchor[] = [
      { path: 'a.ts', startLine: 10, endLine: 20 },
      { path: 'b.ts', startLine: 10, endLine: 20 }
    ];
    expect(anchorSetsFullyMatch(whole, ranged)).toBe(true);
  });

  it('does NOT match two pairs sharing only one hub anchor — the anti-chaining rule', () => {
    // {hub, a} vs {hub, b}: hub matches hub, but a has no counterpart in the
    // other and b has none here. This is exactly the hub-bridged pooling the
    // 2-node secondary gate must reject.
    expect(anchorSetsFullyMatch(pair('hub.ts', 'a.ts'), pair('hub.ts', 'b.ts'))).toBe(false);
  });

  it('does NOT match sets of different sizes', () => {
    expect(anchorSetsFullyMatch(pair('a.ts', 'b.ts'), [{ path: 'a.ts' }])).toBe(false);
  });

  it('does NOT match same-path ranges whose IoU falls below the threshold', () => {
    const first: Anchor[] = [{ path: 'a.ts', startLine: 1, endLine: 10 }, { path: 'b.ts' }];
    const second: Anchor[] = [{ path: 'a.ts', startLine: 500, endLine: 510 }, { path: 'b.ts' }];
    expect(anchorSetsFullyMatch(first, second)).toBe(false);
  });
});
