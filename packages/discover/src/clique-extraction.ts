/**
 * Near-clique extraction over the weighted graph (near-clique grouping plan,
 * "Near-clique extraction (new `clique-extraction.ts`, replaces
 * `grouping.ts`'s merge role)").
 *
 * Extracts every clique of size >=2 per connected component of the
 * `EDGE_THRESHOLD`-thresholded graph (not only maximal ones — see the
 * module-level regression this guards against below), then augments each
 * found clique with any node adjacent to at least k-1 of its k members,
 * forming a one-missing-edge near-clique candidate. Two independent guards
 * bound the exponential worst case (component-size pre-filter, and a
 * runtime clique-count budget — a size cap alone does not bound clique
 * count, see MAX_CLIQUE_ENUMERATION_BUDGET below) per the plan's fail-closed
 * requirement: a guarded component's qualifying edges still surface as their
 * own 2-node candidates, only n-ary search over that one component is ever
 * skipped.
 *
 * Subset suppression is explicitly NOT performed here — see the plan's
 * "Subset suppression must run after scoring, not during extraction". Only
 * exact-duplicate node-sets (the same final set reachable via more than one
 * base sub-clique) are deduped, keeping the entry with fewer `missingEdges`,
 * then higher `score` as tiebreak.
 */

import type { WeightedGraph } from './graph.js';

/**
 * Governs which edges participate in the clique search's topology (plan
 * "Near-clique extraction" step 1). Duplicated locally rather than imported
 * from `scoring.ts` — Stage 4 centralizes this constant there alongside
 * `reportThreshold`; Stage 2's file ownership is scoped to this module only.
 */
const EDGE_THRESHOLD = 0.85;

/**
 * Connected components larger than this are logged to stderr and skipped
 * outright before enumeration starts — a component this large can never be
 * fully enumerated in reasonable time regardless of density.
 *
 * Value set by the Testable Uncertainty 3 spike
 * (`spike/bron-kerbosch-worst-case/finding.md` in the card repo): the real
 * repo's thresholded graph has exactly one oversized component (756 nodes,
 * built around genuine hub files), and its next-largest component is only 10
 * nodes — there is no dense sub-50 component in real data that a lower cap
 * would be needed to catch, so the plan's suggested starting point of 50 is
 * confirmed as-is.
 */
export const MAX_CLIQUE_COMPONENT_SIZE = 50;

/**
 * A running count of cliques (size >=2) enumerated *per component*; if
 * enumeration passes this ceiling before finishing, the component is
 * abandoned mid-search, logged, and treated exactly like a size-guard skip.
 * This is what actually bounds the exponential case — a size cap alone does
 * not bound clique count (a dense 35-45 node component can already yield
 * 2^35-2^45 cliques while sitting entirely under a 50-node cap).
 *
 * Value set by the Testable Uncertainty 3 spike: the densest real component
 * observed produces only 122 cliques, so 50,000 leaves ~400x headroom for
 * organic growth, while the spike's measured enumeration rate (~6,200
 * cliques/ms on the real 756-node hub component) shows a genuinely
 * pathological sub-50-node component would blow past this budget within
 * single-digit milliseconds, not hang.
 */
export const MAX_CLIQUE_ENUMERATION_BUDGET = 50_000;

/**
 * One extracted candidate: a node-set (by graph node id) plus how many of
 * its internal pairs are missing relative to a full clique (0 for a plain
 * clique, at most 1 for a near-clique — the plan's k−1-of-k tolerance).
 *
 * `score` is the candidate's own minimum internal-pair weight (present
 * edges' weight, or — for the one permitted gap in a near-clique — that
 * gap's raw `weightBetween` lookup). This is used only for deterministic
 * tie-breaking when exact-duplicate node-sets are deduped (step 5 of the
 * plan's extraction section) — it is NOT the final report gate, which is a
 * Stage 4 concern (disqualifier resolution + `reportThreshold`).
 */
export interface Candidate {
  /** Node ids in this candidate, sorted ascending for a stable identity. */
  nodeIds: readonly number[];
  missingEdges: number;
  score: number;
}

function candidateKey(nodeIds: readonly number[]): string {
  return [...nodeIds].sort((a, b) => a - b).join(',');
}

/** The minimum internal-pair weight across every pair in `nodeIds` — present edges via `weightBetween`, which also covers a near-clique's one gap. */
function minPairWeight(graph: WeightedGraph, nodeIds: readonly number[]): number {
  let min = Infinity;
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const weight = graph.weightBetween(nodeIds[i], nodeIds[j]);
      if (weight < min) min = weight;
    }
  }
  return min === Infinity ? 1 : min;
}

/**
 * Extracts every clique (size ≥2, not only maximal ones) and every
 * one-missing-edge near-clique augmentation from `graph`'s
 * `EDGE_THRESHOLD`-thresholded topology, per connected component.
 *
 * Exact-duplicate node-sets (the same final node-set reachable via more than
 * one base sub-clique) are deduped, keeping the entry with fewer
 * `missingEdges`, then higher `score` as tiebreak. Strict-subset suppression
 * is explicitly NOT performed here — see the plan's "Subset suppression
 * must run after scoring, not during extraction"; that is a Stage 4 concern
 * once every candidate has been independently scored and gated.
 *
 * A connected component larger than `MAX_CLIQUE_COMPONENT_SIZE`, or whose
 * enumeration exceeds `MAX_CLIQUE_ENUMERATION_BUDGET` cliques mid-search, is
 * logged to stderr and its n-ary search abandoned — its qualifying edges
 * still surface as their own 2-node candidates (the fail-closed fallback;
 * see the plan's guard section), just without any 3+-node candidates from
 * that component.
 */
export function extractNearCliques(graph: WeightedGraph): Candidate[] {
  // Thresholded adjacency, built directly from each node's `anchorsByEdge`
  // keys (already scoped to node pairs with >=1 evidence entry) plus
  // `edgeBetween`'s weight — O(total edges), not an O(n^2) all-pairs scan.
  const adjacency = new Map<number, Set<number>>();
  for (const node of graph.nodes) adjacency.set(node.id, new Set());
  for (const node of graph.nodes) {
    for (const neighborId of node.anchorsByEdge.keys()) {
      if (adjacency.get(node.id)!.has(neighborId)) continue;
      const edge = graph.edgeBetween(node.id, neighborId);
      if (edge && edge.weight >= EDGE_THRESHOLD) {
        adjacency.get(node.id)!.add(neighborId);
        adjacency.get(neighborId)!.add(node.id);
      }
    }
  }

  const candidatesByKey = new Map<string, Candidate>();
  function considerCandidate(nodeIds: readonly number[], missingEdges: number, score: number): void {
    const key = candidateKey(nodeIds);
    const existing = candidatesByKey.get(key);
    if (
      !existing ||
      missingEdges < existing.missingEdges ||
      (missingEdges === existing.missingEdges && score > existing.score)
    ) {
      candidatesByKey.set(key, { nodeIds: [...nodeIds].sort((a, b) => a - b), missingEdges, score });
    }
  }

  // Every qualifying edge is always its own 2-node candidate — the
  // fail-closed fallback that never depends on either guard below.
  for (const [aId, neighbors] of adjacency) {
    for (const bId of neighbors) {
      if (aId >= bId) continue;
      considerCandidate([aId, bId], 0, graph.weightBetween(aId, bId));
    }
  }

  // Connected components over the thresholded adjacency.
  const visited = new Set<number>();
  for (const startId of adjacency.keys()) {
    if (visited.has(startId)) continue;
    const component: number[] = [];
    const stack = [startId];
    visited.add(startId);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const neighbor of adjacency.get(cur) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    // A component of <3 nodes can only ever produce the 2-node candidates
    // already emitted above — nothing more to search.
    if (component.length < 3) continue;

    if (component.length > MAX_CLIQUE_COMPONENT_SIZE) {
      console.error(
        `clique-extraction: component of ${component.length} nodes exceeds ` +
          `MAX_CLIQUE_COMPONENT_SIZE=${MAX_CLIQUE_COMPONENT_SIZE}; skipping near-clique search for this ` +
          `component (its qualifying edges still report as 2-node candidates).`
      );
      continue;
    }

    // Full (non-maximal) clique enumeration: process nodes in a fixed
    // (sorted) order, extending a clique only with candidates that come
    // after the last-added member and are neighbors of every current
    // member. Every clique of size >=1 is emitted exactly once this way —
    // no duplicate work, and (unlike classic Bron–Kerbosch) every
    // recursion-tree node of size >=2 is captured, not only maximal leaves.
    // This is what fixes the {A,B,C,X}-hides-{A,B,C,D} under-recovery bug:
    // {A,B,C} is emitted here in its own right even though it also extends
    // into the maximal {A,B,C,X}.
    const sorted = [...component].sort((a, b) => a - b);
    const baseCliques: number[][] = [];
    let cliqueCount = 0;
    let budgetExceeded = false;

    function extend(clique: number[], candidates: number[]): boolean {
      if (clique.length >= 2) {
        cliqueCount++;
        if (cliqueCount > MAX_CLIQUE_ENUMERATION_BUDGET) {
          budgetExceeded = true;
          return true;
        }
        baseCliques.push(clique);
      }
      for (let i = 0; i < candidates.length; i++) {
        const v = candidates[i];
        const neighborsOfV = adjacency.get(v)!;
        const newCandidates: number[] = [];
        for (let j = i + 1; j < candidates.length; j++) {
          if (neighborsOfV.has(candidates[j])) newCandidates.push(candidates[j]);
        }
        if (extend([...clique, v], newCandidates)) return true;
      }
      return false;
    }

    extend([], sorted);

    if (budgetExceeded) {
      console.error(
        `clique-extraction: component of ${component.length} nodes exceeded ` +
          `MAX_CLIQUE_ENUMERATION_BUDGET=${MAX_CLIQUE_ENUMERATION_BUDGET} cliques mid-enumeration ` +
          `(reached ${cliqueCount}); abandoning near-clique search for this component (its qualifying ` +
          `edges still report as 2-node candidates).`
      );
      continue;
    }

    const componentSet = new Set(component);

    for (const clique of baseCliques) {
      const cliqueSet = new Set(clique);
      const k = clique.length;

      // The base clique itself (may duplicate a 2-node candidate already
      // emitted above for k=2 — considerCandidate's dedup handles it
      // identically, both agree at missingEdges=0).
      considerCandidate(clique, 0, minPairWeight(graph, clique));

      // Near-clique augmentation (plan step 4): any node adjacent to at
      // least k-1 of this clique's k members forms a candidate missing at
      // most one internal edge.
      for (const v of componentSet) {
        if (cliqueSet.has(v)) continue;
        const neighborsOfV = adjacency.get(v)!;
        let adjacentCount = 0;
        for (const member of clique) if (neighborsOfV.has(member)) adjacentCount++;
        if (adjacentCount >= k - 1) {
          const augmented = [...clique, v];
          // 0 if v is adjacent to all k members (a genuine larger clique the
          // augmentation check also happens to satisfy), 1 if adjacent to
          // exactly k-1 (the intended near-clique case).
          const missingEdges = k - adjacentCount;
          considerCandidate(augmented, missingEdges, minPairWeight(graph, augmented));
        }
      }
    }
  }

  return [...candidatesByKey.values()];
}
