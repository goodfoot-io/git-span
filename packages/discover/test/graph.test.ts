/**
 * Tests for src/graph.ts — weighted graph construction (near-clique grouping
 * plan, "Graph construction" and "Node-anchor reporting gap (and fix)").
 *
 * Pure over `AnchorGroup[]`; no git needed — mirrors grouping.test.ts's style.
 *
 * Stage 1 TDD-bootstrap phase 2: these are written against the stubbed
 * `buildGraph` (returns an empty graph) and are skipped until phase 3
 * implements the real thing.
 */

import { describe, expect, it } from 'vitest';
import { buildGraph, nodeIdForAnchor } from '../src/graph.js';
import { scoreEvidence } from '../src/scoring.js';
import type { AnchorGroup } from '../src/types.js';

function group(anchors: AnchorGroup['anchors'], evidence: AnchorGroup['evidence']): AnchorGroup {
  return { anchors, evidence, score: 0 };
}

describe('buildGraph', () => {
  it('fuses a whole-file anchor and a range anchor on the same path into one node', () => {
    const wholeFilePair = group([{ path: 'a.ts' }, { path: 'b.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const rangedPair = group(
      [{ path: 'a.ts', startLine: 10, endLine: 20 }, { path: 'c.ts' }],
      [{ signal: 'lexical-similarity', strength: 0.5 }]
    );

    const graph = buildGraph([wholeFilePair, rangedPair]);

    const wholeFileNodeId = nodeIdForAnchor(graph, { path: 'a.ts' });
    const rangedNodeId = nodeIdForAnchor(graph, { path: 'a.ts', startLine: 10, endLine: 20 });

    expect(wholeFileNodeId).toBeDefined();
    expect(rangedNodeId).toBe(wholeFileNodeId);

    // a.ts (fused), b.ts, c.ts — three distinct nodes.
    expect(graph.nodes).toHaveLength(3);
  });

  it('never fuses anchors across different paths', () => {
    const g = group([{ path: 'a.ts' }, { path: 'b.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const graph = buildGraph([g]);

    const aId = nodeIdForAnchor(graph, { path: 'a.ts' });
    const bId = nodeIdForAnchor(graph, { path: 'b.ts' });
    expect(aId).toBeDefined();
    expect(bId).toBeDefined();
    expect(aId).not.toBe(bId);
  });

  it('does not leak one edge’s anchors into a hub node’s other, unrelated edge (node-anchor reporting fix)', () => {
    // hub.ts (whole-file) <-> p.ts, from association-rules.
    const hubToP = group([{ path: 'hub.ts' }, { path: 'p.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    // hub.ts#L1-5 (range) <-> q.ts, from an unrelated signal/coupling. The
    // range anchor fuses with the whole-file anchor above (global per-path
    // fusion), but the two couplings (hub-P, hub-Q) are otherwise unrelated.
    const hubToQ = group(
      [{ path: 'hub.ts', startLine: 1, endLine: 5 }, { path: 'q.ts' }],
      [{ signal: 'lexical-similarity', strength: 0.5 }]
    );

    const graph = buildGraph([hubToP, hubToQ]);

    const hubId = nodeIdForAnchor(graph, { path: 'hub.ts' });
    const pId = nodeIdForAnchor(graph, { path: 'p.ts' });
    const qId = nodeIdForAnchor(graph, { path: 'q.ts' });
    expect(hubId).toBeDefined();
    expect(pId).toBeDefined();
    expect(qId).toBeDefined();

    const hubNode = graph.nodes.find((n) => n.id === hubId);
    expect(hubNode).toBeDefined();

    // hub's contribution to the hub-P edge is only the whole-file anchor —
    // the unrelated hub-Q range anchor must not leak in.
    const hubAnchorsTowardP = hubNode!.anchorsByEdge.get(pId!);
    expect(hubAnchorsTowardP).toEqual([{ path: 'hub.ts' }]);

    // hub's contribution to the hub-Q edge is only the range anchor — the
    // unrelated hub-P whole-file anchor must not leak in.
    const hubAnchorsTowardQ = hubNode!.anchorsByEdge.get(qId!);
    expect(hubAnchorsTowardQ).toEqual([{ path: 'hub.ts', startLine: 1, endLine: 5 }]);
  });

  it('pools evidence from multiple signals for the same node pair into one edge', () => {
    const fromAssociationRules = group(
      [{ path: 'x.ts' }, { path: 'y.ts' }],
      [{ signal: 'association-rules', strength: 0.9 }]
    );
    const fromLexicalSimilarity = group(
      [{ path: 'x.ts' }, { path: 'y.ts' }],
      [{ signal: 'lexical-similarity', strength: 0.6 }]
    );

    const graph = buildGraph([fromAssociationRules, fromLexicalSimilarity]);

    const xId = nodeIdForAnchor(graph, { path: 'x.ts' });
    const yId = nodeIdForAnchor(graph, { path: 'y.ts' });
    const edge = graph.edgeBetween(xId!, yId!);

    expect(edge).toBeDefined();
    expect(edge!.evidence).toHaveLength(2);
    expect(edge!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signal: 'association-rules', strength: 0.9 }),
        expect.objectContaining({ signal: 'lexical-similarity', strength: 0.6 })
      ])
    );
  });

  it('computes edge weight via the existing scoreEvidence, over exactly that edge’s pooled evidence', () => {
    const g1 = group([{ path: 'x.ts' }, { path: 'y.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const g2 = group([{ path: 'x.ts' }, { path: 'y.ts' }], [{ signal: 'lexical-similarity', strength: 0.6 }]);

    const graph = buildGraph([g1, g2]);
    const xId = nodeIdForAnchor(graph, { path: 'x.ts' });
    const yId = nodeIdForAnchor(graph, { path: 'y.ts' });
    const edge = graph.edgeBetween(xId!, yId!);

    expect(edge!.weight).toBe(scoreEvidence(edge!.evidence));
  });

  it('only materializes edges for node pairs with at least one evidence entry', () => {
    const g1 = group([{ path: 'x.ts' }, { path: 'y.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const g2 = group([{ path: 'y.ts' }, { path: 'z.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);

    const graph = buildGraph([g1, g2]);
    const xId = nodeIdForAnchor(graph, { path: 'x.ts' })!;
    const zId = nodeIdForAnchor(graph, { path: 'z.ts' })!;

    // x-z never co-occurred in any signal's evidence — no materialized edge.
    expect(graph.edgeBetween(xId, zId)).toBeUndefined();
    expect(graph.edges).toHaveLength(2);
  });

  it('falls back to the neutral scoreEvidence([]) = 0.5 for a node pair with no bucketed evidence at all', () => {
    const g1 = group([{ path: 'x.ts' }, { path: 'y.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const g2 = group([{ path: 'y.ts' }, { path: 'z.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);

    const graph = buildGraph([g1, g2]);
    const xId = nodeIdForAnchor(graph, { path: 'x.ts' })!;
    const zId = nodeIdForAnchor(graph, { path: 'z.ts' })!;

    expect(graph.weightBetween(xId, zId)).toBe(scoreEvidence([]));
    expect(graph.weightBetween(xId, zId)).toBe(0.5);
  });

  it('weightBetween returns the materialized edge weight when one exists', () => {
    const g1 = group([{ path: 'x.ts' }, { path: 'y.ts' }], [{ signal: 'association-rules', strength: 0.9 }]);
    const graph = buildGraph([g1]);
    const xId = nodeIdForAnchor(graph, { path: 'x.ts' })!;
    const yId = nodeIdForAnchor(graph, { path: 'y.ts' })!;

    expect(graph.weightBetween(xId, yId)).toBe(graph.edgeBetween(xId, yId)!.weight);
  });
});
