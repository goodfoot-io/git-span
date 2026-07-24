/**
 * Weighted graph construction (near-clique grouping plan, "Graph construction").
 *
 * Pairwise signals still emit exactly 2-anchor `AnchorGroup`s (non-goals) —
 * this module is what turns that flat pairwise evidence into a graph whose
 * nodes are per-path-fused anchor equivalence classes and whose edges pool
 * every signal's evidence for a given node pair into one weight via the
 * existing `scoreEvidence()`.
 *
 * Node identity is **global per path**: a whole-file anchor and a range
 * anchor on the same path always fuse into one node (via the existing
 * `anchorsOverlap()`), and this fusion can never cross different files
 * (`anchorsOverlap` requires `a.path === b.path`). This is strictly broader
 * than `grouping.ts`'s `anchorSetsFullyMatch` (it chains transitively), which
 * is exactly why the *reported* anchors for a candidate are reconstructed
 * per-candidate at report time (Stage 2+) from `GraphNode.anchorsByEdge`,
 * never from a node's full global anchor history — see the plan's
 * "Node-anchor reporting gap (and fix)" section.
 */

import { anchorsOverlap } from './grouping.js';
import { scoreEvidence } from './scoring.js';
import type { Anchor, AnchorGroup, Edge } from './types.js';

/**
 * One node in the weighted graph: a per-path-fused equivalence class of
 * anchors.
 */
export interface GraphNode {
  id: number;
  /**
   * Anchors that fused into this node, indexed by which neighbor node id the
   * anchor was contributed alongside (i.e., the other side of the 2-anchor
   * signal group it came from) — not a single flattened, pre-collapsed list.
   * This is what per-candidate anchor reconstruction at report time reads
   * from instead of this node's entire graph-wide anchor history (the fix
   * for the node-anchor reporting gap).
   */
  anchorsByEdge: Map<number, Anchor[]>;
}

/**
 * The global-per-path-fused graph plus an adjacency lookup keyed by node-id
 * pair, for the extraction step (Stage 2) and for on-demand gap-weight
 * lookups (Scoring, Stage 4).
 */
export interface WeightedGraph {
  nodes: GraphNode[];
  /** Only node pairs with ≥1 bucketed evidence entry — includes both above- and below-`EDGE_THRESHOLD` weights. */
  edges: Edge[];
  /** The materialized `Edge` between two node ids, if any evidence was ever bucketed for that pair. */
  edgeBetween(nodeIdA: number, nodeIdB: number): Edge | undefined;
  /**
   * Raw weight for any node pair, present or not. A pair with zero bucketed
   * evidence at all defaults to `scoreEvidence([]) = 0.5` (the neutral
   * point), computed lazily rather than precomputed for every possible node
   * pair in the graph.
   */
  weightBetween(nodeIdA: number, nodeIdB: number): number;
}

// ---------------------------------------------------------------------------
// Union-find over anchors (mirrors grouping.ts's UnionFind, but operates on
// individual anchors rather than whole groups — see module header).
// ---------------------------------------------------------------------------

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
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

function anchorKey(anchor: Anchor): string {
  return `${anchor.path}:${anchor.startLine ?? ''}:${anchor.endLine ?? ''}`;
}

/** Every (groupIndex, anchor) occurrence across every group, flattened for union-find over individual anchor instances. */
interface AnchorOccurrence {
  anchor: Anchor;
  groupIndex: number;
  /** Position of this anchor within its group's `anchors` array. */
  anchorIndex: number;
}

/**
 * Unions every pair of anchor occurrences on the same path that
 * `anchorsOverlap`, bucketed by path first (like `grouping.ts`'s
 * `unionOverlappingGroups`) so this stays far cheaper than an O(n²) scan over
 * every anchor occurrence in the graph.
 */
function unionOverlappingAnchors(occurrences: readonly AnchorOccurrence[], uf: UnionFind): void {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < occurrences.length; i++) {
    const path = occurrences[i].anchor.path;
    const bucket = buckets.get(path) ?? [];
    bucket.push(i);
    buckets.set(path, bucket);
  }

  for (const bucket of buckets.values()) {
    for (let a = 0; a < bucket.length; a++) {
      const i = bucket[a];
      for (let b = a + 1; b < bucket.length; b++) {
        const j = bucket[b];
        if (uf.find(i) === uf.find(j)) continue;
        if (anchorsOverlap(occurrences[i].anchor, occurrences[j].anchor)) uf.union(i, j);
      }
    }
  }
}

/** Deterministic ordering for two node-pair-scoped anchors — smallest path/range wins, so a and b endpoints stay stable across shuffled input. */
function compareAnchors(a: Anchor, b: Anchor): number {
  return (
    a.path.localeCompare(b.path) || (a.startLine ?? -1) - (b.startLine ?? -1) || (a.endLine ?? -1) - (b.endLine ?? -1)
  );
}

/** Canonical unordered key for a node-id pair. */
function pairKey(nodeIdA: number, nodeIdB: number): string {
  return nodeIdA <= nodeIdB ? `${nodeIdA}:${nodeIdB}` : `${nodeIdB}:${nodeIdA}`;
}

/**
 * Builds the weighted graph from every signal's flattened, un-merged
 * `AnchorGroup[]` output (the same input `mergeAnchorGroups` takes today).
 *
 * Steps (plan "Graph construction"):
 *  1. Union-find over every anchor occurrence, using `anchorsOverlap` — node
 *     identity is global per path.
 *  2. Each equivalence class becomes one `GraphNode`, retaining member
 *     anchors indexed by which neighbor node id they were contributed
 *     alongside (the node-anchor reporting gap fix).
 *  3. For every group's 2-anchor pairing, map both anchors to their node ids
 *     and accumulate the group's evidence into that node-pair's bucket.
 *  4. For each node pair with ≥1 bucketed evidence entry, compute
 *     `weight = scoreEvidence(bucketedEvidence)` → one `Edge`.
 *  5. Output `{ nodes, edges }` plus the adjacency lookups.
 */
export function buildGraph(groups: readonly AnchorGroup[]): WeightedGraph {
  // Flatten every anchor occurrence across every group.
  const occurrences: AnchorOccurrence[] = [];
  groups.forEach((group, groupIndex) => {
    group.anchors.forEach((anchor, anchorIndex) => {
      occurrences.push({ anchor, groupIndex, anchorIndex });
    });
  });

  const uf = new UnionFind(occurrences.length);
  unionOverlappingAnchors(occurrences, uf);

  // Assign a stable node id per equivalence class: the class's occurrences,
  // sorted, and keyed by the class's root — but id assignment itself is
  // ordered by each class's smallest anchor, so shuffled input order doesn't
  // change which id a given anchor lands on.
  const rootToOccurrenceIndices = new Map<number, number[]>();
  for (let i = 0; i < occurrences.length; i++) {
    const root = uf.find(i);
    const bucket = rootToOccurrenceIndices.get(root) ?? [];
    bucket.push(i);
    rootToOccurrenceIndices.set(root, bucket);
  }

  const classesBySmallestAnchor = [...rootToOccurrenceIndices.values()].sort((a, b) => {
    const anchorsA = a.map((i) => occurrences[i].anchor).sort(compareAnchors);
    const anchorsB = b.map((i) => occurrences[i].anchor).sort(compareAnchors);
    return compareAnchors(anchorsA[0], anchorsB[0]);
  });

  const rootToNodeId = new Map<number, number>();
  const nodes: GraphNode[] = classesBySmallestAnchor.map((occurrenceIndices, nodeId) => {
    const root = uf.find(occurrenceIndices[0]);
    rootToNodeId.set(root, nodeId);
    return { id: nodeId, anchorsByEdge: new Map<number, Anchor[]>() };
  });

  function nodeIdOf(occurrenceIndex: number): number {
    return rootToNodeId.get(uf.find(occurrenceIndex))!;
  }

  // Per-node-pair evidence buckets, plus per-(node, neighbor) anchor
  // contribution lists for the node-anchor reporting fix.
  const evidenceByPair = new Map<string, { nodeIdA: number; nodeIdB: number; evidence: AnchorGroup['evidence'] }>();

  let occurrenceCursor = 0;
  for (const group of groups) {
    const groupOccurrenceIndices = group.anchors.map(() => occurrenceCursor++);

    // Every distinct pair of anchors within this group is one edge
    // (non-goals guarantee this is exactly one pair per group in practice,
    // but this generalizes correctly for any anchor count).
    for (let a = 0; a < groupOccurrenceIndices.length; a++) {
      for (let b = a + 1; b < groupOccurrenceIndices.length; b++) {
        const occA = groupOccurrenceIndices[a];
        const occB = groupOccurrenceIndices[b];
        const nodeIdA = nodeIdOf(occA);
        const nodeIdB = nodeIdOf(occB);
        if (nodeIdA === nodeIdB) continue; // Fused into the same node — not a real edge.

        const key = pairKey(nodeIdA, nodeIdB);
        let bucket = evidenceByPair.get(key);
        if (!bucket) {
          bucket = { nodeIdA, nodeIdB, evidence: [] };
          evidenceByPair.set(key, bucket);
        }
        bucket.evidence.push(...group.evidence);

        // Record which anchors each node contributed to *this specific*
        // neighbor edge — kept separate per neighbor so an unrelated edge
        // sharing this node never leaks its anchors in here.
        const nodeA = nodes[nodeIdA];
        const nodeB = nodes[nodeIdB];
        const anchorA = occurrences[occA].anchor;
        const anchorB = occurrences[occB].anchor;

        const towardB = nodeA.anchorsByEdge.get(nodeIdB) ?? [];
        if (!towardB.some((existing) => anchorKey(existing) === anchorKey(anchorA))) towardB.push(anchorA);
        nodeA.anchorsByEdge.set(nodeIdB, towardB);

        const towardA = nodeB.anchorsByEdge.get(nodeIdA) ?? [];
        if (!towardA.some((existing) => anchorKey(existing) === anchorKey(anchorB))) towardA.push(anchorB);
        nodeB.anchorsByEdge.set(nodeIdA, towardA);
      }
    }
  }

  const edgeByKey = new Map<string, Edge>();
  const edges: Edge[] = [];
  for (const [key, bucket] of evidenceByPair) {
    const nodeA = nodes[bucket.nodeIdA];
    const nodeB = nodes[bucket.nodeIdB];
    const representativeA = [...nodeA.anchorsByEdge.get(bucket.nodeIdB)!].sort(compareAnchors)[0];
    const representativeB = [...nodeB.anchorsByEdge.get(bucket.nodeIdA)!].sort(compareAnchors)[0];
    const edge: Edge = {
      a: representativeA,
      b: representativeB,
      evidence: bucket.evidence,
      weight: scoreEvidence(bucket.evidence)
    };
    edgeByKey.set(key, edge);
    edges.push(edge);
  }

  edges.sort((x, y) => compareAnchors(x.a, y.a) || compareAnchors(x.b, y.b));

  return {
    nodes,
    edges,
    edgeBetween(nodeIdA: number, nodeIdB: number): Edge | undefined {
      return edgeByKey.get(pairKey(nodeIdA, nodeIdB));
    },
    weightBetween(nodeIdA: number, nodeIdB: number): number {
      return edgeByKey.get(pairKey(nodeIdA, nodeIdB))?.weight ?? scoreEvidence([]);
    }
  };
}

/** The id of the node `anchor` fused into, or `undefined` if it isn't part of `graph` at all. */
export function nodeIdForAnchor(graph: WeightedGraph, anchor: Anchor): number | undefined {
  for (const node of graph.nodes) {
    for (const anchors of node.anchorsByEdge.values()) {
      if (anchors.some((a) => anchorKey(a) === anchorKey(anchor))) return node.id;
    }
  }
  return undefined;
}
