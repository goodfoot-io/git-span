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
 * state the walk must start from. A `reconstructOriginal` call on the
 * `current` block's own diff recovers the **recorded** state: the content the
 * declaration's recorded token names, i.e. the anchor's state as of the last
 * commit where it was recorded or re-anchored. When the declaration is fresh
 * (recorded at the newest commit), that state *is* the post-newest-commit
 * state and seeds directly. When it is drifted -- the CLI's own default
 * `drift --fix` posture, a user who records once and then keeps editing
 * without re-anchoring -- the recorded state is older than the newest commit,
 * so the walk's first reverse-apply would fail its post-image match against
 * it and truncate at rung zero. The fix threads the recorded state FORWARD
 * through the lineage first: each diff whose pre-region matches the running
 * text chains forward onto it, one whose pre-region does not was committed
 * at-or-before the recording (the running text is already that commit's
 * post-state) and is skipped, and a committed full re-add fills the running
 * text with the diff's own new side -- the delete-then-re-add cycle advances
 * the recorded state to the re-created bytes. A committed full deletion is
 * skipped instead: it never contributes to the threaded value, because a
 * re-add newer than it fills the running text from its own side regardless
 * and a deletion-newest rung resolves its own old side in the walk without
 * the seed -- and advancing through it would clobber a fresh seed that
 * already postdates the deletion. The threaded result is the true
 * post-newest-commit state -- it agrees with the recording
 * state everywhere no later commit changed anything, and with each later
 * commit's post-state inside that commit's own hunks. Two shapes short-circuit
 * the recovery: a full-deletion diff carries the recorded bytes as its own
 * old side (`current.content`, or the diff's `-` lines when the live side is
 * unreadable -- threaded forward through the lineage like the reconstruction
 * recovery, so a drifted declaration whose file was deleted from the worktree
 * still reaches the post-newest-commit state), and a header-only diff (a
 * relocation, or a rename whose content is unchanged) proves the bytes did
 * not change, so `current.content` is the seed. Every seed path threads
 * forward, not only the reconstruction recovery: the not-drifted branch's
 * disk-read clean content and the two short-circuit branches' `current.content`
 * are also only the post-newest-commit state when the declaration is fresh --
 * a committed-but-unreconciled anchor reads back the recorded (c1-era) bytes,
 * older than the newest commit, and needs the same forward threading (safe
 * when fresh, because every pre-recording diff then skips on pre-region
 * mismatch).
 *
 * **Rungs**: a first-add supplies `content` directly and terminates (the
 * origin needs no reconstruction) -- unless the commit's `span_diff` declares
 * a same-token re-anchor into the block's address, which makes the block a
 * RE-ANCHOR destination rather than the origin: the rung renders the
 * delete+add pair the CLI emits for a committed re-anchor whose target bytes
 * differ (`original` = the same commit's full-deletion block's old side at
 * the old address, `modified` = the block's content) and the walk crosses
 * into the old address's lineage instead of terminating; a full
 * addition/deletion (a `/dev/null` side) is resolved directly from the
 * diff's own real side -- the walk terminates there only when the rung is
 * the lineage origin, and otherwise continues through it (a committed
 * delete-then-re-add at the same address renders the deletion and record
 * rungs below instead of dropping them silently); a pure rename (rename
 * headers, no hunks) changes no bytes and renders
 * `original = modified = running` while the walk crosses the address boundary
 * (an empty `running` -- the raced-clean fallback's empty seed --
 * fails that rung closed with a `truncatedAt` marker rather than a silent
 * empty pair); an ordinary in-place edit reverse-applies that commit's own
 * `diff` onto the running snapshot -- the result is both that commit's
 * rendered original side and the new running snapshot. A rename-and-edit
 * block rebases each hunk side against its own address's extent start. A
 * rebound-only block contributes no content and is skipped without breaking
 * the walk. `extentStartLine` at each rung
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

import { extentStartLineOf, type LineageMatch, walkAddressLineage } from './anchorMatcher.js';
import {
  applyDiffForward,
  extractHunkSide,
  extractRenameFrom,
  hasHunks,
  isFullAddition,
  isFullDeletion,
  ReconstructionError,
  reconstructOriginal
} from './patchReconstruction.js';
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
   * The `current` block's `span_diff`, when the declaration has an uncommitted
   * edit: a byte-identical re-anchor (the CLI's `drift --fix` output) is
   * non-reportable, so `current.anchors` is empty and this diff is the only
   * trace that the committed history lives under the move's source address.
   */
  currentSpanDiff?: string;
  /**
   * Disk-read clean content: the seed used on the not-drifted branch, where
   * it is the post-newest-commit state by definition.
   */
  seedContent: string;
}

/**
 * Thread a recorded state forward through the anchor's lineage (oldest-first)
 * to recover the post-newest-commit state the backward walk must seed from.
 *
 * The recorded state is the anchor's content as of the last commit where it
 * was recorded or re-anchored. Every committed diff after that point chains
 * forward from it -- its pre-region equals the running text -- so
 * `applyDiffForward` advances the running snapshot through them; a diff whose
 * pre-region does not match was committed at-or-before the recording (the
 * running text already is that commit's post-state) and is skipped. A
 * committed full re-add carries no chainable pre-region, but it still moves
 * the running text by construction -- the delete-then-re-add cycle's forward
 * motion comes from the re-add's own new side -- so the threading advances
 * through it unconditionally. A committed full deletion is skipped: it never
 * contributes to the threaded value (a re-add newer than it overwrites the
 * running text from its own side, and a deletion-newest rung resolves its own
 * old side in the walk without the seed), and advancing through it would
 * clobber a fresh seed that already postdates the deletion. A first-add
 * (recorded before the origin) and a rename or rebound block change no bytes
 * and are skipped. A diff that should chain but does not (a recorded state outside
 * this timeline) leaves the running text too old, and the backward walk's own
 * post-image match fails closed at rung zero rather than rendering a
 * fabricated history.
 *
 * @param recorded - The state the declaration's recorded token names.
 * @param lineage - The anchor's lineage matches, newest-first (as returned by
 *   `walkAddressLineage`); iterated oldest-first here.
 * @returns The threaded post-newest-commit state.
 * @throws {ReconstructionError} Never -- `applyDiffForward` raises only
 *   `ReconstructionError` (a pre-region mismatch is a skip, not a fault);
 *   malformed-address errors from `extentStartLineOf` rethrow and the caller
 *   fails closed into truncation.
 */
function threadForward(recorded: string, lineage: LineageMatch[]): string {
  let running = recorded;
  for (let index = lineage.length - 1; index >= 0; index--) {
    const match = lineage[index];
    if (match === undefined) {
      continue;
    }
    const { anchor, address } = match;
    if (anchor.rebound !== undefined || anchor.content !== undefined || anchor.diff === undefined) {
      // Rebound-only block: no content. First-add: the origin predates the
      // recording. Both change nothing the threading can advance through.
      continue;
    }
    const diff = anchor.diff;
    if (isFullDeletion(diff)) {
      // A committed full deletion empties the file but never contributes to
      // the threaded value: a re-add newer than it fills the running text
      // from its own side regardless, and a deletion-newest rung resolves
      // its own old side in the walk without the seed. Advancing through it
      // would clobber a fresh seed that already postdates the deletion.
      continue;
    }
    if (isFullAddition(diff)) {
      // A committed full addition (re-)creates the content: threading
      // forward, the running state after this commit is the diff's own new
      // side. Same no-pre-region reasoning as the deletion: the delete-then-
      // re-add cycle must advance the recorded state to the re-created bytes.
      running = extractHunkSide(diff, 'new');
      continue;
    }
    if (!hasHunks(diff)) {
      // A header-only block (a pure rename, a relocation) changes no bytes.
      continue;
    }
    const extentStartLine = extentStartLineOf(address);
    const renameFrom = extractRenameFrom(diff);
    // A diff whose pre-region does not match the running text was committed
    // at-or-before the recording (the running text already is that commit's
    // post-state): skip it and keep threading the newer commits.
    try {
      running = applyDiffForward(
        diff,
        running,
        extentStartLine,
        renameFrom === undefined ? extentStartLine : extentStartLineOf(renameFrom)
      );
    } catch (error) {
      // A pre-region mismatch is the skip signal; anything else (only
      // malformed-address errors from `extentStartLineOf` can be) rethrows so
      // the caller fails closed into truncation instead of skipping a defect.
      if (error instanceof ReconstructionError) {
        continue;
      }
      throw error;
    }
  }
  return running;
}

/**
 * Build the snapshot ladder for one anchor address.
 *
 * @param options - The address, commits, optional drifted `current` entry,
 *   and clean-content seed.
 * @returns Newer-to-older rungs and whether the walk truncated.
 */
export function buildHistorySnapshotLadder(options: BuildHistorySnapshotLadderOptions): HistorySnapshotLadderResult {
  const { liveAddress, commits, current, currentSpanDiff, seedContent } = options;

  // An uncommitted re-anchor makes the `current` entry itself a rename, and
  // the committed history lives under its `rename from` address -- the walk
  // must start there or the whole lineage is invisible (see
  // `walkAddressLineage`). The same holds when the re-anchor is
  // byte-identical: the CLI reports nothing under `current.anchors`, and
  // `current.span_diff`'s same-token address move is the only trace.
  const lineage = walkAddressLineage(commits, liveAddress, current, currentSpanDiff);

  let running: string;
  if (current === undefined) {
    // Disk-read clean content is normally the post-newest-commit state by
    // definition -- but a committed-but-unreconciled anchor (recorded at c1,
    // edited and committed at c2 without re-anchoring, worktree reverted to
    // the recorded bytes) reads back the c1-era bytes, OLDER than the newest
    // commit. Thread the seed forward through the lineage like the drifted
    // branches below: on a fresh anchor every pre-recording diff skips on
    // pre-region mismatch and the seed passes through unchanged.
    try {
      running = threadForward(seedContent, lineage);
    } catch {
      return { rungs: [], truncated: true };
    }
  } else if (current.content === undefined) {
    if (isFullDeletion(current.diff)) {
      // Deleted anchor: the live bytes are gone, so there is no post-image to
      // seed from -- but the diff's own old side carries the recorded bytes
      // (the walk's full-deletion rung resolves directly from its own diff,
      // and an older edit rung reverse-applies onto the recovered bytes).
      // Thread the recorded bytes forward through the lineage exactly like the
      // reconstruction recovery above: on a drifted declaration (recorded before
      // newer committed edits) that recovers the post-newest-commit state the
      // backward walk must seed from, instead of failing the newest rung's
      // post-image match against the c1-era recorded bytes.
      try {
        running = threadForward(extractHunkSide(current.diff, 'old'), lineage);
      } catch {
        return { rungs: [], truncated: true };
      }
    } else {
      // Drifted with no readable content (unavailable/recorded): there is no
      // post-image to seed from, so no rung can be resolved.
      return { rungs: [], truncated: true };
    }
  } else if (isFullDeletion(current.diff) || !hasHunks(current.diff)) {
    // Full deletion: `content` IS the recorded bytes -- the post-newest-commit
    // state the walk seeds from. Header-only diff (a relocation, or a rename
    // whose content is unchanged): the bytes did not change, so `content` is
    // the seed. Either way `content` can be OLDER than the newest commit when
    // the declaration is drifted (recorded once, edited without re-anchoring),
    // so thread it forward through the lineage exactly like the clean branch
    // above -- on a fresh declaration every pre-recording diff skips on
    // pre-region mismatch and the seed passes through unchanged.
    try {
      running = threadForward(current.content, lineage);
    } catch {
      return { rungs: [], truncated: true };
    }
  } else {
    // Ordinary in-place drift. Recover the recorded state (the content the
    // declaration's recorded token names), then thread it forward through the
    // lineage: on a fresh declaration that state already is the
    // post-newest-commit state, and on a drifted one the threading advances it
    // through every commit newer than the recording (see the module doc). A
    // rename block's old side lives in the old address's line space, so it
    // rebases against the rename-from extent start like the ladder's rename
    // rungs do.
    try {
      const renameFrom = extractRenameFrom(current.diff);
      running = threadForward(
        reconstructOriginal(
          current.diff,
          current.content,
          extentStartLineOf(liveAddress),
          renameFrom === undefined ? extentStartLineOf(liveAddress) : extentStartLineOf(renameFrom)
        ),
        lineage
      );
    } catch {
      // Seed-recovery failure is rung zero: the whole ladder is unavailable.
      return { rungs: [], truncated: true };
    }
  }

  const rungs: LadderRung[] = [];
  let truncated = false;
  for (const match of lineage) {
    const { anchor, address, commit } = match;
    const extentStartLine = extentStartLineOf(address);

    if (anchor.rebound !== undefined) {
      // Rebound-only block: no sibling content block at this (path, block
      // form), so it contributes no content -- skip without breaking the walk.
      continue;
    }
    if (anchor.content !== undefined) {
      // A first-add content block terminates the walk when it is the lineage
      // origin. When the commit's span_diff re-anchored this token here from
      // `crossedFrom` (a committed re-anchor whose target bytes differ
      // renders as this content block plus a full deletion at the old
      // address, with no rename headers anywhere), the block is a RE-ANCHOR
      // destination, not the origin: the same commit's deletion at
      // crossedFrom carries the pre-commit bytes -- the rung's original side
      // and the state the older walk continues from -- so the walk crosses
      // the delete+add pair instead of terminating.
      const crossedFrom = match.crossedFrom;
      if (crossedFrom !== undefined) {
        const siblingDeletion = commit.anchors.find(
          (candidate) =>
            candidate.path === crossedFrom && candidate.diff !== undefined && isFullDeletion(candidate.diff)
        );
        if (siblingDeletion?.diff !== undefined) {
          let original: string;
          try {
            original = extractHunkSide(siblingDeletion.diff, 'old');
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
          rungs.push({
            hash: commit.hash,
            date: commit.date,
            summary: commit.summary,
            original,
            modified: anchor.content
          });
          running = original;
          continue;
        }
      }
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
      // The deleted bytes are the state the older walk continues from. The
      // rung is the lineage origin only when nothing older matched; a
      // committed delete-then-re-add at the same address renders the record
      // rung below instead of dropping it silently.
      running = original;
      continue;
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
      // A full addition is the anchor's origin only when it is the oldest
      // lineage match; a committed delete-then-re-add at the same address
      // produces a mid-lineage addition, and the deletion and record rungs
      // below resolve from their own diff side and content -- so the walk
      // continues instead of silently dropping them.
      running = modified;
      continue;
    }
    const renameFrom = extractRenameFrom(diff);
    if (renameFrom !== undefined && !hasHunks(diff)) {
      // Pure rename: the move changes no bytes, so the running snapshot is
      // both the original and the modified side; the walk continues across
      // the address boundary on the old address. An empty running snapshot
      // (the raced-clean fallback's empty seed) cannot back a rename rung's
      // content -- it would silently render an empty pair -- so the rung
      // fails closed with a marker, like the edit rungs' reconstruction
      // failures.
      if (running === '') {
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
      rungs.push({
        hash: commit.hash,
        date: commit.date,
        summary: commit.summary,
        original: running,
        modified: running
      });
      continue;
    }

    try {
      // A rename-and-edit block's old side lives in the old address's line
      // space and its new side in the new address's, so each side rebases
      // against its own extent start.
      const original = reconstructOriginal(
        diff,
        running,
        extentStartLine,
        renameFrom === undefined ? extentStartLine : extentStartLineOf(renameFrom)
      );
      rungs.push({ hash: commit.hash, date: commit.date, summary: commit.summary, original, modified: running });
      running = original;
    } catch {
      // One bad hunk truncates the tail of this anchor's history: newer
      // rungs are already computed and survive; nothing older can be
      // resolved without a non-drifted snapshot.
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
