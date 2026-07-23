/**
 * Fuzzy anchor-group merging (design decision 8).
 *
 * All seven signals independently emit `AnchorGroup[]`; this module flattens
 * and merges them into a single deduplicated set of candidate groups. Two
 * groups merge when any anchor in one overlaps any anchor in the other on a
 * shared path, where "overlap" is:
 *
 *   - ≥80% intersection-over-union of two line ranges on the same path, or
 *   - 100% (always) when either anchor is whole-file (no range) — a whole-file
 *     candidate always merges into a more specific range candidate on that
 *     path rather than crashing or silently failing to merge.
 *
 * Merging is done with **union-find over the transitive-overlap relation**,
 * not a greedy pairwise pass, so the order in which the parallel signals ran
 * never changes which groups form (constraint: order-independence). Merging
 * **unions** the contributing groups' `evidence` arrays — it never overwrites
 * one side's evidence with the other's — so every signal's original entries
 * (with their commit/tag refs intact) survive a merge, preserving the
 * evidence trail a human reviewer needs.
 *
 * Output is deterministic (anchors, evidence, and groups are all sorted) so a
 * shuffled input order produces byte-identical output.
 */

import type { Anchor, AnchorGroup, SignalEvidence } from './types.js';

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
// Union-find
// ---------------------------------------------------------------------------

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // Path compression.
    let cursor = x;
    while (this.parent[cursor] !== root) {
      const next = this.parent[cursor];
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
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
function collapseAnchors(anchors: Anchor[]): Anchor[] {
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

function evidenceKey(evidence: SignalEvidence): string {
  return JSON.stringify([
    evidence.signal,
    evidence.strength,
    evidence.commits ?? [],
    evidence.tags ?? [],
    evidence.detail ?? ''
  ]);
}

/** Unions evidence arrays, dropping only exact duplicates, then sorts deterministically. */
function unionEvidence(groups: AnchorGroup[]): SignalEvidence[] {
  const seen = new Map<string, SignalEvidence>();
  for (const group of groups) {
    for (const evidence of group.evidence) {
      const key = evidenceKey(evidence);
      if (!seen.has(key)) seen.set(key, evidence);
    }
  }
  return [...seen.values()].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
}

function groupSortKey(group: AnchorGroup): string {
  return group.anchors.map((a) => `${a.path}:${a.startLine ?? ''}:${a.endLine ?? ''}`).join('|');
}

/** One range-anchor occurrence on a path: which group it belongs to and its inclusive line range. */
interface RangedOccurrence {
  index: number;
  start: number;
  end: number;
}

/** All anchor occurrences on a single path, split by whole-file vs. ranged. */
interface PathBucket {
  /** Group indices carrying a whole-file (no-range) anchor on this path. */
  wholeFile: number[];
  /** Ranged anchor occurrences on this path. */
  ranged: RangedOccurrence[];
}

/**
 * Unions groups whose anchors overlap, without the naive all-pairs
 * (O(groups²)) scan. `anchorsOverlap` can only be true for anchors on the
 * *same path*, so grouping the anchors by path and unioning within each path
 * bucket yields the identical transitive-overlap components while skipping
 * every pair that shares no path (the overwhelming majority on a real repo,
 * where the all-pairs scan is 10^10+ comparisons and exhausts the time
 * budget). Within a bucket:
 *
 *   - A whole-file anchor overlaps *every* anchor on its path (design decision
 *     8), so a single whole-file anchor collapses the whole bucket into one
 *     component in O(bucket) — no pairwise range work needed.
 *   - An all-ranged path unions only range pairs clearing the 80% IoU
 *     threshold; sorting by start lets each range compare against just the
 *     ranges that can still intersect it (disjoint ranges have IoU 0 and never
 *     union), so the pairwise cost tracks actual overlaps rather than bucket
 *     size squared.
 */
function unionOverlappingGroups(list: readonly AnchorGroup[], uf: UnionFind): void {
  const buckets = new Map<string, PathBucket>();
  for (let i = 0; i < list.length; i++) {
    for (const anchor of list[i].anchors) {
      let bucket = buckets.get(anchor.path);
      if (!bucket) {
        bucket = { wholeFile: [], ranged: [] };
        buckets.set(anchor.path, bucket);
      }
      if (hasRange(anchor)) bucket.ranged.push({ index: i, start: anchor.startLine, end: anchor.endLine });
      else bucket.wholeFile.push(i);
    }
  }

  for (const bucket of buckets.values()) {
    if (bucket.wholeFile.length > 0) {
      const root = bucket.wholeFile[0];
      for (let k = 1; k < bucket.wholeFile.length; k++) uf.union(root, bucket.wholeFile[k]);
      for (const occ of bucket.ranged) uf.union(root, occ.index);
      continue;
    }

    const ranged = bucket.ranged;
    ranged.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let a = 0; a < ranged.length; a++) {
      const ra = ranged[a];
      for (let b = a + 1; b < ranged.length; b++) {
        const rb = ranged[b];
        // Sorted by start: once a later range starts past ra's end, neither it
        // nor any range after it can intersect ra (IoU 0), so stop.
        if (rb.start > ra.end) break;
        if (uf.find(ra.index) === uf.find(rb.index)) continue;
        if (rangeIoU(ra.start, ra.end, rb.start, rb.end) >= OVERLAP_THRESHOLD) uf.union(ra.index, rb.index);
      }
    }
  }
}

/**
 * Merges the flattened output of all signals into one deduplicated set of
 * candidate groups via union-find over the anchor-overlap relation. The
 * returned groups' `score` fields are reset to 0 — scoring (src/scoring.ts) is
 * responsible for (re)deriving a score from the unioned evidence.
 */
export function mergeAnchorGroups(groups: readonly AnchorGroup[]): AnchorGroup[] {
  const list = [...groups];
  if (list.length === 0) return [];

  const uf = new UnionFind(list.length);
  unionOverlappingGroups(list, uf);

  const components = new Map<number, number[]>();
  for (let i = 0; i < list.length; i++) {
    const root = uf.find(i);
    const bucket = components.get(root) ?? [];
    bucket.push(i);
    components.set(root, bucket);
  }

  const merged: AnchorGroup[] = [];
  for (const indices of components.values()) {
    const members = indices.map((i) => list[i]);
    const anchors = collapseAnchors(members.flatMap((g) => g.anchors));
    merged.push({ anchors, evidence: unionEvidence(members), score: 0 });
  }

  return merged.sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b)));
}
