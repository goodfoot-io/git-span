/**
 * Same-author edit-session signal.
 *
 * A tightened, author-scoped variant of the time-window co-edit idea (see
 * plans/initial.md's "Same-author edit-session" bullet): per individual diff
 * hunk edited by author A at time T (anchored to the hunk's line range, not
 * the whole file), opens a forward-looking `[T, T + TIGHT_WINDOW_MS]` window
 * and pairs it with every other hunk edited by that *same* author A inside
 * the window. Unlike the broader team-wide time-window signal, an edit by a
 * different author at the same instant must never match here — the whole
 * point is to isolate one person's own focused editing session (a much
 * tighter, higher-precision signal than "the team touched these files around
 * the same time").
 *
 * Hunks from the *same* commit are not paired with each other: a single
 * commit touching several files is trivial same-instant co-change already
 * covered by other signals (e.g. association-rules), not a cross-commit
 * "session" in the sense this signal targets. This also keeps the signal
 * naturally empty on a single-commit repo (design decision 9), independent
 * of the time window's width.
 *
 * Each *distinct unordered file pair* becomes one AnchorGroup, carrying the
 * hunk ranges and commits of the single strongest (closest-in-time) same-author
 * pairing between those two files. The pairing is aggregated to the file-pair
 * level rather than emitting one group per hunk-pair: on a real repository a
 * single author's busy 2h window contains thousands of hunk edits, and pairing
 * every hunk with every other hunk is O(edits²) — millions of near-duplicate
 * groups that exhaust memory before grouping runs and then collapse back onto
 * the same file-pair coupling once `grouping.ts` merges same-path anchors.
 */

import type { AnchorGroup, Commit, RepoContext, Signal, SignalEvidence } from '../types.js';

/** 2 hours — a single person's focused editing session, tighter than time-window's team-wide 6h window. */
const TIGHT_WINDOW_MS = 2 * 60 * 60 * 1000;

interface HunkEdit {
  sha: string;
  author: string;
  date: string;
  timestamp: number;
  path: string;
  startLine: number;
  endLine: number;
}

/** Flattens every commit's hunks into individual timestamped, authored edits. Skips commits with an unparseable date rather than propagating NaN into the windowing math. */
function collectEdits(commits: readonly Commit[]): HunkEdit[] {
  const edits: HunkEdit[] = [];
  for (const commit of commits) {
    const timestamp = Date.parse(commit.date);
    if (!Number.isFinite(timestamp)) continue;
    for (const file of commit.files) {
      for (const hunk of file.hunks) {
        edits.push({
          sha: commit.sha,
          author: commit.author,
          date: commit.date,
          timestamp,
          path: file.path,
          startLine: hunk.startLine,
          endLine: hunk.endLine
        });
      }
    }
  }
  return edits;
}

function formatAnchor(edit: HunkEdit): string {
  return `${edit.path}#L${edit.startLine}-${edit.endLine}`;
}

/** The strongest (closest-in-time) same-author pairing observed so far for one unordered file pair. */
interface BestPairing {
  strength: number;
  editA: HunkEdit;
  editB: HunkEdit;
  deltaMs: number;
}

/** Unordered key for a file pair, stable regardless of which edit is A vs B. */
function filePairKey(a: string, b: string): string {
  return a < b ? `${a}\x00${b}` : `${b}\x00${a}`;
}

const sameAuthorSessionSignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const commits = await ctx.commits();
  const edits = collectEdits(commits).sort((a, b) => a.timestamp - b.timestamp);

  // Aggregate to one entry per distinct file pair, keeping only the strongest
  // (closest-in-time) same-author pairing — see the module doc for why
  // per-hunk-pair emission is not viable on a real repository.
  const best = new Map<string, BestPairing>();

  for (let i = 0; i < edits.length; i++) {
    const editA = edits[i];
    for (let j = i + 1; j < edits.length; j++) {
      const editB = edits[j];
      const deltaMs = editB.timestamp - editA.timestamp;
      // edits is sorted ascending by timestamp, so deltaMs only grows as j
      // increases — once it exceeds the window, no later edit qualifies
      // either.
      if (deltaMs > TIGHT_WINDOW_MS) break;
      // A same-commit pair is trivial co-change, not a cross-commit session.
      if (editB.sha === editA.sha) continue;
      // The core constraint: a same-time edit by a different author must
      // never match, no matter how small deltaMs is.
      if (editB.author !== editA.author) continue;
      // A file's proximity to itself is not a cross-file coupling.
      if (editB.path === editA.path) continue;

      const strength = Math.min(1, Math.max(0, 1 - deltaMs / TIGHT_WINDOW_MS));

      const key = filePairKey(editA.path, editB.path);
      const existing = best.get(key);
      if (existing === undefined || strength > existing.strength) {
        best.set(key, { strength, editA, editB, deltaMs });
      }
    }
  }

  const groups: AnchorGroup[] = [];
  for (const { strength, editA, editB, deltaMs } of best.values()) {
    const commitShas = [...new Set([editA.sha, editB.sha])];

    const minutesApart = Math.round(deltaMs / 60000);
    const evidence: SignalEvidence = {
      signal: 'same-author-session',
      strength,
      commits: commitShas,
      detail: `${editA.author} edited ${formatAnchor(editA)} (${editA.date}) and ${formatAnchor(editB)} (${editB.date}) ${minutesApart} minute(s) apart, ${editA.sha} then ${editB.sha}`
    };

    groups.push({
      anchors: [
        { path: editA.path, startLine: editA.startLine, endLine: editA.endLine },
        { path: editB.path, startLine: editB.startLine, endLine: editB.endLine }
      ],
      evidence: [evidence],
      score: strength
    });
  }

  return groups;
};

export default sameAuthorSessionSignal;
