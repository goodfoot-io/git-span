/**
 * Timeline snapshot ladder for one anchor address.
 *
 * Walks `commits[].anchors[]` newest-to-oldest threading a single running
 * snapshot, producing one `(original, modified)` pair per commit that touches
 * the anchor's lineage. This is the pure-logic backing for the history
 * accordion (Phase D); it never invokes git and never fetches content from
 * outside the certified JSON payload.
 *
 * **Seeding**: on the drifted branch, `current.content` is today's worktree
 * extent -- the one value guaranteed *not* to equal the post-newest-commit
 * state the walk must start from -- so one `reconstructOriginal` call on the
 * `current` block's own diff recovers the true seed before the walk begins.
 * On the not-drifted branch the caller's disk-read clean content already is
 * that state and seeds directly.
 *
 * **Rungs**: a first-add supplies `content` directly and terminates (the
 * origin needs no reconstruction); a full addition/deletion (a `/dev/null`
 * side) is resolved directly from the diff's own real side and terminates;
 * an ordinary in-place edit reverse-applies that commit's own `diff` onto the
 * running snapshot -- the result is both that commit's rendered original side
 * and the new running snapshot. A rebound-only block contributes no content
 * and is skipped without breaking the walk. `extentStartLine` at each rung
 * comes from whichever address is currently tracked there (via
 * `walkAddressLineage`), never from the live anchor's declared range -- a
 * rename boundary changes the address, and each rung's hunks were rebased
 * against its own recorded `#Lstart`.
 *
 * **Failure isolation is truncation**: the walk is sequential -- an older
 * rung's only input is the newer rung's output -- so a throw stops the ladder
 * at that hop. Newer rungs already computed survive; a seed-recovery failure
 * (rung zero) leaves no rungs at all.
 *
 * @summary Builds per-commit (original, modified) pairs for one anchor.
 * @module spanViewer/historySnapshotLadder
 */

import { extentStartLineOf, walkAddressLineage } from './anchorMatcher.js';
import { extractHunkSide, isFullAddition, isFullDeletion, reconstructOriginal } from './patchReconstruction.js';
import type { CurrentAnchor, HistoryCommit } from './types.js';

/** One commit's rendered pair, or a marker that the walk stopped there. */
export interface LadderRung {
  hash: string;
  date: string;
  summary: string;
  original: string;
  modified: string;
  /** Present when the walk stopped at this rung; nothing older is rendered. */
  truncatedAt?: true;
}

/** The result of a ladder walk: newer-to-older rungs plus a truncation flag. */
export interface HistorySnapshotLadderResult {
  rungs: LadderRung[];
  truncated: boolean;
}

/** Options for {@link buildHistorySnapshotLadder}. */
export interface BuildHistorySnapshotLadderOptions {
  /** The anchor's live declared address, where the walk starts. */
  liveAddress: string;
  /** The history document's commits, newest-first. */
  commits: HistoryCommit[];
  /**
   * The `current.anchors[]` entry for this address when the anchor is
   * drifted; absent when it is clean, in which case `seedContent` is already
   * the post-newest-commit state.
   */
  current?: CurrentAnchor;
  /**
   * Disk-read clean content: the seed used on the not-drifted branch, where
   * it is the post-newest-commit state by definition.
   */
  seedContent: string;
}

/**
 * Build the snapshot ladder for one anchor address.
 *
 * @param options - The address, commits, optional drifted `current` entry,
 *   and clean-content seed.
 * @returns Newer-to-older rungs and whether the walk truncated.
 */
export function buildHistorySnapshotLadder(options: BuildHistorySnapshotLadderOptions): HistorySnapshotLadderResult {
  const { liveAddress, commits, current, seedContent } = options;

  let running: string;
  if (current === undefined) {
    running = seedContent;
  } else if (current.content === undefined) {
    // Drifted with no readable content (unavailable/recorded): there is no
    // post-image to seed from, so no rung can be resolved.
    return { rungs: [], truncated: true };
  } else {
    try {
      running = reconstructOriginal(current.diff, current.content, extentStartLineOf(liveAddress));
    } catch {
      // Seed-recovery failure is rung zero: the whole ladder is unavailable.
      return { rungs: [], truncated: true };
    }
  }

  const rungs: LadderRung[] = [];
  let truncated = false;
  for (const match of walkAddressLineage(commits, liveAddress)) {
    const { anchor, address, commit } = match;
    const extentStartLine = extentStartLineOf(address);

    if (anchor.rebound !== undefined) {
      // Rebound-only block: no sibling content block at this (path, block
      // form), so it contributes no content -- skip without breaking the walk.
      continue;
    }
    if (anchor.content !== undefined) {
      // First-add: the origin supplies its snapshot directly and the walk
      // terminates -- there is nothing older to reconstruct.
      rungs.push({
        hash: commit.hash,
        date: commit.date,
        summary: commit.summary,
        original: '',
        modified: anchor.content
      });
      return { rungs, truncated };
    }
    if (anchor.diff === undefined) {
      // Unreachable: the parser enforces exactly one of content/diff.
      rungs.push({
        hash: commit.hash,
        date: commit.date,
        summary: commit.summary,
        original: '',
        modified: '',
        truncatedAt: true
      });
      truncated = true;
      break;
    }

    const diff = anchor.diff;
    if (isFullDeletion(diff)) {
      let original: string;
      try {
        original = extractHunkSide(diff, 'old');
      } catch {
        rungs.push({
          hash: commit.hash,
          date: commit.date,
          summary: commit.summary,
          original: '',
          modified: '',
          truncatedAt: true
        });
        return { rungs, truncated: true };
      }
      rungs.push({ hash: commit.hash, date: commit.date, summary: commit.summary, original, modified: '' });
      return { rungs, truncated };
    }
    if (isFullAddition(diff)) {
      let modified: string;
      try {
        modified = extractHunkSide(diff, 'new');
      } catch {
        rungs.push({
          hash: commit.hash,
          date: commit.date,
          summary: commit.summary,
          original: '',
          modified: '',
          truncatedAt: true
        });
        return { rungs, truncated: true };
      }
      rungs.push({ hash: commit.hash, date: commit.date, summary: commit.summary, original: '', modified });
      return { rungs, truncated };
    }

    try {
      const original = reconstructOriginal(diff, running, extentStartLine);
      rungs.push({ hash: commit.hash, date: commit.date, summary: commit.summary, original, modified: running });
      running = original;
    } catch {
      // One bad hunk truncates the tail of this anchor's history: newer
      // rungs are already computed and survive; nothing older can be
      // resolved without a non-stale snapshot.
      rungs.push({
        hash: commit.hash,
        date: commit.date,
        summary: commit.summary,
        original: '',
        modified: '',
        truncatedAt: true
      });
      truncated = true;
      break;
    }
  }

  return { rungs, truncated };
}
