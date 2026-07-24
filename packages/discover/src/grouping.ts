/**
 * Anchor-overlap primitives shared by the n-ary grouping pipeline.
 *
 * The old `mergeAnchorGroups`/`UnionFind` pairwise merge machinery (design
 * decision 8) is superseded by weighted graph construction (`graph.ts`) plus
 * near-clique extraction (`clique-extraction.ts`) — it is deleted. What
 * remains are the three pure anchor primitives the new pipeline still reuses:
 *
 *   - `anchorsOverlap()` — the per-anchor equivalence rule (≥80% IoU on the
 *     same path, or whole-file-covers-any-range) that `graph.ts` fuses graph
 *     nodes with.
 *   - `collapseAnchors()` — per-path range/whole-file collapsing, used to
 *     reconstruct a candidate's reported anchors at report time (`cli.ts`).
 *   - `anchorSetsFullyMatch()` — today's exact bipartite match, retained (per
 *     the Testable-Uncertainty-2 spike's divergence finding) as the narrower
 *     secondary gate on 2-node/0-missing-edge reportability in `cli.ts`, so
 *     hub-bridged per-path fusion cannot change the *set* of reported 2-file
 *     groups (must-have 5).
 *
 * "Overlap" between two individual anchors is:
 *
 *   - ≥80% intersection-over-union of two line ranges on the same path, or
 *   - 100% (always) when either anchor is whole-file (no range) — a whole-file
 *     candidate always merges into a more specific range candidate on that
 *     path rather than crashing or silently failing to merge.
 */

import type { Anchor } from './types.js';

/** Minimum intersection-over-union for two ranges on the same path to be treated as overlapping. */
const OVERLAP_THRESHOLD = 0.8;

function hasRange(anchor: Anchor): anchor is Anchor & { startLine: number; endLine: number } {
  return anchor.startLine !== undefined && anchor.endLine !== undefined;
}

/** Intersection-over-union of two inclusive line ranges, in [0, 1]. */
function rangeIoU(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const interStart = Math.max(aStart, bStart);
  const interEnd = Math.min(aEnd, bEnd);
  const intersection = Math.max(0, interEnd - interStart + 1);
  const union = Math.max(aEnd, bEnd) - Math.min(aStart, bStart) + 1;
  return union > 0 ? intersection / union : 0;
}

/**
 * True when two anchors overlap under design decision 8's rules. Requires a
 * shared path; a whole-file anchor (no range) overlaps 100% with any range
 * anchor on that path.
 */
export function anchorsOverlap(a: Anchor, b: Anchor): boolean {
  if (a.path !== b.path) return false;
  if (!hasRange(a) || !hasRange(b)) return true;
  return rangeIoU(a.startLine, a.endLine, b.startLine, b.endLine) >= OVERLAP_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Anchor collapsing
// ---------------------------------------------------------------------------

/**
 * Collapses a merged group's anchors: per path, a whole-file anchor is dropped
 * whenever any range anchor exists for that path (the range is more specific,
 * design decision 8), and overlapping range anchors are merged into their
 * bounding range so the group carries one anchor per distinct region rather
 * than a pile of near-duplicates.
 */
export function collapseAnchors(anchors: Anchor[]): Anchor[] {
  const ranges = new Map<string, Array<[number, number]>>();
  const wholeFile = new Set<string>();

  for (const anchor of anchors) {
    if (hasRange(anchor)) {
      const list = ranges.get(anchor.path) ?? [];
      list.push([anchor.startLine, anchor.endLine]);
      ranges.set(anchor.path, list);
    } else {
      wholeFile.add(anchor.path);
    }
  }

  const result: Anchor[] = [];

  for (const [path, list] of ranges) {
    list.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let [curStart, curEnd] = list[0];
    for (let i = 1; i < list.length; i++) {
      const [start, end] = list[i];
      // Merge intervals that overlap or touch; otherwise emit and restart.
      if (start <= curEnd + 1) {
        curEnd = Math.max(curEnd, end);
      } else {
        result.push({ path, startLine: curStart, endLine: curEnd });
        [curStart, curEnd] = [start, end];
      }
    }
    result.push({ path, startLine: curStart, endLine: curEnd });
  }

  for (const path of wholeFile) {
    // Whole-file anchor is superseded by any range anchor on the same path.
    if (!ranges.has(path)) result.push({ path });
  }

  return sortAnchors(result);
}

function sortAnchors(anchors: Anchor[]): Anchor[] {
  return [...anchors].sort(
    (a, b) =>
      a.path.localeCompare(b.path) || (a.startLine ?? 0) - (b.startLine ?? 0) || (a.endLine ?? 0) - (b.endLine ?? 0)
  );
}

/**
 * True when every anchor in `a` has a distinct, overlapping counterpart in
 * `b` and vice versa (a perfect bipartite matching under `anchorsOverlap`) —
 * i.e. `a` and `b` describe the *same* candidate coupling, not merely a
 * coupling that happens to share one participant anchor. Group sizes are
 * small in practice (each signal emits one anchor per participant
 * file/range), so a straightforward backtracking search is cheap; this is
 * what a single shared hub anchor (e.g. a whole-file anchor on a hot path)
 * fails, since its group's *other* anchor still needs its own match.
 *
 * Retained (rather than deleted with `mergeAnchorGroups`) because the
 * Testable-Uncertainty-2 spike found real divergence: per-path union-find node
 * identity opens a combinatorial surface of hub-bridged near-clique candidates
 * that today's exact match would never form. `cli.ts` wires this in as the
 * narrower secondary gate on 2-node/0-missing-edge reportability so that
 * broader fusion drives only 3+-node topology, never the *set* of reported
 * 2-file groups (must-have 5).
 */
export function anchorSetsFullyMatch(a: readonly Anchor[], b: readonly Anchor[]): boolean {
  if (a.length !== b.length) return false;
  const usedB = new Array<boolean>(b.length).fill(false);

  function backtrack(i: number): boolean {
    if (i === a.length) return true;
    for (let j = 0; j < b.length; j++) {
      if (usedB[j] || !anchorsOverlap(a[i], b[j])) continue;
      usedB[j] = true;
      if (backtrack(i + 1)) return true;
      usedB[j] = false;
    }
    return false;
  }

  return backtrack(0);
}
