/**
 * Unit tests for the shared anchor-tree renderer. Covers `collapseByPath`'s
 * first-occurrence rule in isolation, then `renderAnchorTree`'s tree
 * construction/rendering rules: directory collapsing, sibling expansion,
 * multi-range stacking and alignment, numeric range sorting, the
 * `range`/`whole-file`/`truncated` `RangeLabel` kinds, degenerate path
 * handling, the padding cap, and code-point-based column math.
 */

import { describe, expect, it } from 'vitest';
import { collapseByPath, type RangeEntry, renderAnchorTree, type TreeAnchor } from '../../src/common/anchor-tree.js';

/** A `range`-kind `RangeEntry` with an optional suffix, for terser test setup. */
function range(start: number, end: number, suffix = ''): RangeEntry {
  return { range: { kind: 'range', start, end }, suffix };
}

describe('collapseByPath', () => {
  it('collapses a later same-path row into the path’s first-occurrence position, not its own', () => {
    const rows = [
      { path: 'a.ts', range: { kind: 'range', start: 1, end: 5 } as const, suffix: '' },
      { path: 'b.ts', range: { kind: 'range', start: 1, end: 5 } as const, suffix: '' },
      { path: 'a.ts', range: { kind: 'range', start: 9, end: 12 } as const, suffix: '' }
    ];

    const result = collapseByPath(rows);

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('a.ts');
    expect(result[0].ranges).toHaveLength(2);
    expect(result[0].ranges[0].range).toEqual({ kind: 'range', start: 1, end: 5 });
    expect(result[0].ranges[1].range).toEqual({ kind: 'range', start: 9, end: 12 });
    expect(result[1].path).toBe('b.ts');
    expect(result[1].ranges).toHaveLength(1);
  });

  it('keeps a single-occurrence path as one entry with one range', () => {
    const result = collapseByPath([{ path: 'solo.ts', range: { kind: 'range', start: 1, end: 2 }, suffix: '' }]);
    expect(result).toEqual([{ path: 'solo.ts', ranges: [{ range: { kind: 'range', start: 1, end: 2 }, suffix: '' }] }]);
  });
});

describe('renderAnchorTree', () => {
  it('renders a single anchor as a one-line tree', () => {
    const anchors: TreeAnchor[] = [{ path: 'a.ts', ranges: [range(1, 5)] }];
    expect(renderAnchorTree(anchors)).toEqual(['└─ a.ts #L1-L5']);
  });

  it('collapses a single-child directory chain into one combined-name line', () => {
    const anchors: TreeAnchor[] = [{ path: 'public/claude/runtime/skills/card/SKILL.md', ranges: [range(1, 91)] }];

    expect(renderAnchorTree(anchors)).toEqual(['└─ public/claude/runtime/skills/card/', '   └─ SKILL.md #L1-L91']);
  });

  it('keeps a directory with 2+ children expanded from that level down', () => {
    const anchors: TreeAnchor[] = [
      { path: 'dir/a.ts', ranges: [range(1, 2)] },
      { path: 'dir/b.ts', ranges: [range(3, 4)] }
    ];

    expect(renderAnchorTree(anchors)).toEqual(['└─ dir/', '   ├─ a.ts #L1-L2', '   └─ b.ts #L3-L4']);
  });

  it('stacks multiple ranges on one path under a continuation bar instead of repeating the name', () => {
    const anchors = collapseByPath([
      { path: 'plan.md', range: { kind: 'range', start: 1, end: 67 }, suffix: '' },
      { path: 'planning.md', range: { kind: 'range', start: 1, end: 72 }, suffix: '' },
      { path: 'plan.md', range: { kind: 'range', start: 69, end: 100 }, suffix: '' }
    ]);

    expect(renderAnchorTree(anchors)).toEqual([
      '├─ plan.md     #L1-L67',
      '│              #L69-L100',
      '└─ planning.md #L1-L72'
    ]);
  });

  it('attaches a differing suffix to each stacked range on one path independently', () => {
    const anchors: TreeAnchor[] = [{ path: 'a.ts', ranges: [range(1, 5, ' — changed'), range(9, 12, '')] }];

    const lines = renderAnchorTree(anchors);
    // Sole sibling in its group — the branch was the last (only) one, so the
    // continuation prefix is blank space, not a '│' bar.
    expect(lines).toEqual(['└─ a.ts #L1-L5 — changed', '        #L9-L12']);
  });

  it('sorts stacked ranges numerically by start (then end), not by arrival or codepoint order', () => {
    // Arrival order is [100, 20]; codepoint order of "#L100" vs "#L20" would put
    // "#L100" first ('1' < '2'). Numeric order must put 20 before 100.
    const anchors = collapseByPath([
      { path: 'x.ts', range: { kind: 'range', start: 100, end: 110 }, suffix: '' },
      { path: 'x.ts', range: { kind: 'range', start: 20, end: 25 }, suffix: '' }
    ]);

    const lines = renderAnchorTree(anchors);
    expect(lines[0]).toContain('#L20-L25');
    expect(lines[1]).toContain('#L100-L110');
  });

  it('renders a truncated anchor with the exact defensive marker text', () => {
    const anchors: TreeAnchor[] = [{ path: 'y.ts', ranges: [{ range: { kind: 'truncated' }, suffix: '' }] }];
    expect(renderAnchorTree(anchors)).toEqual(['└─ y.ts (truncated in source — anchor incomplete)']);
  });

  it('never classifies a whole-file anchor as truncated: it renders as a plain path with zero marker', () => {
    const anchors: TreeAnchor[] = [{ path: 'z.ts', ranges: [{ range: { kind: 'whole-file' }, suffix: '' }] }];
    const lines = renderAnchorTree(anchors);
    expect(lines).toEqual(['└─ z.ts']);
    expect(lines[0]).not.toContain('truncated');
    expect(lines[0]).not.toContain('#L');
  });

  it('renders an empty ranges array as a bare-path leaf with no range column, distinct from whole-file data', () => {
    const anchors: TreeAnchor[] = [{ path: 'w.ts', ranges: [] }];
    expect(renderAnchorTree(anchors)).toEqual(['└─ w.ts']);
  });

  describe('degenerate path shapes render as an atomic top-level leaf', () => {
    it('a bare filename with no slash', () => {
      const anchors: TreeAnchor[] = [{ path: 'file.txt', ranges: [range(1, 2)] }];
      expect(renderAnchorTree(anchors)).toEqual(['└─ file.txt #L1-L2']);
    });

    it('a leading slash', () => {
      const anchors: TreeAnchor[] = [{ path: '/a/b.ts', ranges: [range(1, 2)] }];
      expect(renderAnchorTree(anchors)).toEqual(['└─ /a/b.ts #L1-L2']);
    });

    it('a trailing slash', () => {
      const anchors: TreeAnchor[] = [{ path: 'a/b/', ranges: [range(1, 2)] }];
      expect(renderAnchorTree(anchors)).toEqual(['└─ a/b/ #L1-L2']);
    });

    it('a doubled slash', () => {
      const anchors: TreeAnchor[] = [{ path: 'a//b.ts', ranges: [range(1, 2)] }];
      expect(renderAnchorTree(anchors)).toEqual(['└─ a//b.ts #L1-L2']);
    });

    it('the empty string', () => {
      const anchors: TreeAnchor[] = [{ path: '', ranges: [range(1, 2)] }];
      expect(renderAnchorTree(anchors)).toEqual(['└─  #L1-L2']);
    });
  });

  it('caps padding at 48 columns past the tree prefix for a pathologically long filename', () => {
    const longName = `${'x'.repeat(60)}.ts`;
    const anchors: TreeAnchor[] = [
      { path: longName, ranges: [range(1, 2)] },
      { path: 'a.ts', ranges: [range(3, 4)] }
    ];

    const lines = renderAnchorTree(anchors);
    // The pathologically long name gets a single space before its range —
    // it is never truncated/elided, and it doesn't grow the pad further.
    expect(lines[0]).toBe(`├─ ${longName} #L1-L2`);
    // The short sibling's padding is capped at 48 columns (not the long
    // name's actual width), so its own name+pad totals 48 + 1 columns.
    const shortLine = lines[1];
    const prefixLen = '└─ '.length;
    const afterPrefix = shortLine.slice(prefixLen);
    const rangeIdx = afterPrefix.indexOf('#L3-L4');
    expect(rangeIdx).toBe(49); // 48-column cap + 1 trailing space before the range
  });

  it('computes alignment over Unicode code points, not UTF-16 length, for a non-BMP character', () => {
    // '\u{1F600}' (an emoji outside the BMP) is one code point but a UTF-16
    // surrogate pair (length 2); Array.from(...).length must count it as 1.
    const emojiName = '\u{1F600}.ts'; // 4 code points: 😀 . t s
    const anchors: TreeAnchor[] = [
      { path: emojiName, ranges: [range(1, 2)] },
      { path: 'abcd.ts', ranges: [range(3, 4)] } // 7 code points, sets groupMax
    ];

    const lines = renderAnchorTree(anchors);
    const prefixLen = '├─ '.length;
    const afterPrefix = lines[0].slice(prefixLen);
    // groupMax is 7 (code points of 'abcd.ts'); the emoji name is 4 code
    // points, so padding is 7 - 4 + 1 = 4 spaces — this only comes out right
    // if code points, not UTF-16 length (5), were used for the emoji name.
    expect(afterPrefix).toBe(`${emojiName}    #L1-L2`);
  });
});
