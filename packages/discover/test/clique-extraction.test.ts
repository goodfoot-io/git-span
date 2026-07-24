/**
 * Tests for src/clique-extraction.ts — near-clique extraction (near-clique
 * grouping plan, "Near-clique extraction" and "Subset suppression must run
 * after scoring, not during extraction").
 *
 * Pure over a synthetic `WeightedGraph` — no `buildGraph`/signals/anchors
 * needed, since `Candidate`s are keyed by graph node id only. Mirrors
 * graph.test.ts's style of constructing minimal fixtures directly.
 *
 * Stage 2 TDD-bootstrap: originally written skipped against the stubbed
 * `extractNearCliques` (phase 2), now unskipped against the phase 3
 * implementation.
 *
 * Deliberately NOT tested here (per the plan, deferred to Stage 4): strict
 * subset suppression (a qualifying 2-node candidate being dropped because a
 * qualifying 3-node superset exists) — extraction only dedupes *exact*
 * node-set duplicates, never subsets. The last describe block below asserts
 * the opposite of subset suppression: every 2-clique must survive extraction
 * untouched even when it's also part of a larger candidate.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type Candidate,
  extractNearCliques,
  MAX_CLIQUE_COMPONENT_SIZE,
  MAX_CLIQUE_ENUMERATION_BUDGET
} from '../src/clique-extraction.js';
import type { GraphNode, WeightedGraph } from '../src/graph.js';
import type { Edge } from '../src/types.js';

/**
 * Builds a minimal `WeightedGraph` directly from a node count and a list of
 * `[nodeIdA, nodeIdB, weight]` edges — no anchors/signals needed, since
 * `extractNearCliques` only ever reads node ids, `edges`, `edgeBetween`, and
 * `weightBetween`.
 */
function makeGraph(nodeCount: number, edgeWeights: readonly [number, number, number][]): WeightedGraph {
  const nodes: GraphNode[] = Array.from({ length: nodeCount }, (_, id) => ({
    id,
    anchorsByEdge: new Map()
  }));

  function key(a: number, b: number): string {
    return a <= b ? `${a}:${b}` : `${b}:${a}`;
  }

  const edgeByKey = new Map<string, Edge>();
  const edges: Edge[] = [];
  for (const [a, b, weight] of edgeWeights) {
    const edge: Edge = { a: { path: `n${a}` }, b: { path: `n${b}` }, evidence: [], weight };
    edgeByKey.set(key(a, b), edge);
    edges.push(edge);
    // Real buildGraph populates anchorsByEdge for every neighbor with >=1
    // evidence entry, regardless of threshold — extraction reads these keys
    // to discover adjacency (see graph.ts's GraphNode doc comment), so the
    // fixture must mirror that shape even though the anchors themselves are
    // irrelevant to a pure-topology test.
    nodes[a].anchorsByEdge.set(b, []);
    nodes[b].anchorsByEdge.set(a, []);
  }

  return {
    nodes,
    edges,
    edgeBetween(a, b) {
      return edgeByKey.get(key(a, b));
    },
    weightBetween(a, b) {
      return edgeByKey.get(key(a, b))?.weight ?? 0.5;
    }
  };
}

/** Builds a complete graph over `nodeCount` nodes, every edge at `weight`. */
function makeCompleteGraph(nodeCount: number, weight: number): WeightedGraph {
  const edges: [number, number, number][] = [];
  for (let a = 0; a < nodeCount; a++) {
    for (let b = a + 1; b < nodeCount; b++) edges.push([a, b, weight]);
  }
  return makeGraph(nodeCount, edges);
}

function sortedNodeIds(candidate: Candidate): number[] {
  return [...candidate.nodeIds].sort((a, b) => a - b);
}

function findCandidate(candidates: readonly Candidate[], nodeIds: readonly number[]): Candidate[] {
  const wanted = [...nodeIds].sort((a, b) => a - b);
  return candidates.filter((c) => JSON.stringify(sortedNodeIds(c)) === JSON.stringify(wanted));
}

const ABOVE_THRESHOLD = 0.9; // Comfortably above EDGE_THRESHOLD (0.85).
const BELOW_THRESHOLD = 0.6; // Comfortably below it — not a graph edge at all.

describe('extractNearCliques', () => {
  describe('full (non-maximal) clique detection', () => {
    it('enumerates every clique of size >=2 in a complete graph, not only the maximal one', () => {
      const graph = makeCompleteGraph(4, ABOVE_THRESHOLD);
      const candidates = extractNearCliques(graph);

      // K4: C(4,2)=6 pairs + C(4,3)=4 triples + C(4,4)=1 quad = 11 cliques of size >=2.
      const zeroMissing = candidates.filter((c) => c.missingEdges === 0);
      expect(zeroMissing).toHaveLength(11);

      for (const nodeIds of [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3],
        [0, 1, 2],
        [0, 1, 3],
        [0, 2, 3],
        [1, 2, 3],
        [0, 1, 2, 3]
      ]) {
        expect(findCandidate(zeroMissing, nodeIds)).toHaveLength(1);
      }
    });

    it('does not treat maximal-clique-only enumeration as sufficient — every sub-clique is its own candidate', () => {
      // A plain triangle (0,1,2): the maximal clique is {0,1,2}, but {0,1},
      // {0,2}, {1,2} must each also appear as their own candidates.
      const graph = makeCompleteGraph(3, ABOVE_THRESHOLD);
      const candidates = extractNearCliques(graph);
      const zeroMissing = candidates.filter((c) => c.missingEdges === 0);

      expect(findCandidate(zeroMissing, [0, 1])).toHaveLength(1);
      expect(findCandidate(zeroMissing, [0, 2])).toHaveLength(1);
      expect(findCandidate(zeroMissing, [1, 2])).toHaveLength(1);
      expect(findCandidate(zeroMissing, [0, 1, 2])).toHaveLength(1);
    });
  });

  describe('the {A,B,C,X}-maximal-clique-hides-{A,B,C,D} regression', () => {
    // A=0, B=1, C=2, D=3, X=4.
    // Triangle A-B-C is complete. X extends {A,B,C} into a genuine maximal
    // 4-clique {A,B,C,X}. D connects to A and B only (not C, not X) — so
    // {A,B,C,D} is a valid near-clique missing exactly the C-D edge.
    // Maximal-clique-only enumeration would report only {A,B,C,X} and never
    // even emit {A,B,C} as its own candidate, so {A,B,C,D} could never be
    // formed by augmentation at all — this is the exact bug full enumeration
    // fixes.
    function buildScenarioGraph(): WeightedGraph {
      return makeGraph(5, [
        [0, 1, ABOVE_THRESHOLD], // A-B
        [0, 2, ABOVE_THRESHOLD], // A-C
        [1, 2, ABOVE_THRESHOLD], // B-C
        [0, 3, ABOVE_THRESHOLD], // A-D
        [1, 3, ABOVE_THRESHOLD], // B-D
        [0, 4, ABOVE_THRESHOLD], // A-X
        [1, 4, ABOVE_THRESHOLD], // B-X
        [2, 4, ABOVE_THRESHOLD] // C-X
        // C-D (2,3) and D-X (3,4) are absent — below threshold, no edge at all.
      ]);
    }

    it('emits the genuine maximal 4-clique {A,B,C,X}', () => {
      const candidates = extractNearCliques(buildScenarioGraph());
      const found = findCandidate(
        candidates.filter((c) => c.missingEdges === 0),
        [0, 1, 2, 4]
      );
      expect(found).toHaveLength(1);
    });

    it('still emits the non-maximal sub-clique {A,B,C} as its own candidate', () => {
      const candidates = extractNearCliques(buildScenarioGraph());
      const found = findCandidate(
        candidates.filter((c) => c.missingEdges === 0),
        [0, 1, 2]
      );
      expect(found).toHaveLength(1);
    });

    it('emits the near-clique {A,B,C,D} (missing only C-D), augmented from the {A,B,C} base clique', () => {
      const candidates = extractNearCliques(buildScenarioGraph());
      const found = findCandidate(
        candidates.filter((c) => c.missingEdges === 1),
        [0, 1, 2, 3]
      );
      expect(found).toHaveLength(1);
    });
  });

  describe('one-missing-edge augmentation', () => {
    it('augments a base clique with a node adjacent to all but one member', () => {
      // A-B present; A-C present; B-C absent. {A,B,C} is a valid near-clique
      // missing only B-C.
      const graph = makeGraph(3, [
        [0, 1, ABOVE_THRESHOLD],
        [0, 2, ABOVE_THRESHOLD]
      ]);
      const candidates = extractNearCliques(graph);
      const found = findCandidate(
        candidates.filter((c) => c.missingEdges === 1),
        [0, 1, 2]
      );
      expect(found).toHaveLength(1);
    });

    it('a plain 2-clique (single qualifying edge) has missingEdges = 0 by construction', () => {
      const graph = makeGraph(2, [[0, 1, ABOVE_THRESHOLD]]);
      const candidates = extractNearCliques(graph);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].missingEdges).toBe(0);
      expect(sortedNodeIds(candidates[0])).toEqual([0, 1]);
    });
  });

  describe('rejection of >1-missing-edge candidates', () => {
    it('does not augment a triangle with a node connected to only one of its three members', () => {
      // Triangle A-B-C complete; D connects only to A (not B, not C) — D is
      // adjacent to just 1 of 3 members, short of the k-1=2 required.
      const graph = makeGraph(4, [
        [0, 1, ABOVE_THRESHOLD],
        [0, 2, ABOVE_THRESHOLD],
        [1, 2, ABOVE_THRESHOLD],
        [0, 3, ABOVE_THRESHOLD]
      ]);
      const candidates = extractNearCliques(graph);
      expect(findCandidate(candidates, [0, 1, 2, 3])).toHaveLength(0);
    });

    it('never emits a candidate with more than one missing edge', () => {
      const graph = makeGraph(4, [
        [0, 1, ABOVE_THRESHOLD],
        [0, 2, ABOVE_THRESHOLD],
        [1, 2, ABOVE_THRESHOLD],
        [0, 3, ABOVE_THRESHOLD]
      ]);
      const candidates = extractNearCliques(graph);
      for (const c of candidates) expect(c.missingEdges).toBeLessThanOrEqual(1);
    });
  });

  describe('exact-duplicate node-set dedup', () => {
    it('dedupes the same final node-set reached via two different base sub-cliques, keeping the lower missingEdges', () => {
      // A full 4-clique {0,1,2,3}: every 3-subset is itself a genuine base
      // clique, and augmenting any of them with the 4th node (which is
      // adjacent to ALL 3, satisfying the ">= k-1" augmentation check too)
      // would naively produce a second, mislabeled missingEdges=1 copy of
      // the same node-set that full enumeration already found directly at
      // missingEdges=0. Exactly one entry must survive, at missingEdges=0.
      const graph = makeCompleteGraph(4, ABOVE_THRESHOLD);
      const candidates = extractNearCliques(graph);

      const matches = findCandidate(candidates, [0, 1, 2, 3]);
      expect(matches).toHaveLength(1);
      expect(matches[0].missingEdges).toBe(0);
    });

    it('never emits two candidates for the same node-set', () => {
      const graph = makeCompleteGraph(5, ABOVE_THRESHOLD);
      const candidates = extractNearCliques(graph);

      const seen = new Set<string>();
      for (const c of candidates) {
        const key = JSON.stringify(sortedNodeIds(c));
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('MAX_CLIQUE_COMPONENT_SIZE skip-and-log path', () => {
    it('skips near-clique search on an oversized component, logging to stderr, but still emits its 2-node edges', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const nodeCount = MAX_CLIQUE_COMPONENT_SIZE + 1;
        // A path graph (0-1-2-...-n): a connected component of exactly
        // nodeCount nodes, cheap to build/enumerate, so this test only
        // exercises the size guard, not enumeration cost.
        const edges: [number, number, number][] = [];
        for (let i = 0; i < nodeCount - 1; i++) edges.push([i, i + 1, ABOVE_THRESHOLD]);
        const graph = makeGraph(nodeCount, edges);

        const candidates = extractNearCliques(graph);

        // No 3+-node candidate should come from this component.
        expect(candidates.every((c) => c.nodeIds.length <= 2)).toBe(true);
        // Every qualifying edge still surfaces as its own 2-node candidate
        // (the fail-closed fallback — the component's edges still flow
        // through the 2-node path untouched).
        expect(candidates).toHaveLength(nodeCount - 1);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('MAX_CLIQUE_ENUMERATION_BUDGET runtime guard', () => {
    it('abandons and logs a dense sub-MAX_CLIQUE_COMPONENT_SIZE component that trips the enumeration budget mid-search, rather than hanging', () => {
      // Smallest complete-graph node count whose total clique count
      // (2^n - n - 1, cliques of size >=2) exceeds the budget, while still
      // staying under the component-size cap — guarantees this trips the
      // budget guard specifically (not the size guard) regardless of the
      // budget's exact spiked value.
      let n = 3;
      while (2 ** n - n - 1 <= MAX_CLIQUE_ENUMERATION_BUDGET) n++;
      expect(n).toBeLessThan(MAX_CLIQUE_COMPONENT_SIZE);

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const graph = makeCompleteGraph(n, ABOVE_THRESHOLD);

        const start = Date.now();
        const candidates = extractNearCliques(graph);
        const elapsedMs = Date.now() - start;

        // Abandoned, not hung: completes quickly and reports none of the
        // component's n-ary candidates.
        expect(elapsedMs).toBeLessThan(10_000);
        expect(candidates.every((c) => c.nodeIds.length <= 2)).toBe(true);
        // The component's qualifying edges still fall back to 2-node candidates.
        expect(candidates).toHaveLength((n * (n - 1)) / 2);
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('determinism under shuffled input', () => {
    it('produces the same candidate set regardless of the edges array order', () => {
      const scenarioEdges: [number, number, number][] = [
        [0, 1, ABOVE_THRESHOLD],
        [0, 2, ABOVE_THRESHOLD],
        [1, 2, ABOVE_THRESHOLD],
        [0, 3, ABOVE_THRESHOLD],
        [1, 3, ABOVE_THRESHOLD],
        [0, 4, ABOVE_THRESHOLD],
        [1, 4, ABOVE_THRESHOLD],
        [2, 4, ABOVE_THRESHOLD]
      ];

      const graphA = makeGraph(5, scenarioEdges);
      const graphB = makeGraph(5, [...scenarioEdges].reverse());
      const graphC = makeGraph(
        5,
        [...scenarioEdges].sort(() => 0.5 - Math.random())
      );

      function canonical(candidates: readonly Candidate[]): string[] {
        return candidates.map((c) => `${sortedNodeIds(c).join(',')}|${c.missingEdges}`).sort();
      }

      const canonicalA = canonical(extractNearCliques(graphA));
      expect(canonical(extractNearCliques(graphB))).toEqual(canonicalA);
      expect(canonical(extractNearCliques(graphC))).toEqual(canonicalA);
    });
  });

  describe('no subset pruning — every size-2 clique is its own candidate', () => {
    it('emits every qualifying edge as its own 2-node candidate alongside any larger candidate containing it', () => {
      // Full K4: every one of its 6 edges must appear as its own 2-node
      // candidate, even though every one of them is also contained in the
      // full 4-clique candidate. Extraction must not suppress the subset —
      // that is explicitly deferred to Stage 4.
      const graph = makeCompleteGraph(4, ABOVE_THRESHOLD);
      const candidates = extractNearCliques(graph);

      for (const pair of [
        [0, 1],
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
        [2, 3]
      ]) {
        expect(findCandidate(candidates, pair)).toHaveLength(1);
      }
      // ...and the full 4-clique is present too — subsets and superset coexist.
      expect(findCandidate(candidates, [0, 1, 2, 3])).toHaveLength(1);
    });

    it('emits a near-clique subset edge as its own candidate even though it also participates in the larger near-clique', () => {
      // From the {A,B,C,D} augmentation scenario above: the A-D and B-D
      // edges (each a qualifying 2-node candidate on their own) must each
      // still be reported individually, in addition to the {A,B,C,D}
      // near-clique they also belong to.
      const graph = makeGraph(5, [
        [0, 1, ABOVE_THRESHOLD],
        [0, 2, ABOVE_THRESHOLD],
        [1, 2, ABOVE_THRESHOLD],
        [0, 3, ABOVE_THRESHOLD],
        [1, 3, ABOVE_THRESHOLD],
        [0, 4, ABOVE_THRESHOLD],
        [1, 4, ABOVE_THRESHOLD],
        [2, 4, ABOVE_THRESHOLD]
      ]);
      const candidates = extractNearCliques(graph);

      expect(findCandidate(candidates, [0, 3])).toHaveLength(1); // A-D
      expect(findCandidate(candidates, [1, 3])).toHaveLength(1); // B-D
      expect(
        findCandidate(
          candidates.filter((c) => c.missingEdges === 1),
          [0, 1, 2, 3]
        )
      ).toHaveLength(1);
    });
  });

  describe('edges below EDGE_THRESHOLD never participate in topology', () => {
    it('does not treat a sub-threshold edge as present when forming candidates', () => {
      const graph = makeGraph(3, [
        [0, 1, ABOVE_THRESHOLD],
        [0, 2, BELOW_THRESHOLD] // Present in the graph, but not thresholded.
      ]);
      const candidates = extractNearCliques(graph);

      // Only the one qualifying edge {0,1} — {0,2} never clears the
      // threshold, so no candidate should include node 2 at all.
      expect(candidates.every((c) => !sortedNodeIds(c).includes(2))).toBe(true);
      expect(findCandidate(candidates, [0, 1])).toHaveLength(1);
    });
  });
});
