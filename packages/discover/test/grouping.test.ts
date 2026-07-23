/**
 * Tests for src/grouping.ts — union-find fuzzy merging of the flattened
 * signal output (design decision 8). Pure over AnchorGroup[]; no git needed.
 */

import { describe, expect, it } from 'vitest';
import { anchorsOverlap, mergeAnchorGroups } from '../src/grouping.js';
import type { AnchorGroup } from '../src/types.js';

function group(anchors: AnchorGroup['anchors'], evidence: AnchorGroup['evidence']): AnchorGroup {
  return { anchors, evidence, score: 0 };
}

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

describe('mergeAnchorGroups', () => {
  it('merges a whole-file anchor and a line-range anchor on the same path into one group', () => {
    // e.g. association-rules emits whole-file a.ts+b.ts; time-window emits a.ts#L10-L20 + b.ts#L10-L20.
    const wholeFile = group(
      [{ path: 'a.ts' }, { path: 'b.ts' }],
      [{ signal: 'association-rules', strength: 0.9, commits: ['c1'] }]
    );
    const ranged = group(
      [
        { path: 'a.ts', startLine: 10, endLine: 20 },
        { path: 'b.ts', startLine: 10, endLine: 20 }
      ],
      [{ signal: 'time-window-co-edit', strength: 0.8, commits: ['c2', 'c3'] }]
    );

    const merged = mergeAnchorGroups([wholeFile, ranged]);
    expect(merged).toHaveLength(1);

    // The whole-file anchor is superseded by the more specific range anchor.
    const anchors = merged[0].anchors;
    expect(anchors).toEqual([
      { path: 'a.ts', startLine: 10, endLine: 20 },
      { path: 'b.ts', startLine: 10, endLine: 20 }
    ]);
  });

  it('unions evidence on merge — the merged group carries both signals with their original refs', () => {
    const g1 = group(
      [{ path: 'a.ts', startLine: 5, endLine: 15 }],
      [{ signal: 'time-window-co-edit', strength: 0.7, commits: ['sha-A', 'sha-B'] }]
    );
    const g2 = group(
      [{ path: 'a.ts', startLine: 5, endLine: 15 }],
      [{ signal: 'release-tag-delta', strength: 0.6, tags: ['v1.0.0', 'v1.1.0'] }]
    );

    const merged = mergeAnchorGroups([g1, g2]);
    expect(merged).toHaveLength(1);

    const signalsSeen = merged[0].evidence.map((e) => e.signal).sort();
    expect(signalsSeen).toEqual(['release-tag-delta', 'time-window-co-edit']);

    const timeWindow = merged[0].evidence.find((e) => e.signal === 'time-window-co-edit');
    const releaseTag = merged[0].evidence.find((e) => e.signal === 'release-tag-delta');
    expect(timeWindow?.commits).toEqual(['sha-A', 'sha-B']);
    expect(releaseTag?.tags).toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('is order-independent — a shuffled input produces identical final groups', () => {
    const a = group([{ path: 'x.ts', startLine: 1, endLine: 10 }], [{ signal: 'time-window-co-edit', strength: 0.5 }]);
    const b = group([{ path: 'x.ts', startLine: 1, endLine: 10 }], [{ signal: 'association-rules', strength: 0.9 }]);
    const c = group([{ path: 'x.ts' }], [{ signal: 'lexical-similarity', strength: 0.4 }]);
    // Unrelated group on a different path — must stay its own component.
    const d = group([{ path: 'y.ts' }, { path: 'z.ts' }], [{ signal: 'shared-config-key', strength: 0.8 }]);

    const forward = mergeAnchorGroups([a, b, c, d]);
    const shuffled = mergeAnchorGroups([d, c, b, a]);
    const reversed = mergeAnchorGroups([c, a, d, b]);

    expect(forward).toEqual(shuffled);
    expect(forward).toEqual(reversed);

    // a, b, c all overlap on x.ts → one component; d is separate → 2 groups.
    expect(forward).toHaveLength(2);
    const xGroup = forward.find((g) => g.anchors.some((anchor) => anchor.path === 'x.ts'));
    expect(xGroup?.evidence.map((e) => e.signal).sort()).toEqual([
      'association-rules',
      'lexical-similarity',
      'time-window-co-edit'
    ]);
  });

  it('keeps non-overlapping groups separate', () => {
    const g1 = group([{ path: 'a.ts' }, { path: 'b.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const g2 = group([{ path: 'c.ts' }, { path: 'd.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    expect(mergeAnchorGroups([g1, g2])).toHaveLength(2);
  });

  it('collapses many groups sharing a whole-file anchor on one path into a single component', () => {
    // Exercises the path-bucketed union's whole-file fast path: a whole-file
    // anchor overlaps every anchor on its path, so a large fan-in on a hot path
    // (e.g. package.json touched by hundreds of release-tag pairs) must merge
    // into exactly one group — the scalable equivalent of the former O(groups²)
    // all-pairs scan.
    const groups: AnchorGroup[] = [];
    for (let i = 0; i < 500; i++) {
      groups.push(
        group(
          [{ path: 'package.json' }, { path: `other-${i}.ts`, startLine: 1, endLine: 5 }],
          [{ signal: 'release-tag-delta', strength: 0.6, tags: [`v${i}`] }]
        )
      );
    }
    const merged = mergeAnchorGroups(groups);
    // All 500 share package.json (whole-file) → one transitive component.
    expect(merged).toHaveLength(1);
    expect(merged[0].evidence).toHaveLength(500);
    expect(merged[0].anchors.some((anchor) => anchor.path === 'package.json')).toBe(true);
  });

  it('does not merge groups whose ranges on a shared path fall below the IoU threshold', () => {
    // Same path, but disjoint/low-overlap ranges and no whole-file anchor to
    // bridge them — the all-ranged branch must keep them as separate components.
    const g1 = group([{ path: 'a.ts', startLine: 1, endLine: 10 }], [{ signal: 'time-window-co-edit', strength: 0.5 }]);
    const g2 = group(
      [{ path: 'a.ts', startLine: 500, endLine: 510 }],
      [{ signal: 'time-window-co-edit', strength: 0.5 }]
    );
    expect(mergeAnchorGroups([g1, g2])).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(mergeAnchorGroups([])).toEqual([]);
  });
});
