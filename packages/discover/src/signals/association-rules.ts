/**
 * Association-rule co-change signal.
 *
 * Over the full pre-filtered commit history (design decisions 4/5 — sweep
 * commits already excluded, `.span/` already stripped, both upstream in
 * `RepoContext.commits()`), this signal computes, for every pair of files
 * that co-occur in at least one commit:
 *
 *  - support(A, B) = count(commits touching both A and B) / count(all commits)
 *  - confidence(A -> B) = P(B changes | A changes) = count(A and B) / count(A)
 *  - confidence(B -> A) = P(A changes | B changes) = count(A and B) / count(B)
 *
 * This is independent of any time window (unlike `time-window.ts`) — a pair
 * that always changes together, whether in the same commit five years apart
 * or the same commit yesterday, scores identically. Both confidence
 * directions are computed since the relationship need not be symmetric: A
 * might always drag B along (high confidence(A -> B)) while B changes far
 * more often on its own (low confidence(B -> A)).
 */

import type { AnchorGroup, RepoContext, Signal, SignalEvidence } from '../types.js';

/** Evidence label for this signal's output. */
const EVIDENCE_LABEL = 'association-rules';

/** Minimum fraction of all commits a pair must co-occur in to be reported. */
const MIN_SUPPORT = 0.1;

/** Minimum confidence, in at least one direction, for a pair to be reported. */
const MIN_CONFIDENCE = 0.6;

/**
 * Minimum number of commits a pair must actually co-occur in before support/
 * confidence are treated as meaningful. A pair that co-occurs exactly once
 * (e.g. a repo's single commit touching two files) trivially reaches
 * support=1 and confidence=1 in both directions — an artifact of there being
 * only one data point, not genuine repeated co-change evidence. Below this
 * floor the pair is skipped regardless of what the ratios say.
 */
const MIN_COOCCURRENCE_COUNT = 2;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

interface PairStats {
  pathA: string;
  pathB: string;
  count: number;
  shas: string[];
}

/**
 * Per-file occurrence counts and per-pair co-occurrence counts across the
 * whole (pre-filtered) commit history. A single pass over `ctx.commits()` —
 * per-commit file sets are de-duplicated first since `ChangedFile` is
 * hunk-level and a file could in principle appear more than once.
 */
async function collectCoChangeStats(
  ctx: RepoContext
): Promise<{ totalCommits: number; fileCounts: Map<string, number>; pairStats: Map<string, PairStats> }> {
  const commits = await ctx.commits();
  const fileCounts = new Map<string, number>();
  const pairStats = new Map<string, PairStats>();

  for (const commit of commits) {
    const paths = [...new Set(commit.files.map((file) => file.path))];
    for (const path of paths) {
      fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
    }

    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const pathA = paths[i];
        const pathB = paths[j];
        const key = pairKey(pathA, pathB);
        let stats = pairStats.get(key);
        if (!stats) {
          stats = { pathA, pathB, count: 0, shas: [] };
          pairStats.set(key, stats);
        }
        stats.count += 1;
        stats.shas.push(commit.sha);
      }
    }
  }

  return { totalCommits: commits.length, fileCounts, pairStats };
}

const associationRulesSignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const { totalCommits, fileCounts, pairStats } = await collectCoChangeStats(ctx);
  if (totalCommits === 0 || pairStats.size === 0) return [];

  const groups: AnchorGroup[] = [];

  for (const { pathA, pathB, count, shas } of pairStats.values()) {
    if (count < MIN_COOCCURRENCE_COUNT) continue;

    const support = count / totalCommits;
    if (!Number.isFinite(support) || support < MIN_SUPPORT) continue;

    const countA = fileCounts.get(pathA) ?? 0;
    const countB = fileCounts.get(pathB) ?? 0;
    // Guard against division by zero — a pair only ever appears here because
    // both files were seen in at least one commit, so countA/countB should
    // always be >= count > 0, but this keeps the computation well-defined
    // even if that invariant is ever violated.
    const confidenceAtoB = countA > 0 ? count / countA : 0;
    const confidenceBtoA = countB > 0 ? count / countB : 0;

    const maxConfidence = Math.max(confidenceAtoB, confidenceBtoA);
    if (!Number.isFinite(maxConfidence) || maxConfidence < MIN_CONFIDENCE) continue;

    // Clamp defensively (design decision 7) — support/confidence are ratios
    // of non-negative counts and are already bounded in [0, 1], but scoring
    // wants a hard guarantee no signal can hand it an out-of-range value.
    const strength = Math.min(1, Math.max(0, maxConfidence));

    const evidence: SignalEvidence = {
      signal: EVIDENCE_LABEL,
      strength,
      commits: [...new Set(shas)],
      detail:
        `support=${support.toFixed(3)}, confidence(${pathA} -> ${pathB})=${confidenceAtoB.toFixed(3)}, ` +
        `confidence(${pathB} -> ${pathA})=${confidenceBtoA.toFixed(3)} over ${totalCommits} commits`
    };

    groups.push({
      anchors: [{ path: pathA }, { path: pathB }],
      evidence: [evidence],
      score: strength
    });
  }

  return groups;
};

export default associationRulesSignal;
