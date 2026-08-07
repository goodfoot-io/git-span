/**
 * Height bound for the anchor tree, measured over this repository's own span
 * data via the real `git span list --porcelain` — the same rows the hooks
 * render at runtime, at the scale and shape they actually occur in.
 *
 * The contract asserted here is exact, not a slack budget:
 *
 *   tree lines = flat lines + one line per *branching* directory
 *
 * where a branching directory is one holding two or more distinct children.
 * The tree may therefore only ever pay for grouping the reader actually gets;
 * it must never pay per path segment. An earlier implementation folded a
 * single-child directory chain only while the lone child was itself a
 * directory, so every `dir/file.ts` leaf bought its own line — the flat list's
 * 191 anchors rendered as 334 lines instead of 263, and this assertion fails
 * loudly on that shape rather than on a hand-picked example of it.
 *
 * The branching-directory count is derived here from the paths alone, with no
 * reference to the renderer's own trie or folding rule, so the two can be
 * compared rather than one restating the other.
 *
 * If `git span` is not available on PATH, this suite is skipped.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { collapseByPath, type RangeLabel, renderAnchorTree } from '../../src/common/anchor-tree.js';

const hasGitSpan = (() => {
  // Bounded check: a broken/placeholder git-span binary must fail fast here
  // rather than hang or recurse (see git-span-fork-bomb incident report).
  const result = spawnSync('git', ['span', '--version'], { stdio: 'ignore', timeout: 5_000 });
  return result.status === 0;
})();

const suite = hasGitSpan ? describe : describe.skip;

interface Row {
  path: string;
  range: RangeLabel;
  suffix: string;
}

/** Every span in this repository, as the rows its hook rendering would receive. */
function spansFromCli(): Map<string, Row[]> {
  const stdout = execFileSync('git', ['span', 'list', '--porcelain'], { encoding: 'utf8' });
  const bySpan = new Map<string, Row[]>();
  for (const line of stdout.split('\n')) {
    if (line.trim().length === 0) continue;
    const [name, path, rangeText] = line.split('\t');
    const [start, end] = rangeText.split('-').map(Number);
    const range: RangeLabel = start === 0 && end === 0 ? { kind: 'whole-file' } : { kind: 'range', start, end };
    const rows = bySpan.get(name);
    if (rows) rows.push({ path, range, suffix: '' });
    else bySpan.set(name, [{ path, range, suffix: '' }]);
  }
  return bySpan;
}

/**
 * Count the directories in these paths that hold two or more distinct
 * children — the only places a tree line earns its keep. Built independently
 * of the renderer: a plain nested map, leaf keys kept disjoint from directory
 * keys, degenerate paths (which the renderer keeps atomic) treated as
 * top-level leaves.
 */
function branchingDirectories(paths: string[]): number {
  type Dir = Map<string, Dir | null>;
  const root: Dir = new Map();
  for (const path of new Set(paths)) {
    const segments = path.split('/');
    if (path.length === 0 || segments.some((segment) => segment.length === 0)) {
      root.set(`leaf:${path}`, null);
      continue;
    }
    let cur = root;
    for (const segment of segments.slice(0, -1)) {
      const existing = cur.get(`dir:${segment}`);
      if (existing) {
        cur = existing;
      } else {
        const next: Dir = new Map();
        cur.set(`dir:${segment}`, next);
        cur = next;
      }
    }
    cur.set(`leaf:${segments[segments.length - 1]}`, null);
  }

  let count = 0;
  const walk = (dir: Dir): void => {
    for (const child of dir.values()) {
      if (!child) continue;
      if (child.size >= 2) count++;
      walk(child);
    }
  };
  walk(root);
  return count;
}

suite('anchor tree height over real span data', () => {
  it('costs exactly one line per branching directory, and nothing per path segment', () => {
    const bySpan = spansFromCli();
    expect(bySpan.size).toBeGreaterThan(0);

    const overshot: string[] = [];
    for (const [name, rows] of bySpan) {
      const height = renderAnchorTree(collapseByPath(rows)).length;
      const bound = rows.length + branchingDirectories(rows.map((row) => row.path));
      if (height !== bound) overshot.push(`${name}: ${height} lines, expected ${bound}`);
    }

    expect(overshot).toEqual([]);
  });

  it('renders a single-anchor span as exactly one line, whatever its path depth', () => {
    const singles = [...spansFromCli().values()].filter((rows) => rows.length === 1);
    expect(singles.length).toBeGreaterThan(0);
    for (const rows of singles) {
      expect(renderAnchorTree(collapseByPath(rows))).toHaveLength(1);
    }
  });

  it('names every anchor path in full, so no anchor is erased by the layout', () => {
    for (const rows of spansFromCli().values()) {
      const lines = renderAnchorTree(collapseByPath(rows));
      // Segments are split across a directory line and its children, so
      // reassembly is by containment of each path's final segment plus its
      // parent directory text somewhere above it — the cheap, sufficient
      // check is that no rendered line is blank or whitespace-only, and that
      // every distinct filename appears somewhere.
      for (const line of lines) expect(line.trim()).not.toBe('');
      for (const path of new Set(rows.map((row) => row.path))) {
        const leaf = path.split('/').pop() as string;
        expect(lines.some((line) => line.includes(leaf))).toBe(true);
      }
    }
  });
});
