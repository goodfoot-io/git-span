/**
 * Per-edge disqualifier resolution (near-clique grouping plan, "Disqualifier
 * semantics — per-edge suppression, not group-wide floor accumulation").
 *
 * `scoreEvidence` sums *every* disqualifier entry it's given with no
 * collapsing, unlike signal evidence (`strongestPerSignal`). Naively pooling
 * every internal edge's disqualifier verdicts (including non-firing floor
 * entries — never exactly 0 by design) into one `scoreEvidence` call for a
 * whole candidate would drag its score down in proportion to edge count, the
 * opposite of the card's intent, and let an incidental floor entry on one
 * unrelated edge sink an otherwise-genuine large clique. This module fixes
 * that: disqualifiers decide **per-edge survival**, never a group-wide score
 * subtraction — an edge whose post-disqualifier weight drops below
 * `EDGE_THRESHOLD` is treated as one more missing edge (a structural
 * demotion, exactly like a topological gap), not a continuous penalty.
 *
 * Scoped to 3+-node candidates only (adopted from `plans/planner-2.md`
 * commit `6bf8c76`): a 2-node/0-missing-edge candidate never enters this
 * machinery — see `resolveCandidate`'s explicit bypass below. Wiring this
 * into `cli.ts`'s pipeline (both the 2-node `PASS1`/`PASS2` dual gate and the
 * 3+-node call site) is Stage 4's concern; this module only implements the
 * resolution function itself.
 */

import type { WeightedGraph } from './graph.js';
import { EDGE_THRESHOLD, scoreEvidence } from './scoring.js';
import type { DisqualifierEvidence } from './types.js';

/**
 * The subset of `clique-extraction.ts`'s `Candidate` this module needs —
 * declared structurally here (rather than importing the concrete type) so
 * this module only depends on the shape it actually reads.
 */
export interface CandidateLike {
  readonly nodeIds: readonly number[];
}

/** The result of resolving a candidate's internal edges against per-edge disqualifier evidence. */
export interface ResolvedCandidate {
  nodeIds: readonly number[];
  /** Topological gaps plus edges disqualified below `EDGE_THRESHOLD` in this pass. */
  missingEdges: number;
  /**
   * The minimum weight across the candidate's still-relevant pairs: every
   * surviving present edge's post-disqualifier weight, plus — when
   * `missingEdges === 1` — that one gap pair's own raw weight (never
   * post-disqualifier, per the plan's step 4: the structural demotion to
   * "missing" is the suppression mechanism, so re-penalizing its score on
   * top of that would double-count the same disqualifier hit).
   */
  score: number;
}

/** Canonical unordered key for a node-id pair — mirrors `graph.ts`'s internal `pairKey` (not exported there), given a distinct name here since callers key their disqualifier-evidence lookup by it. */
export function edgeKey(nodeIdA: number, nodeIdB: number): string {
  return nodeIdA <= nodeIdB ? `${nodeIdA}:${nodeIdB}` : `${nodeIdB}:${nodeIdA}`;
}

function allPairs(nodeIds: readonly number[]): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) pairs.push([nodeIds[i], nodeIds[j]]);
  }
  return pairs;
}

/**
 * Resolves one candidate's internal edges against per-edge disqualifier
 * evidence, per the plan's "Disqualifier semantics" steps 1-4.
 *
 * **2-node candidates are bypassed entirely** — an explicit early return
 * before any of steps 1-4 run. This exists to close a real bug: routing a
 * 2-node candidate's one edge through the `EDGE_THRESHOLD` removal check
 * (step 2) could flip a firing disqualifier's edge to "missing", and step
 * 4's near-clique scoring would then substitute the gap's *raw*
 * pre-disqualifier weight for the true post-disqualifier score — silently
 * discarding the disqualifier's floor entirely, the opposite of suppression.
 * A 2-node candidate is instead routed by the caller (Stage 4) through the
 * literal `PASS1_THRESHOLD`/`PASS2_THRESHOLD` dual gate, which computes
 * `scoreEvidence(edge.evidence, edge.disqualifierEvidence)` directly without
 * ever passing through this removal machinery.
 *
 * For a 3+-node candidate: each internal pair currently present in the
 * graph's thresholded topology (an `Edge` exists with `weight >=
 * EDGE_THRESHOLD`) has its post-disqualifier weight recomputed as
 * `scoreEvidence(edge.evidence, disqualifierEvidenceFor(a, b))`. If that
 * drops below `EDGE_THRESHOLD`, the pair is reclassified as missing. Every
 * other pair (never cleared `EDGE_THRESHOLD` topologically to begin with) is
 * already missing. If the recomputed `missingEdges` total exceeds the
 * k-1-of-k budget (>1), the candidate is dropped (`null`) — a principled
 * discard from *too many* independent gaps, not from a single incidental
 * disqualifier match.
 *
 * `disqualifierEvidenceFor(nodeIdA, nodeIdB)` supplies every disqualifier's
 * verdicts for that specific pair — the caller (Stage 4) is responsible for
 * running the disqualifier modules against the candidate's anchors and
 * bucketing their `edge`-tagged results back to node-id pairs (e.g. via
 * `nodeIdForAnchor`).
 */
export function resolveCandidate(
  graph: WeightedGraph,
  candidate: CandidateLike,
  disqualifierEvidenceFor: (nodeIdA: number, nodeIdB: number) => readonly DisqualifierEvidence[]
): ResolvedCandidate | null {
  const { nodeIds } = candidate;

  // 2-node candidates never enter the missing-edge/min-edge-weight machinery
  // at all — see the module-level doc comment and the plan's explicit
  // scoping. The caller routes these through the literal PASS1/PASS2 dual
  // gate instead (Stage 4).
  if (nodeIds.length < 3) {
    let score = 1;
    if (nodeIds.length === 2) {
      const edge = graph.edgeBetween(nodeIds[0], nodeIds[1]);
      score = edge?.weight ?? graph.weightBetween(nodeIds[0], nodeIds[1]);
    }
    return { nodeIds, missingEdges: 0, score };
  }

  const presentWeights: number[] = [];
  const gapPairs: Array<readonly [number, number]> = [];

  for (const [a, b] of allPairs(nodeIds)) {
    const edge = graph.edgeBetween(a, b);
    if (edge && edge.weight >= EDGE_THRESHOLD) {
      const disqualifierEvidence = disqualifierEvidenceFor(a, b);
      const postDisqualifierWeight = scoreEvidence(edge.evidence, disqualifierEvidence);
      if (postDisqualifierWeight >= EDGE_THRESHOLD) {
        presentWeights.push(postDisqualifierWeight);
      } else {
        // Disqualified below threshold: one more missing edge, not a score
        // subtraction — the structural demotion below is the entire
        // suppression mechanism for this edge.
        gapPairs.push([a, b]);
      }
    } else {
      // Never cleared EDGE_THRESHOLD topologically to begin with.
      gapPairs.push([a, b]);
    }
  }

  const missingEdges = gapPairs.length;
  if (missingEdges > 1) return null;

  const score =
    missingEdges === 0
      ? Math.min(...presentWeights)
      : Math.min(...presentWeights, graph.weightBetween(gapPairs[0][0], gapPairs[0][1]));

  return { nodeIds, missingEdges, score };
}
