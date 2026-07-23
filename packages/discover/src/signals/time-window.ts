/**
 * Time-window co-edit signal.
 *
 * Per individual diff hunk edited at time T (anchored to the hunk's line
 * range, not the whole file), opens an unchained [T, T+6h] window and pairs
 * it with every other hunk — in any *other* commit, any file — edited inside
 * that window. Windows are per-edit and overlapping, not a partition: a
 * single hunk can appear in as many groups as there are other hunks whose
 * window catches it (from earlier) or that its own window catches (forward).
 *
 * Hunks from the *same* commit are never paired with each other here. Two
 * files touched by one commit are trivially, definitionally co-changed —
 * that fact is already fully visible from the commit itself and isn't the
 * "implicit" relationship this signal exists to surface. What this signal
 * looks for is temporal proximity *across* commit boundaries: file A edited,
 * then file B edited shortly after (or before), often by a human following
 * up on a change without an explicit code reference tying the two together.
 * This exclusion is also what makes the single-commit and shallow-clone
 * degenerate fixtures trivially empty (design decision 9): both reduce to
 * exactly one commit's worth of hunks, and a window with no *other* commit's
 * edits inside it produces no pairs.
 *
 * Each *distinct unordered file pair* becomes one AnchorGroup, carrying the
 * hunk ranges and source commits of the single strongest (closest-in-time)
 * observed pairing between those two files, with strength decaying linearly
 * from 1 (same instant) to 0 (6h apart) — closer in time is stronger evidence
 * of an implicit relationship. The pairing is aggregated to the file-pair
 * level rather than emitting one group per hunk-pair: on a real repository a
 * busy 6h window contains thousands of hunk edits, and pairing every hunk
 * with every other hunk is O(edits²) — millions of near-duplicate groups that
 * (a) exhaust memory before grouping ever runs and (b) all collapse back onto
 * the same file-pair coupling once `grouping.ts` merges same-path anchors.
 * Keeping only the strongest observation per file pair bounds the output to
 * the number of genuinely distinct co-edited file pairs while preserving the
 * range-anchored evidence and the strongest signal each pair carries.
 */

import type { AnchorGroup, Commit, RepoContext, Signal, SignalEvidence } from '../types.js';

const EVIDENCE_LABEL = 'time-window-co-edit';

/** The window width, per the plan's time-window co-edit bullet: an unchained [T, T+6h] window. */
const WINDOW_MS = 6 * 60 * 60 * 1000;

/** One diff hunk, flattened out of Commit.files for windowing/sorting. */
interface Edit {
  sha: string;
  path: string;
  startLine: number;
  endLine: number;
  timeMs: number;
}

/** Flattens every commit's hunks into individual edits, dropping any whose author date fails to parse (design decision 9: never propagate a NaN timestamp). */
function collectEdits(commits: readonly Commit[]): Edit[] {
  const edits: Edit[] = [];
  for (const commit of commits) {
    const timeMs = Date.parse(commit.date);
    if (!Number.isFinite(timeMs)) continue;
    for (const file of commit.files) {
      for (const hunk of file.hunks) {
        edits.push({ sha: commit.sha, path: file.path, startLine: hunk.startLine, endLine: hunk.endLine, timeMs });
      }
    }
  }
  return edits.sort((a, b) => a.timeMs - b.timeMs);
}

/** The strongest (closest-in-time) pairing observed so far for one unordered file pair. */
interface BestPairing {
  strength: number;
  anchorA: Edit;
  anchorB: Edit;
  deltaMs: number;
}

/** Unordered key for a file pair, stable regardless of which edit is `anchor` vs `other`. */
function filePairKey(a: string, b: string): string {
  return a < b ? `${a}\x00${b}` : `${b}\x00${a}`;
}

const timeWindowSignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  try {
    const commits = await ctx.commits();
    const edits = collectEdits(commits);
    if (edits.length < 2) return [];

    // Aggregate to one entry per distinct file pair, keeping only the strongest
    // (closest-in-time) pairing — see the module doc for why per-hunk-pair
    // emission is not viable on a real repository.
    const best = new Map<string, BestPairing>();

    for (let i = 0; i < edits.length; i++) {
      const anchor = edits[i];
      for (let j = i + 1; j < edits.length; j++) {
        const other = edits[j];
        const deltaMs = other.timeMs - anchor.timeMs;
        if (deltaMs > WINDOW_MS) break; // edits is sorted, so nothing further in j can fall inside the window either
        if (other.sha === anchor.sha) continue; // same-commit co-change isn't "implicit" — see module doc
        if (other.path === anchor.path) continue; // a file's temporal proximity to itself is not a coupling

        const strength = Math.min(1, Math.max(0, 1 - deltaMs / WINDOW_MS));
        if (!Number.isFinite(strength)) continue;

        const key = filePairKey(anchor.path, other.path);
        const existing = best.get(key);
        if (existing === undefined || strength > existing.strength) {
          best.set(key, { strength, anchorA: anchor, anchorB: other, deltaMs });
        }
      }
    }

    const groups: AnchorGroup[] = [];
    for (const { strength, anchorA, anchorB, deltaMs } of best.values()) {
      const deltaHours = deltaMs / (60 * 60 * 1000);
      const evidence: SignalEvidence = {
        signal: EVIDENCE_LABEL,
        strength,
        commits: [anchorA.sha, anchorB.sha],
        detail: `${anchorA.path} (commit ${anchorA.sha.slice(0, 7)}) and ${anchorB.path} (commit ${anchorB.sha.slice(0, 7)}) were edited ${deltaHours.toFixed(2)}h apart, inside the 6h co-edit window`
      };

      groups.push({
        anchors: [
          { path: anchorA.path, startLine: anchorA.startLine, endLine: anchorA.endLine },
          { path: anchorB.path, startLine: anchorB.startLine, endLine: anchorB.endLine }
        ],
        evidence: [evidence],
        score: strength
      });
    }

    return groups;
  } catch {
    // Design decision 9: degenerate/unreadable repos degrade to [], never a throw.
    return [];
  }
};

export default timeWindowSignal;
