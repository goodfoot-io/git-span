/**
 * `git-span-discover` entrypoint — runs the full implicit-dependency mining
 * pipeline against a target repository and prints a ranked report.
 *
 * Pipeline (near-clique grouping plan, "Pipeline reorder"):
 *
 *   all 7 signals (parallel, via RepoContext)
 *     → graph.ts buildGraph (per-edge evidence aggregation)
 *     → clique-extraction.ts extractNearCliques (full, non-maximal enumeration)
 *     → per candidate:
 *         2-node/0-missing-edge → literal PASS1/PASS2 dual gate
 *           + anchorSetsFullyMatch secondary reportability gate
 *         3+-node → per-edge disqualifier resolution (disqualifier-resolution.ts)
 *           then reportThreshold(nodeCount, missingEdges) on the min-edge weight
 *     → subset suppression (drop a qualifier that is a strict subset of another)
 *     → rename-tracking to HEAD + near-clique re-validation
 *     → dedupe → JSON + markdown output
 *
 * `.span/` is never read or written: all history/content access goes through
 * `RepoContext` (src/prefilter.ts), which excludes `.span/` at both the
 * history-walk and content-read seams (design decisions 5). The CLI adds no
 * separate `.span/` access path of its own.
 *
 * Two-file (2-node/0-missing-edge) output is byte-for-byte equivalent to the
 * old `mergeAnchorGroups`-based pipeline (must-have 5): the report for such a
 * candidate is reconstructed from the same underlying signal groups, through
 * the same `collapseAnchors`/evidence-union/`scoreEvidence` functions, gated by
 * the same `PASS1_THRESHOLD`/`PASS2_THRESHOLD` — the weighted graph only drives
 * topology, never the 2-file report's content. The `anchorSetsFullyMatch`
 * secondary gate (retained per the Testable-Uncertainty-2 spike's divergence
 * finding) keeps hub-bridged per-path fusion from changing the *set* of
 * reported 2-file groups.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractNearCliques } from './clique-extraction.js';
import { edgeKey, resolveCandidate } from './disqualifier-resolution.js';
import * as disqualifiers from './disqualifiers/index.js';
import { isNotAGitRepoError } from './git.js';
import { buildGraph, type GraphNode, type WeightedGraph } from './graph.js';
import { anchorSetsFullyMatch, anchorsOverlap, collapseAnchors } from './grouping.js';
import { type DiscoveredGroup, toJson, toMarkdown } from './output.js';
import { createRepoContext } from './prefilter.js';
import { createRenameResolver, dedupeResolvedByAnchorSet, type ResolvedWithPayload } from './rename-tracking.js';
import { PASS1_THRESHOLD, PASS2_THRESHOLD, reportThreshold, scoreEvidence } from './scoring.js';
import * as signals from './signals/index.js';
import type {
  Anchor,
  AnchorGroup,
  Disqualifier,
  DisqualifierEvidence,
  RepoContext,
  Signal,
  SignalEvidence
} from './types.js';

/** Identifies a `DisqualifierEvidence` for exact-duplicate dropping, mirrors rename-tracking.ts's evidenceKey. */
function disqualifierKey(d: DisqualifierEvidence): string {
  return JSON.stringify([d.disqualifier, d.strength, d.inconclusive ?? false, d.detail ?? '']);
}

/** Unions per-group disqualifier results across a merged bucket, dropping only exact duplicates — same pattern as rename-tracking.ts's mergeEvidence. */
function mergeDisqualifiers(results: readonly DisqualifierEvidence[][]): DisqualifierEvidence[] {
  const seen = new Map<string, DisqualifierEvidence>();
  for (const dq of results) {
    for (const d of dq) {
      const key = disqualifierKey(d);
      if (!seen.has(key)) seen.set(key, d);
    }
  }
  return [...seen.values()].sort((a, b) => disqualifierKey(a).localeCompare(disqualifierKey(b)));
}

/** Canonical identity for one signal-evidence entry — mirrors grouping.ts's (now-deleted) unionEvidence key exactly, so 2-file evidence order is byte-equivalent to the old pipeline. */
function evidenceKey(e: SignalEvidence): string {
  return JSON.stringify([e.signal, e.strength, e.commits ?? [], e.tags ?? [], e.detail ?? '']);
}

/** Unions signal evidence, dropping only exact duplicates, then sorts deterministically — the byte-equivalent replacement for grouping.ts's old unionEvidence. */
function mergeSignalEvidence(evidence: readonly SignalEvidence[]): SignalEvidence[] {
  const seen = new Map<string, SignalEvidence>();
  for (const e of evidence) {
    const key = evidenceKey(e);
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
}

/** Canonical identity for one anchor — mirrors graph.ts's internal anchorKey, for mapping original signal anchors back to graph node ids. */
function anchorKey(a: Anchor): string {
  return `${a.path}:${a.startLine ?? ''}:${a.endLine ?? ''}`;
}

/**
 * Emits a stage-boundary breadcrumb to stderr — cheap visibility for long
 * runs (finding 3). No percentage/ETA tracking, just "still making progress"
 * markers at the pipeline stages below.
 */
function reportProgress(message: string): void {
  process.stderr.write(`git-span-discover: ${message}\n`);
}

const ALL_SIGNALS: Signal[] = Object.values(signals);
const ALL_DISQUALIFIERS: Disqualifier[] = Object.values(disqualifiers);

/** A candidate that has independently cleared its own report gate — carried through subset suppression and rename resolution. */
interface QualifiedCandidate {
  /** Graph node ids, sorted ascending, for subset-suppression identity. */
  nodeIds: number[];
  /** Reconstructed (pre-resolution) reported anchors, from this candidate's own internal edges only. */
  anchors: Anchor[];
  evidence: SignalEvidence[];
  score: number;
  disqualifiers: DisqualifierEvidence[];
}

/** The single path every anchor in a graph node shares (a node is always per-path — anchorsOverlap requires a matching path). */
function pathOfNode(node: GraphNode): string | undefined {
  for (const anchors of node.anchorsByEdge.values()) {
    if (anchors.length > 0) return anchors[0].path;
  }
  return undefined;
}

/**
 * Reconstructs a candidate's reported anchors from **only** the anchors on that
 * candidate's own internal edges (each node's `anchorsByEdge`), then collapses
 * them — never a node's full graph-wide anchor history (the node-anchor
 * reporting gap fix; near-clique grouping plan, "Node-anchor reporting gap").
 * For the 2-node case this reproduces the old `mergeAnchorGroups` anchor set
 * exactly.
 */
function reconstructAnchors(graph: WeightedGraph, nodeIds: readonly number[]): Anchor[] {
  const idSet = new Set(nodeIds);
  const collected: Anchor[] = [];
  for (const id of nodeIds) {
    const node = graph.nodes[id];
    for (const [neighborId, anchors] of node.anchorsByEdge) {
      if (idSet.has(neighborId)) collected.push(...anchors);
    }
  }
  return collapseAnchors(collected);
}

/**
 * True when every underlying signal group contributing to a 2-node candidate's
 * one edge belongs to a single `anchorSetsFullyMatch` equivalence class — i.e.
 * the old `mergeAnchorGroups` would have unioned them all into one 2-anchor
 * group. This is the narrower secondary reportability gate the
 * Testable-Uncertainty-2 spike's divergence finding requires: it fails closed
 * on hub-bridged pairs that per-path fusion pooled onto one edge but today's
 * exact match would keep separate, so per-path fusion never changes the *set*
 * of reported 2-file groups (must-have 5).
 */
function underlyingGroupsFullyMatch(groups: readonly AnchorGroup[]): boolean {
  if (groups.length <= 1) return true;
  const n = groups.length;
  const seen = new Array<boolean>(n).fill(false);
  const stack = [0];
  seen[0] = true;
  let reached = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    for (let j = 0; j < n; j++) {
      if (seen[j]) continue;
      if (anchorSetsFullyMatch(groups[i].anchors, groups[j].anchors)) {
        seen[j] = true;
        reached++;
        stack.push(j);
      }
    }
  }
  return reached === n;
}

/** Drops any qualifier whose node-set is a strict subset of another qualifier's node-set (post-scoring subset suppression). */
function suppressSubsets(candidates: readonly QualifiedCandidate[]): QualifiedCandidate[] {
  const sets = candidates.map((c) => new Set(c.nodeIds));
  return candidates.filter((candidate, i) => {
    for (let j = 0; j < candidates.length; j++) {
      if (j === i) continue;
      if (candidate.nodeIds.length < candidates[j].nodeIds.length && candidate.nodeIds.every((id) => sets[j].has(id))) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Runs the full pipeline against `repoRoot` and returns the surviving,
 * HEAD-resolved candidate groups. Exposed (rather than only `main`) so the
 * integration test can drive the whole pipeline in-process.
 */
export async function discover(
  repoRoot: string,
  ctx: RepoContext = createRepoContext(repoRoot)
): Promise<DiscoveredGroup[]> {
  reportProgress('walking commit history and running signals');
  const signalResults = await Promise.all(ALL_SIGNALS.map((signal) => signal(ctx)));
  const allGroups = signalResults.flat();

  reportProgress('building weighted graph');
  const graph = buildGraph(allGroups);

  // node id → its single path, and anchor identity → node id, so the original
  // signal groups can be mapped back onto graph edges (for the 2-node
  // secondary gate) and disqualifier verdicts back onto node-id pairs.
  const nodePathById = new Map<number, string>();
  const anchorKeyToNodeId = new Map<string, number>();
  for (const node of graph.nodes) {
    const nodePath = pathOfNode(node);
    if (nodePath !== undefined) nodePathById.set(node.id, nodePath);
    for (const anchors of node.anchorsByEdge.values()) {
      for (const anchor of anchors) anchorKeyToNodeId.set(anchorKey(anchor), node.id);
    }
  }

  // The underlying signal groups behind each graph edge, keyed by node-id pair.
  const contributingGroupsByEdge = new Map<string, AnchorGroup[]>();
  for (const group of allGroups) {
    const ids = group.anchors.map((anchor) => anchorKeyToNodeId.get(anchorKey(anchor)));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const na = ids[i];
        const nb = ids[j];
        if (na === undefined || nb === undefined || na === nb) continue;
        const key = edgeKey(na, nb);
        const list = contributingGroupsByEdge.get(key) ?? [];
        list.push(group);
        contributingGroupsByEdge.set(key, list);
      }
    }
  }

  /** Runs both disqualifiers over a candidate's anchors, flattened in a stable order (raw-path-inclusion, then tree-sitter-reference). */
  async function runDisqualifiers(anchors: Anchor[]): Promise<DisqualifierEvidence[]> {
    const group: AnchorGroup = { anchors, evidence: [], score: 0 };
    const results = await Promise.all(ALL_DISQUALIFIERS.map((disqualifier) => disqualifier(group, ctx)));
    return results.flat();
  }

  /**
   * Independently evaluates one candidate node-set against its own report gate,
   * returning a `QualifiedCandidate` if it clears the gate or `null` otherwise.
   * Reused for the initial pass and for rename-resolution re-validation.
   *
   * `skipSecondaryGate` bypasses the 2-node `anchorSetsFullyMatch` secondary
   * reportability gate. It is set **only** when re-deriving a candidate that
   * shrank to 2 surviving nodes during rename-tracking. That gate guards
   * *extraction-time* reportability — it stops broad per-path fusion from
   * *opening* a spurious 2-file group whose contributing signal groups today's
   * exact match would never union (the Testable-Uncertainty-2 divergence).
   * A pair reached by shrinking an already-qualified ≥3-node near-clique at
   * HEAD was not opened by fusion; it is the residue of a candidate that
   * already cleared its own `reportThreshold` gate. Re-imposing the secondary
   * gate there would drop 2-file output the old `mergeAnchorGroups` pipeline
   * still emits (its qualifying 3-anchor groups each rename-shrink to the same
   * pair, then dedupe) — a must-have-5 byte-equivalence regression. The literal
   * PASS1/PASS2 score gate still applies in both modes, so a genuinely weak
   * surviving pair is still rejected.
   */
  async function evaluateCandidate(
    nodeIds: readonly number[],
    { skipSecondaryGate = false }: { skipSecondaryGate?: boolean } = {}
  ): Promise<QualifiedCandidate | null> {
    const sortedIds = [...nodeIds].sort((a, b) => a - b);
    const anchors = reconstructAnchors(graph, sortedIds);

    if (sortedIds.length === 2) {
      // 2-node/0-missing-edge degenerate case: the literal PASS1/PASS2 dual
      // gate plus the anchorSetsFullyMatch secondary reportability gate —
      // byte-equivalent to the old pipeline.
      const [idA, idB] = sortedIds;
      const contributing = contributingGroupsByEdge.get(edgeKey(idA, idB)) ?? [];
      if (contributing.length === 0) return null;
      if (!skipSecondaryGate && !underlyingGroupsFullyMatch(contributing)) return null;

      const evidence = mergeSignalEvidence(contributing.flatMap((g) => g.evidence));
      const preScore = scoreEvidence(evidence);
      if (preScore < PASS1_THRESHOLD) return null;

      const dq = await runDisqualifiers(anchors);
      const postScore = scoreEvidence(evidence, dq);
      if (postScore < PASS2_THRESHOLD) return null;

      return { nodeIds: sortedIds, anchors, evidence, score: postScore, disqualifiers: dq };
    }

    // 3+-node candidate: per-edge disqualifier resolution, then reportThreshold
    // on the min-edge weight. A disqualified edge becomes one more missing edge
    // (never a score subtraction); >1 total gaps drop the candidate.
    //
    // Node identity is per-path but NOT one-node-per-path: two disjoint
    // same-path range anchors with no whole-file anchor to bridge them fuse
    // into two distinct GraphNodes sharing an identical path (graph.ts's
    // node-identity note). A plain `Map<path, nodeId>` silently drops one of
    // them on a same-path collision, misattributing that node's disqualifier
    // verdicts onto the other same-path node's edges. Group candidate node ids
    // by path instead, and disambiguate a collision by checking which node's
    // own anchors the verdict's edge anchor actually overlaps.
    const nodeIdsByPath = new Map<string, number[]>();
    for (const id of sortedIds) {
      const nodePath = nodePathById.get(id);
      if (nodePath === undefined) continue;
      const list = nodeIdsByPath.get(nodePath) ?? [];
      list.push(id);
      nodeIdsByPath.set(nodePath, list);
    }

    function resolveNodeIdForAnchor(anchor: Anchor): number | undefined {
      const ids = nodeIdsByPath.get(anchor.path);
      if (!ids) return undefined;
      if (ids.length === 1) return ids[0];
      return ids.find((id) => {
        for (const nodeAnchors of graph.nodes[id].anchorsByEdge.values()) {
          if (nodeAnchors.some((a) => anchorsOverlap(a, anchor))) return true;
        }
        return false;
      });
    }

    const dq = await runDisqualifiers(anchors);
    const disqualifiersByEdge = new Map<string, DisqualifierEvidence[]>();
    for (const d of dq) {
      if (!d.edge) continue;
      const na = resolveNodeIdForAnchor(d.edge.a);
      const nb = resolveNodeIdForAnchor(d.edge.b);
      if (na === undefined || nb === undefined) continue;
      const key = edgeKey(na, nb);
      const list = disqualifiersByEdge.get(key) ?? [];
      list.push(d);
      disqualifiersByEdge.set(key, list);
    }

    const resolved = resolveCandidate(
      graph,
      { nodeIds: sortedIds },
      (a, b) => disqualifiersByEdge.get(edgeKey(a, b)) ?? []
    );
    if (!resolved) return null;
    if (resolved.score < reportThreshold(sortedIds.length, resolved.missingEdges)) return null;

    // Report evidence: every present internal edge's pooled evidence, deduped.
    const evList: SignalEvidence[] = [];
    for (let i = 0; i < sortedIds.length; i++) {
      for (let j = i + 1; j < sortedIds.length; j++) {
        const edge = graph.edgeBetween(sortedIds[i], sortedIds[j]);
        if (edge) evList.push(...edge.evidence);
      }
    }
    const evidence = mergeSignalEvidence(evList);

    return { nodeIds: sortedIds, anchors, evidence, score: resolved.score, disqualifiers: dq };
  }

  reportProgress('extracting near-cliques');
  const candidates = extractNearCliques(graph);

  reportProgress('scoring candidates');
  const evaluated = await Promise.all(candidates.map((candidate) => evaluateCandidate(candidate.nodeIds)));
  const qualified = evaluated.filter((c): c is QualifiedCandidate => c !== null);

  const surviving = suppressSubsets(qualified);

  // Rename-tracking to HEAD, with near-clique re-validation: a candidate whose
  // surviving distinct-path count differs from its pre-resolution node count is
  // re-derived from scratch over its surviving nodes rather than carried
  // forward stale (plan "Rename-resolution re-validation").
  reportProgress('resolving renames to HEAD');
  const resolver = await createRenameResolver(ctx);
  const resolvedItems: ResolvedWithPayload<DisqualifierEvidence[]>[] = [];
  for (const candidate of surviving) {
    const head = await resolver.resolve({
      anchors: candidate.anchors,
      evidence: candidate.evidence,
      score: candidate.score
    });
    if (!head) continue;

    const headPaths = new Set(head.anchors.map((a) => a.path));
    if (headPaths.size === candidate.nodeIds.length) {
      resolvedItems.push({ group: head, payload: candidate.disqualifiers });
      continue;
    }

    // Shrank (a node's file was deleted at HEAD): re-derive over survivors —
    // surviving nodes keep their original path, so map back by path.
    const survivingNodeIds = candidate.nodeIds.filter((id) => {
      const nodePath = nodePathById.get(id);
      return nodePath !== undefined && headPaths.has(nodePath);
    });
    if (survivingNodeIds.length < 2) continue;

    const rederived = await evaluateCandidate(survivingNodeIds, { skipSecondaryGate: true });
    if (!rederived) continue;
    const rehead = await resolver.resolve({
      anchors: rederived.anchors,
      evidence: rederived.evidence,
      score: rederived.score
    });
    if (!rehead) continue;
    resolvedItems.push({ group: rehead, payload: rederived.disqualifiers });
  }

  const deduped = dedupeResolvedByAnchorSet(resolvedItems, mergeDisqualifiers);

  const discovered: DiscoveredGroup[] = deduped.map(({ group, payload }) => ({
    anchors: group.anchors,
    score: group.score,
    signals: group.evidence,
    disqualifiers: payload
  }));

  discovered.sort((a, b) => b.score - a.score);
  return discovered;
}

interface CliOptions {
  repoRoot: string;
  format: 'markdown' | 'json';
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { repoRoot: process.cwd(), format: 'markdown', help: false };
  let repoSet = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--markdown' || arg === '--md') options.format = 'markdown';
    else if (!arg.startsWith('-') && !repoSet) {
      options.repoRoot = path.resolve(arg);
      repoSet = true;
    }
  }
  return options;
}

const HELP = `git-span-discover — mine implicit file/line-range couplings from local git history.

Usage:
  git-span-discover [repo] [--json | --markdown]

Arguments:
  repo            Path to the target git repository (default: current directory).

Options:
  --json          Emit machine-readable JSON instead of the markdown summary.
  --markdown      Emit the human-readable markdown summary (default).
  -h, --help      Show this help.

Reads only local git history and file content; never reads or writes .span/.`;

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  let groups: DiscoveredGroup[];
  try {
    groups = await discover(options.repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNotAGitRepoError(message)) {
      process.stderr.write(`git-span-discover: not a git repository: ${options.repoRoot}\n`);
      return 1;
    }
    throw err;
  }

  reportProgress('rendering report');
  const rendered = options.format === 'json' ? toJson(groups) : toMarkdown(groups);
  process.stdout.write(`${rendered}\n`);
  return 0;
}

/**
 * Only auto-run the pipeline when this module is the process entrypoint (the
 * built bin), not when it is imported — e.g. by the integration test, which
 * drives {@link discover} directly and must not trigger a full run against the
 * test process's cwd on import.
 */
const invokedPath = process.argv[1];
const isEntrypoint = invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`git-span-discover: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
