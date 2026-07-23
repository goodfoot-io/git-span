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

const sameAuthorSessionSignal: Signal = async (ctx: RepoContext): Promise<AnchorGroup[]> => {
  const commits = await ctx.commits();
  const edits = collectEdits(commits).sort((a, b) => a.timestamp - b.timestamp);
  const groups: AnchorGroup[] = [];

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

      const strength = Math.min(1, Math.max(0, 1 - deltaMs / TIGHT_WINDOW_MS));
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
  }

  return groups;
};

export default sameAuthorSessionSignal;
