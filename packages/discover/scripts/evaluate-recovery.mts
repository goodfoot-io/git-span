/**
 * Recovery evaluation for the n-ary near-clique grouping redesign (must-have
 * 6, near-clique-grouping plan "Eval script"). Two independent things happen
 * here:
 *
 *  1. The finished pipeline (`discover()`) and the four rejected-alternative
 *     grouping configurations from `notes/rejected-grouping-alternatives.md`
 *     are all run **live** against this repository's own real git history,
 *     and their strict/near recovery against the 13 real hand-authored
 *     `.span/**` groups is reported side by side.
 *  2. The 13 ground-truth groups are loaded via a direct `fs` read of
 *     `.span/**`, entirely outside `RepoContext` — `RepoContext` excludes
 *     `.span/` by design decision 5 (see `src/types.ts`'s doc comment and
 *     `src/prefilter.ts`'s `isSpanPath`), and this script does not add a
 *     `.span/` read path to it. The loader below is a separate, explicit
 *     reader, the same way a test reads fixtures the code under test never
 *     sees.
 *
 * This is a REPORTING-ONLY script, not a CI gate: this repository's history
 * drifts as commits land, so a recovery-count assertion here would be flaky
 * by construction. The CI-gated regression check for n-ary recovery is the
 * synthetic-fixture golden test in `test/n-ary-recovery.test.ts`, whose
 * ground truth is fixed at fixture-authoring time and cannot drift.
 *
 * IMPORTANT — read this before treating any number below as a verdict:
 * recovery against the 13 real spans is expected to be LOW (roughly 1-3 of
 * 13, strict or near) even for the finished pipeline. Several target spans
 * (e.g. `git-span/structural-merge-kernel`, `devops/cargo-release-build-
 * parallelism`) have every one of their internal file pairs sitting at a
 * flat, uninformative 0.500 score under all 7 signals today — zero evidence,
 * not weak evidence. No grouping algorithm can assemble a group out of
 * pairs with no evidence at all; that is a signal-coverage gap, explicitly
 * out of scope for this card (see CARD.md's non-goals). Do not read a low
 * number here as evidence the redesign failed, and do not read the
 * rejected alternatives' numbers as proof a denser rule would have done
 * better — they are reproduced here, live, precisely so that question never
 * has to be re-litigated from a stale historical note.
 *
 * Run with: `node --import tsx scripts/evaluate-recovery.mts` (or `yarn
 * evaluate-recovery`) from `packages/discover/`. Plain `tsx` invocation and
 * a `.ts` extension both fail in some sandboxes (missing top-level-await
 * support under esbuild's cjs output) — `.mts` + `node --import tsx` is the
 * combination confirmed to work, per `notes/rejected-grouping-alternatives.md`.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE COMPARING THE "final pipeline" ROW TO ANY ALTERNATIVE ROW:
 * the columns below are NOT computed by equivalent functions over equivalent
 * substrates, and a naive side-by-side reading gets the rejection rationale
 * backwards.
 *
 *  - The final-pipeline row is **blind extraction**: `discover()` runs
 *    end-to-end and must find each ground-truth group among *every* file in
 *    the repo, subject to every real constraint that exists in production —
 *    `EDGE_THRESHOLD`, near-clique extraction, disqualifier resolution,
 *    subset suppression, rename resolution, PASS1/PASS2 gating, and (the
 *    dominant one on this repo) `MAX_CLIQUE_COMPONENT_SIZE` skipping n-ary
 *    search entirely for the repo's one oversized hub component — any
 *    ground-truth span living in that component is structurally unrecoverable
 *    as an n-ary group regardless of threshold tuning. The script prints the
 *    live-measured size of that skipped component (captured from
 *    `clique-extraction.ts`'s own stderr diagnostic, not hardcoded) right
 *    above the final-pipeline row so this isn't left for a reader to infer.
 *  - Every "rejected alternative" row is **oracle-fed cohesion checking**:
 *    `classifyByQualifyingRule` / `classifyBySeededGrowth` are handed the
 *    ground-truth span's own file set directly (`[...span.paths]`) and only
 *    ask whether that span's *own internal pairs* qualify under the rule —
 *    they never search the repo, never compete against the hub component,
 *    never run suppression/rename/gating. This is an upper bound on
 *    qualification, not a real extractor's output, and it is why two of the
 *    four alternatives can show higher raw recall than the shipped pipeline
 *    on this run despite being rejected — they were never tested against the
 *    same obstacles.
 *  - The two column families also don't share a substrate: `computePairwiseEvidence`
 *    pools evidence per **whole-file** path pair (`anchors.length !== 2` is
 *    dropped), not the range-aware per-path-fused node identity the real
 *    `graph.ts` builds, so even where an alternative's rule and the shipped
 *    pipeline agree conceptually, they are scoring different graphs.
 *
 * CARD.md's real rejection rationale for these alternatives is about
 * **density**, not recall alone (e.g. two-tier: 105,365 -> 67,961 qualifying
 * repo-wide edges for a *worse* recall outcome; see
 * `notes/rejected-grouping-alternatives.md`). Each alternative row below now
 * prints a live-computed repo-wide qualifying-edge count (or, for seeded
 * growth, an explosion count against the same 50-node density cap the
 * original studies used) alongside strict/near recall, so the density half
 * of the rejection is visible in the same place as the recall half.
 * ---------------------------------------------------------------------------
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../src/cli.js';
import { createRepoContext } from '../src/prefilter.js';
import { scoreEvidence } from '../src/scoring.js';
import * as signals from '../src/signals/index.js';
import type { Anchor, RepoContext, Signal, SignalEvidence } from '../src/types.js';

// ---------------------------------------------------------------------------
// Ground-truth loader — direct fs read of .span/**, never through RepoContext.
// ---------------------------------------------------------------------------

/** One real hand-authored ground-truth group parsed from a `.span/**` file. */
export interface GroundTruthSpan {
  /** The span's path relative to `.span/`, e.g. `git-span/structural-merge-kernel`. */
  name: string;
  anchors: Anchor[];
  /** Distinct file paths referenced by this span's anchors. */
  paths: Set<string>;
}

/**
 * Matches one anchor line in a `.span/**` file: `path[#Lstart-Lend]
 * rk64:<hash>`. Confirmed against the real files, e.g.:
 *   `packages/git-span-core/src/lib.rs#L27-L28 rk64:925472c09f25dcae`
 *   `packages/git-span/src/cli/merge_driver.rs rk64:624b66599fb2bbe0`
 */
const ANCHOR_LINE = /^([^\s#]+)(?:#L(\d+)-L(\d+))?\s+rk64:[0-9a-f]+$/;

/**
 * Parses one `.span/**` file's raw content into its anchor set. Anchor lines
 * run from the top of the file until the first blank line (a free-form
 * description follows, and is not this loader's concern). Fails loudly
 * (throws) rather than silently returning zero anchors: a `.span/**` file
 * that doesn't match the expected shape at all means either the real format
 * moved out from under this script or the file is corrupt, and either way a
 * silent `[]` would quietly zero out that span's recovery contribution
 * instead of surfacing the problem.
 */
export function parseSpanFile(name: string, content: string): GroundTruthSpan {
  const lines = content.split('\n');
  const anchors: Anchor[] = [];

  for (const line of lines) {
    if (line.trim() === '') break;
    const match = ANCHOR_LINE.exec(line);
    if (!match) {
      throw new Error(
        `evaluate-recovery: malformed .span anchor line in ground-truth span "${name}": ${JSON.stringify(line)}`
      );
    }
    const [, anchorPath, start, end] = match;
    anchors.push(
      start !== undefined && end !== undefined
        ? { path: anchorPath, startLine: Number(start), endLine: Number(end) }
        : { path: anchorPath }
    );
  }

  if (anchors.length === 0) {
    throw new Error(
      `evaluate-recovery: no anchor lines found in ground-truth span "${name}" — file is missing its expected ` +
        `"path[#Lstart-Lend] rk64:<hash>" header block (malformed or empty file)`
    );
  }

  return { name, anchors, paths: new Set(anchors.map((a) => a.path)) };
}

/**
 * Reads and parses one `.span/<name>` file. Throws (not a null/empty return)
 * on a missing file — a named ground-truth span that can't be read at all is
 * exactly as loud a failure as one that parses wrong.
 */
export function loadGroundTruthSpan(repoRoot: string, name: string): GroundTruthSpan {
  const file = path.join(repoRoot, '.span', name);
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `evaluate-recovery: could not read ground-truth span file "${file}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parseSpanFile(name, content);
}

/**
 * The 13 real hand-authored multi-file `.span/**` groups named in CARD.md
 * and `notes/rejected-grouping-alternatives.md` — the only ground-truth
 * corpus available. Fixed by those documents, not rediscovered by scanning
 * `.span/**` (which also contains single-anchor spans and non-span config
 * files like `.gateignore` that aren't part of this corpus).
 */
export const GROUND_TRUTH_SPAN_NAMES: readonly string[] = [
  'cross-platform/span-lf-guarantee',
  'devops/build-system-documentation',
  'devops/cargo-release-build-parallelism',
  'devops/mold-linker',
  'devops/shared-target-lock-mechanism',
  'website/mismatch-box-green-compensation',
  'wiki/meta/update-order',
  'release/version-bump-workflow',
  'benchmark-fixture-library-pattern',
  'interior-anchor-surfacing-and-repair',
  'git-span/structural-merge-kernel',
  'git-span/path-index-resolver-reuse',
  'resolver/cold-vs-small-batch-task-floor'
];

export function loadGroundTruthSpans(
  repoRoot: string,
  names: readonly string[] = GROUND_TRUTH_SPAN_NAMES
): GroundTruthSpan[] {
  return names.map((name) => loadGroundTruthSpan(repoRoot, name));
}

// ---------------------------------------------------------------------------
// Recovery classification
// ---------------------------------------------------------------------------

export type RecoveryVerdict = 'strict' | 'near' | 'none';

/** Size of the symmetric difference between two file-path sets. */
function symmetricDifferenceSize(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let diff = 0;
  for (const p of a) if (!b.has(p)) diff++;
  for (const p of b) if (!a.has(p)) diff++;
  return diff;
}

/**
 * A span is "strictly" recovered when some reported group's file set exactly
 * equals its ground-truth file set, and "near"ly recovered when some
 * reported group's file set differs from it by at most one file — the same
 * k-1-of-k near-clique tolerance the redesign itself applies internally, but
 * measured here as a full-corpus regression check rather than a topology
 * rule. Neither the note nor CARD.md pins down a single formal definition
 * for the historical "1-3/13 near" figures, so this definition is this
 * script's own, explicit and documented rather than assumed.
 */
export function classifyRecovery(
  groundTruth: GroundTruthSpan,
  reportedGroups: readonly { anchors: readonly { path: string }[] }[]
): RecoveryVerdict {
  let sawNear = false;
  for (const group of reportedGroups) {
    const reportedPaths = new Set(group.anchors.map((a) => a.path));
    const diff = symmetricDifferenceSize(reportedPaths, groundTruth.paths);
    if (diff === 0) return 'strict';
    if (diff <= 1) sawNear = true;
  }
  return sawNear ? 'near' : 'none';
}

interface RecoverySummary {
  strict: number;
  near: number;
  total: number;
}

function summarize(verdicts: readonly RecoveryVerdict[]): RecoverySummary {
  return {
    strict: verdicts.filter((v) => v === 'strict').length,
    near: verdicts.filter((v) => v === 'strict' || v === 'near').length,
    total: verdicts.length
  };
}

function formatSummary(label: string, summary: RecoverySummary): string {
  return `${label}: ${summary.strict}/${summary.total} strict, ${summary.near}/${summary.total} near`;
}

/**
 * Runs `fn`, capturing every line written to `process.stderr` while it runs,
 * without suppressing it from the real stderr stream (the caller still sees
 * anything logged). Used to capture `clique-extraction.ts`'s
 * `MAX_CLIQUE_COMPONENT_SIZE` skip diagnostic live, so the final-pipeline
 * row's hub-component caveat reports this run's real component size instead
 * of a number frozen at spike time.
 */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderrLines: string[] }> {
  const lines: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((
    chunk: string | Uint8Array,
    ...rest: Parameters<typeof originalWrite> extends [unknown, ...infer Rest] ? Rest : never[]
  ): boolean => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return originalWrite(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stderrLines: lines };
  } finally {
    process.stderr.write = originalWrite;
  }
}

/** Parses the oversized-component size(s) out of clique-extraction.ts's own skip diagnostic, live from this run's stderr — not hardcoded from any historical spike. */
function parseSkippedHubComponentSizes(stderrLines: readonly string[]): number[] {
  const sizes: number[] = [];
  const pattern = /component of (\d+) nodes exceeds MAX_CLIQUE_COMPONENT_SIZE/;
  for (const line of stderrLines) {
    const match = pattern.exec(line);
    if (match) sizes.push(Number(match[1]));
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Shared pairwise-weight computation for the four rejected alternatives.
//
// The final pipeline's own recovery is measured by running the real
// `discover()` end to end. The four rejected configurations below never
// existed as part of the shipped pipeline — they are density-control rules
// applied on top of the same raw per-pair signal evidence `discover()`
// itself pools into its weighted graph, so this section recomputes that raw
// per-pair evidence directly from the 7 signals (mirroring how
// `notes/rejected-grouping-alternatives.md`'s original scratchpad studies
// worked: real signal output, `scoreEvidence()`, pairwise — not through
// `graph.ts`'s node-fusion machinery, which those pre-Stage-1 studies
// predate).
// ---------------------------------------------------------------------------

interface PairInfo {
  weight: number;
  labels: ReadonlySet<string>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

const ALL_SIGNALS: Signal[] = Object.values(signals);

/**
 * Runs all 7 signals once and pools their evidence per whole-file pair,
 * keyed by unordered path pair. Range-level signal output is treated at the
 * file level here (the same granularity the rejected-alternative studies
 * used) — an intentional simplification for this comparison, not a claim
 * about the real pipeline's own (range-aware) node identity.
 */
async function computePairwiseEvidence(ctx: RepoContext): Promise<Map<string, SignalEvidence[]>> {
  const results = await Promise.all(ALL_SIGNALS.map((signal) => signal(ctx)));
  const byPair = new Map<string, SignalEvidence[]>();
  for (const group of results.flat()) {
    if (group.anchors.length !== 2) continue;
    const [a, b] = group.anchors;
    const key = pairKey(a.path, b.path);
    const list = byPair.get(key) ?? [];
    list.push(...group.evidence);
    byPair.set(key, list);
  }
  return byPair;
}

function computePairwiseWeights(evidenceByPair: ReadonlyMap<string, SignalEvidence[]>): Map<string, PairInfo> {
  const out = new Map<string, PairInfo>();
  for (const [key, evidence] of evidenceByPair) {
    out.set(key, { weight: scoreEvidence(evidence), labels: new Set(evidence.map((e) => e.signal)) });
  }
  return out;
}

/**
 * Repo-wide count of scored pairs satisfying `qualifies` — the density
 * indicator `notes/rejected-grouping-alternatives.md`'s original studies
 * used to reject these alternatives (e.g. two-tier: 105,365 -> 67,961
 * qualifying edges repo-wide), computed live here rather than quoted from
 * that historical note, so it tracks this run's real repo state.
 */
function countQualifyingEdges(
  weights: ReadonlyMap<string, PairInfo>,
  qualifies: (a: string, b: string) => boolean
): { qualifying: number; total: number } {
  let qualifying = 0;
  let total = 0;
  for (const key of weights.keys()) {
    // pairKey() joins with a NUL separator (not a space — file paths can
    // legitimately contain spaces), matching buildAdjacency()'s own split.
    const [a, b] = key.split('\0');
    total++;
    if (qualifies(a, b)) qualifying++;
  }
  return { qualifying, total };
}

/** Raw pairwise weight, defaulting to the neutral `scoreEvidence([]) = 0.5` for a pair with no evidence at all. */
function weightBetween(weights: ReadonlyMap<string, PairInfo>, a: string, b: string): number {
  return weights.get(pairKey(a, b))?.weight ?? 0.5;
}

function labelsBetween(weights: ReadonlyMap<string, PairInfo>, a: string, b: string): ReadonlySet<string> {
  return weights.get(pairKey(a, b))?.labels ?? new Set();
}

/** Every unordered pair among a span's own ground-truth files. */
function internalPairs(paths: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) pairs.push([paths[i], paths[j]]);
  }
  return pairs;
}

/**
 * Classifies a span's recovery under an edge-qualification rule directly
 * (rather than via a reported group's anchor set): strict when every
 * internal pair qualifies, near when at most one does not (the same k-1-of-k
 * tolerance the shipped near-clique extractor applies), none otherwise. Used
 * for the two rejected configurations that are qualification *rules* over
 * the flat graph (two-tier, mutual top-K) rather than growth *processes*.
 */
function classifyByQualifyingRule(
  paths: readonly string[],
  qualifies: (a: string, b: string) => boolean
): RecoveryVerdict {
  const pairs = internalPairs(paths);
  const missing = pairs.filter(([a, b]) => !qualifies(a, b)).length;
  if (missing === 0) return 'strict';
  if (missing <= 1) return 'near';
  return 'none';
}

// -- 1. Two-tier qualification -----------------------------------------------

/** structural signal (association-rules OR shared-config-key) fires, OR >=2 distinct signals corroborate. */
function twoTierQualifies(weights: ReadonlyMap<string, PairInfo>, a: string, b: string): boolean {
  const labels = labelsBetween(weights, a, b);
  return labels.has('association-rules') || labels.has('shared-config-key') || labels.size >= 2;
}

// -- 2. Mutual top-K sparsification ------------------------------------------

const TOP_K_VALUES: readonly number[] = [5, 10, 20, 50];

/** path -> neighbors sorted by descending pairwise weight, built once from the whole repo's pairwise weights. */
function buildAdjacency(weights: ReadonlyMap<string, PairInfo>): Map<string, { neighbor: string; weight: number }[]> {
  const adjacency = new Map<string, { neighbor: string; weight: number }[]>();
  const add = (from: string, to: string, weight: number) => {
    const list = adjacency.get(from) ?? [];
    list.push({ neighbor: to, weight });
    adjacency.set(from, list);
  };
  for (const key of weights.keys()) {
    const [a, b] = key.split(' ');
    const weight = weights.get(key)!.weight;
    add(a, b, weight);
    add(b, a, weight);
  }
  for (const list of adjacency.values()) list.sort((x, y) => y.weight - x.weight);
  return adjacency;
}

function mutualTopKQualifies(
  adjacency: ReadonlyMap<string, { neighbor: string; weight: number }[]>,
  k: number,
  a: string,
  b: string
): boolean {
  const topOfA = (adjacency.get(a) ?? []).slice(0, k).some((n) => n.neighbor === b);
  const topOfB = (adjacency.get(b) ?? []).slice(0, k).some((n) => n.neighbor === a);
  return topOfA && topOfB;
}

// -- 3/4. Seeded local growth (naive, then corrected) ------------------------

interface SeededGrowthParams {
  highT: number;
  lowT: number;
  /** Corrected variant: admit only if >=lowT against every current member. Naive: >=lowT against any member, or >=highT bridge from the seed. */
  allMemberAdmission: boolean;
}

/** Density-blowup cap mirroring the original studies' 50-node stress-test cap — growth past this is treated as "exploded", never recovered. */
const SEEDED_GROWTH_MAX_SIZE = 50;

/**
 * Grows a cluster from a seed pair using the given admission rule until no
 * further node is admitted or the density cap is hit. Candidate discovery is
 * restricted to each current member's adjacency list (not every file in the
 * repo) purely for performance — the actual admission decision still checks
 * the real pairwise weight, so this changes nothing about which nodes
 * qualify, only how fast candidates are found.
 */
function growSeededCluster(
  weights: ReadonlyMap<string, PairInfo>,
  adjacency: ReadonlyMap<string, { neighbor: string; weight: number }[]>,
  seedA: string,
  seedB: string,
  params: SeededGrowthParams
): { members: Set<string>; exploded: boolean } {
  const members = new Set([seedA, seedB]);
  let changed = true;
  while (changed) {
    changed = false;
    const candidates = new Set<string>();
    for (const member of members) {
      for (const { neighbor, weight } of adjacency.get(member) ?? []) {
        if (weight < params.lowT) break; // sorted descending — nothing further clears lowT either
        if (!members.has(neighbor)) candidates.add(neighbor);
      }
    }
    for (const candidate of candidates) {
      if (members.has(candidate)) continue;
      const admit = params.allMemberAdmission
        ? [...members].every((m) => weightBetween(weights, m, candidate) >= params.lowT)
        : [...members].some((m) => weightBetween(weights, m, candidate) >= params.lowT) ||
          weightBetween(weights, seedA, candidate) >= params.highT ||
          weightBetween(weights, seedB, candidate) >= params.highT;
      if (admit) {
        members.add(candidate);
        changed = true;
        if (members.size > SEEDED_GROWTH_MAX_SIZE) return { members, exploded: true };
      }
    }
  }
  return { members, exploded: false };
}

/** Seeds growth from a span's own strongest internal pair — the most favorable seed available for that span. */
function bestSeedPair(weights: ReadonlyMap<string, PairInfo>, paths: readonly string[]): [string, string] {
  let best: [string, string] = [paths[0], paths[1]];
  let bestWeight = -Infinity;
  for (const [a, b] of internalPairs(paths)) {
    const w = weightBetween(weights, a, b);
    if (w > bestWeight) {
      bestWeight = w;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Returns both the recovery verdict and whether growth hit the
 * `SEEDED_GROWTH_MAX_SIZE` density cap — the density indicator for this
 * alternative (mirroring the original studies' "density stress test",
 * `notes/rejected-grouping-alternatives.md` section 4: growth exploding past
 * the same 50-node cap even from a strong seed is itself the rejection
 * reason, independent of recall).
 */
function classifyBySeededGrowthWithDensity(
  weights: ReadonlyMap<string, PairInfo>,
  adjacency: ReadonlyMap<string, { neighbor: string; weight: number }[]>,
  span: GroundTruthSpan,
  params: SeededGrowthParams
): { verdict: RecoveryVerdict; exploded: boolean } {
  const paths = [...span.paths];
  if (paths.length < 2) return { verdict: 'none', exploded: false };
  const [seedA, seedB] = bestSeedPair(weights, paths);
  const { members, exploded } = growSeededCluster(weights, adjacency, seedA, seedB, params);
  if (exploded) return { verdict: 'none', exploded: true };
  const diff = symmetricDifferenceSize(members, span.paths);
  if (diff === 0) return { verdict: 'strict', exploded: false };
  if (diff <= 1) return { verdict: 'near', exploded: false };
  return { verdict: 'none', exploded: false };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const NAIVE_HIGH_T: readonly number[] = [0.75, 0.8, 0.85, 0.94];
const NAIVE_LOW_T: readonly number[] = [0.5, 0.55, 0.6];
const CORRECTED_HIGH_T: readonly number[] = [0.75, 0.8, 0.85];
const CORRECTED_LOW_T: readonly number[] = [0.5, 0.55];

async function run(repoRoot: string): Promise<void> {
  const lines: string[] = [];
  const log = (line = ''): void => {
    lines.push(line);
  };

  log('git-span-discover: n-ary recovery evaluation (must-have 6)');
  log('='.repeat(72));
  log(
    "REPORTING ONLY — not a CI gate. This repo's history drifts over time, " +
      'so a recovery-count assertion here would be flaky. The CI-gated check ' +
      "is test/n-ary-recovery.test.ts's synthetic-fixture golden test."
  );
  log(
    'CAVEAT — recovery against the 13 real spans is expected to be LOW ' +
      '(roughly 1-3/13). Several spans (e.g. git-span/structural-merge-kernel, ' +
      'devops/cargo-release-build-parallelism) have every internal pair at a ' +
      'flat 0.500 (zero evidence) under all 7 signals today — a signal-coverage ' +
      "gap explicitly out of scope per CARD.md's non-goals, not something any " +
      'grouping-threshold change can fix.'
  );
  log();

  const groundTruth = loadGroundTruthSpans(repoRoot);
  log(`Loaded ${groundTruth.length} real ground-truth .span/** groups.`);
  log();

  // -- Final pipeline (the shipped implementation) ---------------------------
  log('-- Final pipeline (discover()) — BLIND EXTRACTION over the whole real repo --');
  const { result: finalGroups, stderrLines } = await captureStderr(() => discover(repoRoot));
  const skippedHubSizes = parseSkippedHubComponentSizes(stderrLines);
  if (skippedHubSizes.length > 0) {
    log(
      `NOTE: this run skipped n-ary search entirely for ${skippedHubSizes.length === 1 ? 'a' : skippedHubSizes.length} ` +
        `hub component(s) of size ${skippedHubSizes.join(', ')} node(s) (MAX_CLIQUE_COMPONENT_SIZE guard). Any ` +
        'ground-truth span living inside that component cannot be recovered as an n-ary group this run, no matter ' +
        'how the threshold is tuned — this alone depresses the row below relative to every "rejected alternative" ' +
        'row (none of which are subject to this or any other real extraction constraint; see the module doc comment).'
    );
  }
  const finalVerdicts = groundTruth.map((span) => classifyRecovery(span, finalGroups));
  log(formatSummary('final pipeline', summarize(finalVerdicts)));
  for (const [span, verdict] of groundTruth.map((s, i) => [s, finalVerdicts[i]] as const)) {
    log(`  ${verdict.padEnd(6)} ${span.name}`);
  }
  log();

  // -- Rejected alternatives (executed live, not hardcoded) ------------------
  log(
    'NOTE ON EVERY ROW BELOW: these are ORACLE-FED COHESION CHECKS, not blind extraction. Each rule is handed a ' +
      "ground-truth span's own file set directly and only asks whether that span's internal pairs qualify — it " +
      'never searches the repo for the group, never competes against the hub component skipped above, and never ' +
      'runs subset suppression/rename resolution/PASS1-PASS2 gating. Treat these as an upper bound on ' +
      'qualification under each rule, not as what a real extractor built on that rule would actually report. ' +
      'They also score a different substrate than the final pipeline: whole-file pairwise evidence, not the ' +
      'range-aware fused node graph.ts builds. Recall numbers here are therefore not directly comparable to the ' +
      "final-pipeline row above — the density/edge-count figures printed alongside each rule are what CARD.md's " +
      'rejection rationale actually turns on.'
  );
  log();
  const ctx = createRepoContext(repoRoot);
  const evidenceByPair = await computePairwiseEvidence(ctx);
  const weights = computePairwiseWeights(evidenceByPair);
  const adjacency = buildAdjacency(weights);

  log('-- Rejected alternative 1: two-tier qualification (oracle-fed cohesion check) --');
  const twoTierVerdicts = groundTruth.map((span) =>
    classifyByQualifyingRule([...span.paths], (a, b) => twoTierQualifies(weights, a, b))
  );
  const twoTierDensity = countQualifyingEdges(weights, (a, b) => twoTierQualifies(weights, a, b));
  log(formatSummary('two-tier', summarize(twoTierVerdicts)));
  log(`  density: ${twoTierDensity.qualifying}/${twoTierDensity.total} repo-wide pairs qualify`);
  log();

  log('-- Rejected alternative 2: mutual top-K sparsification (oracle-fed cohesion check) --');
  for (const k of TOP_K_VALUES) {
    const verdicts = groundTruth.map((span) =>
      classifyByQualifyingRule([...span.paths], (a, b) => mutualTopKQualifies(adjacency, k, a, b))
    );
    const density = countQualifyingEdges(weights, (a, b) => mutualTopKQualifies(adjacency, k, a, b));
    const nodeCount = adjacency.size;
    const avgDegree = nodeCount > 0 ? ((2 * density.qualifying) / nodeCount).toFixed(1) : '0.0';
    log(formatSummary(`  K=${k}`, summarize(verdicts)));
    log(`    density: ${density.qualifying}/${density.total} repo-wide pairs qualify, avg degree ${avgDegree}`);
  }
  log();

  log('-- Rejected alternative 3: naive seeded local growth (oracle-fed cohesion check) --');
  for (const highT of NAIVE_HIGH_T) {
    for (const lowT of NAIVE_LOW_T) {
      const results = groundTruth.map((span) =>
        classifyBySeededGrowthWithDensity(weights, adjacency, span, { highT, lowT, allMemberAdmission: false })
      );
      const verdicts = results.map((r) => r.verdict);
      const explodedCount = results.filter((r) => r.exploded).length;
      log(formatSummary(`  highT=${highT}, lowT=${lowT}`, summarize(verdicts)));
      log(`    density: ${explodedCount}/${groundTruth.length} span-seeded clusters exploded past the 50-node cap`);
    }
  }
  log();

  log('-- Rejected alternative 4: corrected all-member seeded growth (oracle-fed cohesion check) --');
  for (const highT of CORRECTED_HIGH_T) {
    for (const lowT of CORRECTED_LOW_T) {
      const results = groundTruth.map((span) =>
        classifyBySeededGrowthWithDensity(weights, adjacency, span, { highT, lowT, allMemberAdmission: true })
      );
      const verdicts = results.map((r) => r.verdict);
      const explodedCount = results.filter((r) => r.exploded).length;
      log(formatSummary(`  highT=${highT}, lowT=${lowT}`, summarize(verdicts)));
      log(`    density: ${explodedCount}/${groundTruth.length} span-seeded clusters exploded past the 50-node cap`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Entrypoint guard — mirrors src/cli.ts's pattern: only auto-run when this
// module is the process entrypoint, not when a test imports it for its
// exported functions.
// ---------------------------------------------------------------------------

const invokedPath = process.argv[1];
const isEntrypoint = invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const repoRootArgIndex = process.argv.indexOf('--repo');
  const repoRoot =
    repoRootArgIndex !== -1 && process.argv[repoRootArgIndex + 1]
      ? path.resolve(process.argv[repoRootArgIndex + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

  run(repoRoot).catch((err: unknown) => {
    process.stderr.write(`evaluate-recovery: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  });
}
