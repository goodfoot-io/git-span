/**
 * Fuzzy anchor-group merging (design decision 8).
 *
 * All seven signals independently emit `AnchorGroup[]`, each describing one
 * candidate coupling as a small set of anchors (in practice, one per
 * participant file/range — see each signal's pairwise emission). This module
 * flattens and merges them into a single deduplicated set of candidate
 * groups.
 *
 * Two groups merge only when their anchor sets are the **same candidate
 * coupling**: every anchor in one has a distinct, corresponding overlapping
 * anchor in the other (a perfect bipartite matching under `anchorsOverlap`),
 * and vice versa. "Overlap" between two individual anchors is:
 *
 *   - ≥80% intersection-over-union of two line ranges on the same path, or
 *   - 100% (always) when either anchor is whole-file (no range) — a whole-file
 *     candidate always merges into a more specific range candidate on that
 *     path rather than crashing or silently failing to merge.
 *
 * Requiring a full correspondence (not just *any* shared anchor) is what
 * keeps a hub file from transitively chaining unrelated pairs together: a
 * group `{X, A}` and a group `{X, B}` both touch `X`, but `A` has no
 * counterpart in `{X, B}` (and `B` has none in `{X, A}`), so they do not
 * merge — only groups describing the *same* pair (e.g. two signals each
 * independently observing `{X, A}`) do.
 *
 * Merging is done with **union-find over the transitive full-match
 * relation**, not a greedy pairwise pass, so the order in which the parallel
 * signals ran never changes which groups form (constraint:
 * order-independence). Merging **unions** the contributing groups' `evidence`
 * arrays — it never overwrites one side's evidence with the other's — so
 * every signal's original entries (with their commit/tag refs intact)
 * survive a merge, preserving the evidence trail a human reviewer needs.
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

/**
 * True when every anchor in `a` has a distinct, overlapping counterpart in
 * `b` and vice versa (a perfect bipartite matching under `anchorsOverlap`) —
 * i.e. `a` and `b` describe the *same* candidate coupling, not merely a
 * coupling that happens to share one participant anchor. Group sizes are
 * small in practice (each signal emits one anchor per participant
 * file/range), so a straightforward backtracking search is cheap; this is
 * what a single shared hub anchor (e.g. a whole-file anchor on a hot path)
 * fails, since its group's *other* anchor still needs its own match.
 */
function anchorSetsFullyMatch(a: readonly Anchor[], b: readonly Anchor[]): boolean {
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

/**
 * Unions groups that describe the same candidate coupling, without the naive
 * all-pairs (O(groups²)) scan over the whole input. `anchorsOverlap` can only
 * be true for anchors on the *same path*, so bucketing group indices by every
 * path they touch and only comparing groups that share a bucket skips every
 * pair with no path in common — the overwhelming majority on a real repo.
 * Within a bucket, groups are compared pairwise with `anchorSetsFullyMatch`
 * (not just "some anchor overlaps"): a hub file pulls many otherwise-unrelated
 * pairs into the same bucket, but the full-match check keeps them from
 * unioning transitively through it — only pairs whose *entire* anchor set
 * corresponds (e.g. two signals independently observing the same file pair)
 * union. Bucket sizes track how many candidate couplings share a given path,
 * not the total number of groups, so this stays far cheaper than the
 * quadratic scan it replaces even on a large real-world run.
 */
function unionOverlappingGroups(list: readonly AnchorGroup[], uf: UnionFind): void {
  const buckets = new Map<string, Set<number>>();
  for (let i = 0; i < list.length; i++) {
    for (const anchor of list[i].anchors) {
      let bucket = buckets.get(anchor.path);
      if (!bucket) {
        bucket = new Set();
        buckets.set(anchor.path, bucket);
      }
      bucket.add(i);
    }
  }

  for (const bucket of buckets.values()) {
    const indices = [...bucket];
    for (let a = 0; a < indices.length; a++) {
      const i = indices[a];
      for (let b = a + 1; b < indices.length; b++) {
        const j = indices[b];
        if (uf.find(i) === uf.find(j)) continue;
        if (anchorSetsFullyMatch(list[i].anchors, list[j].anchors)) uf.union(i, j);
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
