/**
 * Unit tests for the shared anchor-tree renderer. Covers `collapseByPath`'s
 * first-occurrence rule in isolation, then `renderAnchorTree`'s tree
 * construction/rendering rules: directory collapsing, sibling expansion,
 * multi-range stacking and alignment, numeric range sorting, the
 * `range`/`whole-file`/`truncated` `RangeLabel` kinds, degenerate path
 * handling, the alignment ceiling, and display-column math.
 *
 * The height bound over this repository's real span data lives in
 * `anchor-tree-height.test.ts`, which needs the `git span` CLI and so is
 * skipped where the unit tests are not.
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

  it('collapses a single-child directory chain into one combined-name line, stopping where it branches', () => {
    const anchors: TreeAnchor[] = [
      { path: 'public/claude/runtime/skills/card/SKILL.md', ranges: [range(1, 91)] },
      { path: 'public/claude/runtime/skills/card/references/contest.md', ranges: [range(1, 191)] }
    ];

    expect(renderAnchorTree(anchors)).toEqual([
      '└─ public/claude/runtime/skills/card/',
      '   ├─ SKILL.md              #L1-L91',
      '   └─ references/contest.md #L1-L191'
    ]);
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

  describe('a whole-file anchor stacked behind a range on the same path', () => {
    it('carries an explicit marker so neither anchor nor its drift suffix is misattributable', () => {
      // The CLI reports these as two rows (`src/a.ts 0-0`, `src/a.ts 5-9`);
      // only the whole-file one drifted. Both must be identifiable, and the
      // ` — changed` must sit on a line that names which anchor drifted.
      const anchors = collapseByPath([
        { path: 'src/a.ts', range: { kind: 'whole-file' }, suffix: ' — changed' },
        { path: 'src/a.ts', range: { kind: 'range', start: 5, end: 9 }, suffix: '' },
        { path: 'src/b.ts', range: { kind: 'range', start: 1, end: 1 }, suffix: '' }
      ]);

      expect(renderAnchorTree(anchors)).toEqual([
        '└─ src/',
        '   ├─ a.ts (whole file) — changed',
        '   │       #L5-L9',
        '   └─ b.ts #L1-L1'
      ]);
    });

    it('stays identifiable with no suffix at all, never degenerating to a blank line', () => {
      const anchors = collapseByPath([
        { path: 'src/a.ts', range: { kind: 'whole-file' }, suffix: '' },
        { path: 'src/a.ts', range: { kind: 'range', start: 5, end: 9 }, suffix: '' }
      ]);

      const lines = renderAnchorTree(anchors);
      expect(lines).toEqual(['└─ src/a.ts (whole file)', '            #L5-L9']);
      for (const line of lines) expect(line.trim()).not.toBe('');
    });

    it('sorts the whole-file entry ahead of every line range on that path', () => {
      // Arrival order puts the ranges first; the whole-file entry covers the
      // file, so it leads — the same position the CLI's `0-0` row implies.
      const anchors = collapseByPath([
        { path: 'a.ts', range: { kind: 'range', start: 5, end: 9 }, suffix: '' },
        { path: 'a.ts', range: { kind: 'range', start: 1, end: 2 }, suffix: '' },
        { path: 'a.ts', range: { kind: 'whole-file' }, suffix: '' }
      ]);

      const lines = renderAnchorTree(anchors);
      expect(lines[0]).toContain('(whole file)');
      expect(lines[1]).toContain('#L1-L2');
      expect(lines[2]).toContain('#L5-L9');
    });
  });

  describe('single-child folding', () => {
    it('folds a lone leaf onto its directory’s line, so a single anchor is one line at any depth', () => {
      const anchors: TreeAnchor[] = [{ path: 'public/claude/runtime/skills/card/SKILL.md', ranges: [range(1, 91)] }];
      expect(renderAnchorTree(anchors)).toEqual(['└─ public/claude/runtime/skills/card/SKILL.md #L1-L91']);
    });

    it('keeps the discriminating segment on the same line as its range for mod.rs-style layouts', () => {
      const anchors: TreeAnchor[] = [
        { path: 'packages/git-span/src/resolver/dirty/mod.rs', ranges: [range(392, 399)] },
        { path: 'packages/git-span/src/resolver/engine/mod.rs', ranges: [range(702, 730)] },
        { path: 'packages/git-span/src/resolver/exact/mod.rs', ranges: [range(613, 620)] },
        { path: 'packages/git-span/src/resolver/incremental/mod.rs', ranges: [range(255, 262)] }
      ];

      expect(renderAnchorTree(anchors)).toEqual([
        '└─ packages/git-span/src/resolver/',
        '   ├─ dirty/mod.rs       #L392-L399',
        '   ├─ engine/mod.rs      #L702-L730',
        '   ├─ exact/mod.rs       #L613-L620',
        '   └─ incremental/mod.rs #L255-L262'
      ]);
    });

    it('measures the folded name — not the bare filename — when padding a sibling group', () => {
      // Both leaves are named `mod.rs`; only the folded names differ in width,
      // so the range column can only line up if the fold is what gets measured.
      const anchors: TreeAnchor[] = [
        { path: 'dir/a/mod.rs', ranges: [range(1, 2)] },
        { path: 'dir/bbbbb/mod.rs', ranges: [range(3, 4)] }
      ];

      expect(renderAnchorTree(anchors)).toEqual(['└─ dir/', '   ├─ a/mod.rs     #L1-L2', '   └─ bbbbb/mod.rs #L3-L4']);
    });
  });

  it('forgoes alignment entirely in a group whose widest name passes the 48-column ceiling', () => {
    // Padding short siblings to a 48-column ceiling while the long name sits
    // at its own natural column aligns nothing while paying most of the
    // width. The coherent end is: the group either aligns or it does not.
    const longName = `${'x'.repeat(60)}.ts`;
    const anchors: TreeAnchor[] = [
      { path: longName, ranges: [range(1, 2)] },
      { path: 'a.ts', ranges: [range(3, 4)] }
    ];

    expect(renderAnchorTree(anchors)).toEqual([`├─ ${longName} #L1-L2`, '└─ a.ts #L3-L4']);
  });

  it('still aligns a group whose widest name sits exactly at the ceiling', () => {
    const atCeiling = 'y'.repeat(48);
    const anchors: TreeAnchor[] = [
      { path: atCeiling, ranges: [range(1, 2)] },
      { path: 'a.ts', ranges: [range(3, 4)] }
    ];

    const lines = renderAnchorTree(anchors);
    expect(lines[1]).toBe(`└─ a.ts${' '.repeat(45)}#L3-L4`);
    expect(lines[0].indexOf('#L1-L2')).toBe(lines[1].indexOf('#L3-L4'));
  });

  describe('alignment is measured in terminal columns, not code points or UTF-16 units', () => {
    it('counts an emoji as the two columns it occupies, not the one code point it is', () => {
      const emojiName = '\u{1F600}.ts'; // 4 code points, 5 display columns
      const anchors: TreeAnchor[] = [
        { path: emojiName, ranges: [range(1, 2)] },
        { path: 'abcdefg.ts', ranges: [range(3, 4)] } // 10 columns, sets the group target
      ];

      const lines = renderAnchorTree(anchors);
      expect(lines[0]).toBe(`├─ ${emojiName}${' '.repeat(6)}#L1-L2`); // 10 - 5 + 1 spaces
      expect(lines[1]).toBe('└─ abcdefg.ts #L3-L4');
    });

    it('counts a CJK ideograph as two columns', () => {
      const anchors: TreeAnchor[] = [
        { path: '日本.ts', ranges: [range(1, 2)] }, // 日本.ts — 7 columns
        { path: 'abcdefg.ts', ranges: [range(3, 4)] } // 10 columns
      ];

      expect(renderAnchorTree(anchors)[0]).toBe(`├─ 日本.ts${' '.repeat(4)}#L1-L2`); // 10 - 7 + 1
    });

    it('counts a decomposed accent as the one column it renders as, not two code points', () => {
      const decomposed = 'e\u0301.ts'; // e + combining acute — 5 code points, 4 display columns
      const anchors: TreeAnchor[] = [
        { path: decomposed, ranges: [range(1, 2)] },
        { path: 'abcdefg.ts', ranges: [range(3, 4)] } // 10 columns
      ];

      expect(renderAnchorTree(anchors)[0]).toBe(`├─ ${decomposed}${' '.repeat(7)}#L1-L2`); // 10 - 4 + 1
    });
  });
});
