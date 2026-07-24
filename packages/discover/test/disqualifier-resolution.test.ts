/**
 * Tests for src/disqualifier-resolution.ts — per-edge disqualifier
 * suppression (near-clique grouping plan, "Disqualifier semantics — per-edge
 * suppression, not group-wide floor accumulation").
 *
 * Pure over a synthetic `WeightedGraph`, mirroring clique-extraction.test.ts's
 * style of constructing minimal fixtures directly rather than routing
 * through real signals/disqualifiers/anchors (which is Stage 4's wiring
 * concern, not this module's).
 */

import { describe, expect, it, vi } from 'vitest';
import { edgeKey, resolveCandidate } from '../src/disqualifier-resolution.js';
import type { GraphNode, WeightedGraph } from '../src/graph.js';
import { scoreEvidence } from '../src/scoring.js';
import type { DisqualifierEvidence, Edge, SignalEvidence } from '../src/types.js';

/** Strong, real signal evidence whose `scoreEvidence` clears EDGE_THRESHOLD (0.85) comfortably on its own. */
const STRONG_SIGNAL: SignalEvidence[] = [{ signal: 'association-rules', strength: 1 }];

/** Real disqualifier evidence strong enough that `scoreEvidence(STRONG_SIGNAL, FIRING_DISQUALIFIER)` drops below EDGE_THRESHOLD. */
const FIRING_DISQUALIFIER: DisqualifierEvidence[] = [{ disqualifier: 'tree-sitter-reference', strength: 1 }];

/** Confirms the two fixtures above actually straddle EDGE_THRESHOLD the way every test below assumes. */
const STRONG_WEIGHT = scoreEvidence(STRONG_SIGNAL);
const DISQUALIFIED_WEIGHT = scoreEvidence(STRONG_SIGNAL, FIRING_DISQUALIFIER);

/** Builds a minimal `WeightedGraph` directly from a node count and a list of `[nodeIdA, nodeIdB, evidence]` edges. */
function makeGraph(nodeCount: number, edgeSpecs: readonly [number, number, SignalEvidence[]][]): WeightedGraph {
  const nodes: GraphNode[] = Array.from({ length: nodeCount }, (_, id) => ({ id, anchorsByEdge: new Map() }));

  function key(a: number, b: number): string {
    return a <= b ? `${a}:${b}` : `${b}:${a}`;
  }

  const edgeByKey = new Map<string, Edge>();
  const edges: Edge[] = [];
  for (const [a, b, evidence] of edgeSpecs) {
    const edge: Edge = { a: { path: `n${a}` }, b: { path: `n${b}` }, evidence, weight: scoreEvidence(evidence) };
    edgeByKey.set(key(a, b), edge);
    edges.push(edge);
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
      return edgeByKey.get(key(a, b))?.weight ?? scoreEvidence([]);
    }
  };
}

describe('disqualifier-resolution fixtures', () => {
  it('the strong-signal / firing-disqualifier fixtures actually straddle EDGE_THRESHOLD (0.85)', () => {
    expect(STRONG_WEIGHT).toBeGreaterThanOrEqual(0.85);
    expect(DISQUALIFIED_WEIGHT).toBeLessThan(0.85);
  });
});

describe('edgeKey', () => {
  it('is order-independent', () => {
    expect(edgeKey(1, 2)).toBe(edgeKey(2, 1));
    expect(edgeKey(1, 2)).not.toBe(edgeKey(1, 3));
  });
});

describe('resolveCandidate — 3+-node candidates', () => {
  it('a full 3-clique with no firing disqualifier survives with missingEdges=0', () => {
    const graph = makeGraph(3, [
      [0, 1, STRONG_SIGNAL],
      [0, 2, STRONG_SIGNAL],
      [1, 2, STRONG_SIGNAL]
    ]);
    const noEvidence = () => [];

    const resolved = resolveCandidate(graph, { nodeIds: [0, 1, 2] }, noEvidence);

    expect(resolved).not.toBeNull();
    expect(resolved!.missingEdges).toBe(0);
    expect(resolved!.score).toBeGreaterThanOrEqual(0.85);
  });

  it('a disqualified edge converts to a missing edge, not a score subtraction', () => {
    const graph = makeGraph(3, [
      [0, 1, STRONG_SIGNAL],
      [0, 2, STRONG_SIGNAL],
      [1, 2, STRONG_SIGNAL]
    ]);

    const disqualifierEvidenceFor = vi.fn((a: number, b: number): readonly DisqualifierEvidence[] => {
      // Only the (1, 2) edge is disqualified.
      if (edgeKey(a, b) === edgeKey(1, 2)) return FIRING_DISQUALIFIER;
      return [];
    });

    const resolved = resolveCandidate(graph, { nodeIds: [0, 1, 2] }, disqualifierEvidenceFor);

    expect(resolved).not.toBeNull();
    // Structural demotion: one more missing edge, exactly like a topological gap.
    expect(resolved!.missingEdges).toBe(1);
    // NOT a score subtraction: the gap's contribution to `score` is its raw
    // (pre-disqualifier) weight, not the suppressed post-disqualifier value —
    // the missingEdges increment is what carries the disqualifier's effect,
    // not the score.
    expect(resolved!.score).toBeGreaterThanOrEqual(0.85);
    expect(resolved!.score).not.toBeCloseTo(DISQUALIFIED_WEIGHT, 2);
  });

  it('a candidate whose disqualified-edge count pushes missingEdges past 1 is dropped', () => {
    const graph = makeGraph(3, [
      [0, 1, STRONG_SIGNAL],
      [0, 2, STRONG_SIGNAL],
      [1, 2, STRONG_SIGNAL]
    ]);

    // Both (0, 2) and (1, 2) fire — two independent gaps, over the k-1-of-k
    // budget for a 3-node candidate (budget = 1).
    const disqualifierEvidenceFor = (a: number, b: number): readonly DisqualifierEvidence[] => {
      const k = edgeKey(a, b);
      if (k === edgeKey(0, 2) || k === edgeKey(1, 2)) return FIRING_DISQUALIFIER;
      return [];
    };

    const resolved = resolveCandidate(graph, { nodeIds: [0, 1, 2] }, disqualifierEvidenceFor);

    expect(resolved).toBeNull();
  });

  it('a pre-existing topological gap plus one newly-disqualified edge together exceed the budget and drop the candidate', () => {
    // (1, 2) never cleared EDGE_THRESHOLD to begin with (weak evidence) —
    // already a topological gap from extraction. (0, 1) is strong but gets
    // disqualified in this pass. Two independent gaps total.
    const weakSignal: SignalEvidence[] = [{ signal: 'time-window-co-edit', strength: 0.1 }];
    const graph = makeGraph(3, [
      [0, 1, STRONG_SIGNAL],
      [0, 2, STRONG_SIGNAL],
      [1, 2, weakSignal]
    ]);
    expect(graph.edgeBetween(1, 2)!.weight).toBeLessThan(0.85);

    const disqualifierEvidenceFor = (a: number, b: number): readonly DisqualifierEvidence[] =>
      edgeKey(a, b) === edgeKey(0, 1) ? FIRING_DISQUALIFIER : [];

    const resolved = resolveCandidate(graph, { nodeIds: [0, 1, 2] }, disqualifierEvidenceFor);

    expect(resolved).toBeNull();
  });

  it('a 4-node candidate with one disqualified edge scores as the minimum of its surviving present edges', () => {
    const graph = makeGraph(4, [
      [0, 1, STRONG_SIGNAL],
      [0, 2, STRONG_SIGNAL],
      [0, 3, STRONG_SIGNAL],
      [1, 2, STRONG_SIGNAL],
      [1, 3, STRONG_SIGNAL],
      [2, 3, STRONG_SIGNAL]
    ]);

    const disqualifierEvidenceFor = (a: number, b: number): readonly DisqualifierEvidence[] =>
      edgeKey(a, b) === edgeKey(2, 3) ? FIRING_DISQUALIFIER : [];

    const resolved = resolveCandidate(graph, { nodeIds: [0, 1, 2, 3] }, disqualifierEvidenceFor);

    expect(resolved).not.toBeNull();
    expect(resolved!.missingEdges).toBe(1);
    // 5 surviving present edges, all at STRONG_WEIGHT, plus the (2,3) gap's
    // raw weight (also STRONG_WEIGHT, since raw weight ignores the
    // disqualifier) — score is their minimum, which here is STRONG_WEIGHT.
    expect(resolved!.score).toBeCloseTo(STRONG_WEIGHT, 5);
  });
});

describe('resolveCandidate — 2-node bypass (regression)', () => {
  it('never enters the missing-edge/min-edge-weight path even when the single edge would be disqualified below EDGE_THRESHOLD', () => {
    const graph = makeGraph(2, [[0, 1, STRONG_SIGNAL]]);
    const disqualifierEvidenceFor = vi.fn((): readonly DisqualifierEvidence[] => FIRING_DISQUALIFIER);

    const resolved = resolveCandidate(graph, { nodeIds: [0, 1] }, disqualifierEvidenceFor);

    expect(resolved).not.toBeNull();
    // Bypassed entirely: missingEdges stays 0 (this shape is never converted
    // to a missing-edge candidate), and the disqualifier lookup is never
    // even consulted — a firing disqualifier on a 2-node candidate's one
    // edge must be handled by the caller's PASS1/PASS2 dual gate (Stage 4),
    // never by this module's removal machinery.
    expect(resolved!.missingEdges).toBe(0);
    expect(disqualifierEvidenceFor).not.toHaveBeenCalled();
    // The bypass must not silently substitute the suppressed post-disqualifier
    // weight either — score reflects the raw (pre-disqualifier) edge weight,
    // exactly the fixture's own construction, and the caller (not this
    // module) is responsible for computing the true PASS1/PASS2 blend.
    expect(resolved!.score).toBeCloseTo(STRONG_WEIGHT, 5);
  });
});
