/**
 * Pure anchor-matching state machine: given a live anchor address and a
 * parsed `HistoryDocument`, decide which of clean/drifted/reconciled/dangling
 * render plan applies and what content backs each side of the diff pane.
 *
 * The discriminator is **structural, not hash-based**: a `current` anchor
 * asserts real drift when it carries any of `proposed`, `recorded`,
 * `unavailable`, a non-empty `sources`, or a `diff` whose body has real hunks
 * -- never by comparing the two `index` hashes for equality, since a
 * relocation is byte-identical on both sides by design yet is exactly the
 * drift state the viewer most wants surfaced.
 *
 * Membership in history is a **lineage walk**, not a string-equality lookup:
 * a renamed anchor's live declared address matches none of its own timeline
 * entries under `path === liveAddress` (timeline `path` is the address *after*
 * that commit's change), so the shared `walkAddressLineage` helper follows
 * `rename from <old>` headers to trace the address back across rename
 * boundaries. The walk starts at the live address unless the `current` entry
 * for it is itself a rename (an uncommitted in-place re-anchor -- the CLI's
 * `rename from`/`rename to` form), in which case the committed history lives
 * under the old address and the walk starts there.
 *
 * @summary Matches live anchor addresses against `git span history` output.
 * @module spanViewer/anchorMatcher
 */

import {
  extractRenameFrom,
  hasHunks,
  isFullAddition,
  isFullDeletion,
  reconstructOriginal
} from './patchReconstruction.js';
import { formatAnchorAddress } from './spanFileGrammar.js';
import type { AnchorPlan, CurrentAnchor, HistoryCommit, HistoryDocument, LiveAnchor, TimelineAnchor } from './types.js';

const RENAME_FROM = /^rename from (.+)$/m;
const RANGE_START = /#L(\d+)-L\d+$/;

/**
 * One commit matched by a lineage walk: the address being tracked when the
 * entry matched (the entry's own `path`, i.e. the address *after* that
 * commit's change) and the entry itself.
 */
export interface LineageMatch {
  commit: HistoryCommit;
  commitIndex: number;
  address: string;
  /**
   * The content block at that address when one exists, else the rebound
   * block -- so a rebind-plus-edit commit is represented by the block whose
   * `diff` carries the real hunks, and a rebound-only commit still counts as
   * "this address has history".
   */
  anchor: TimelineAnchor;
}

/**
 * Walk an anchor address's timeline newest-to-oldest, following `rename from
 * <old>` headers to trace the address across rename boundaries.
 *
 * The walk starts at `liveAddress` unless the anchor's `current` entry is
 * itself a rename: a re-anchor edits the worktree declaration's address
 * without committing, so no timeline entry ever wears the declared address --
 * the committed history lives under the `rename from` address and the walk
 * must start there or the anchor's entire lineage is invisible.
 *
 * @param commits - The history document's commits, newest-first.
 * @param liveAddress - The anchor's current declared address.
 * @param currentEntry - The `current.anchors[]` entry for `liveAddress`, when
 *   one exists; its rename header, if any, names the address the committed
 *   history lives under.
 * @returns One match per commit that touches the tracked lineage, newest
 *   first; `address` is the tracked address at that commit.
 */
export function walkAddressLineage(
  commits: HistoryCommit[],
  liveAddress: string,
  currentEntry?: CurrentAnchor
): LineageMatch[] {
  const matches: LineageMatch[] = [];
  let tracked = extractRenameFrom(currentEntry?.diff ?? '') ?? liveAddress;
  commits.forEach((commit, commitIndex) => {
    const contentEntry = commit.anchors.find((anchor) => anchor.path === tracked && anchor.rebound === undefined);
    const entry = contentEntry ?? commit.anchors.find((anchor) => anchor.path === tracked);
    if (entry === undefined) {
      return;
    }
    matches.push({ commit, commitIndex, address: tracked, anchor: entry });
    const renameFrom = RENAME_FROM.exec(entry.diff ?? '')?.[1];
    if (renameFrom !== undefined) {
      tracked = renameFrom;
    }
  });
  return matches;
}

/**
 * The extent's first line for an anchor address: the declared range start
 * (`#Lstart`), or 1 for a whole-file anchor. This is the CLI's own
 * `first_line` -- the offset its hunk headers were rendered against.
 *
 * @param address - An anchor address such as `web/checkout.tsx#L10-L12`.
 * @returns The 1-based first line of the anchored extent.
 */
export function extentStartLineOf(address: string): number {
  const match = RANGE_START.exec(address);
  return match === null ? 1 : Number(match[1]);
}

/**
 * Whether a `current` anchor asserts real drift -- carrying any of the
 * structural signals, or a `diff` whose body has real hunks. A block with
 * none of these asserts nothing (e.g. an identical-hash, no-hunk, field-empty
 * block) and is treated as absent.
 *
 * @param entry - The `current.anchors[]` entry for the live address.
 * @returns Whether the entry asserts drift.
 */
export function signalsDrift(entry: CurrentAnchor): boolean {
  return (
    entry.proposed !== undefined ||
    entry.recorded !== undefined ||
    entry.unavailable !== undefined ||
    (entry.sources !== undefined && entry.sources.length > 0) ||
    /^@@ /m.test(entry.diff)
  );
}

/**
 * Match a single live anchor address against a history document.
 *
 * Classification matrix (v2, per the plan): `has-history` comes from the
 * lineage walk, and whether a `current` entry exists comes from the
 * structural drift discriminator:
 * - neither: `dangling`
 * - history only: `clean` (content read from the workspace file, Phase D)
 * - both: `drifted`/`relocated`/`unavailable` per the current entry's shape
 * - current only: `reconciled` (declared and immediately drifted before any
 *   commit touched it)
 *
 * @param liveAddress - The anchor's current header address (e.g. from
 *   `formatAnchorAddress`), as found in the live `.span/*` file.
 * @param history - The parsed history document for this span.
 * @returns The render plan for this anchor.
 * @throws {ReconstructionError} When ordinary drift's `diff` cannot be
 *   reverse-applied onto its `content` (the pair the CLI certified disagrees).
 */
export function matchAnchor(liveAddress: string, history: HistoryDocument): AnchorPlan {
  const currentEntry = history.current?.anchors.find((anchor) => anchor.path === liveAddress);
  const hasLineage = walkAddressLineage(history.commits, liveAddress, currentEntry).length > 0;

  if (currentEntry === undefined || !signalsDrift(currentEntry)) {
    return hasLineage ? { kind: 'clean' } : { kind: 'dangling' };
  }

  if (currentEntry.unavailable !== undefined) {
    return { kind: 'unavailable', reason: currentEntry.unavailable };
  }
  if (currentEntry.recorded !== undefined) {
    return { kind: 'unavailable', reason: 'unrecoverable' };
  }
  if (currentEntry.content === undefined) {
    // The parser enforces "content present exactly when unavailable is
    // absent"; reaching here means a payload the parser already rejected.
    return { kind: 'unavailable', reason: 'absent' };
  }
  if (currentEntry.proposed !== undefined) {
    const plan: AnchorPlan = {
      kind: 'relocated',
      content: currentEntry.content,
      proposed: currentEntry.proposed
    };
    if (currentEntry.sources !== undefined) {
      plan.sources = currentEntry.sources;
    }
    return plan;
  }
  if (isFullDeletion(currentEntry.diff)) {
    return { kind: 'drifted', historical: currentEntry.content, current: null };
  }
  if (isFullAddition(currentEntry.diff)) {
    return { kind: 'drifted', historical: null, current: currentEntry.content };
  }
  if (!hasLineage) {
    return { kind: 'reconciled', historical: null, current: currentEntry.content };
  }
  if (!hasHunks(currentEntry.diff)) {
    // Header-only diff with content: a committed-but-unreconciled anchor whose
    // recorded hash is stale while the bytes are byte-identical -- the drift
    // sources are non-empty so the anchor IS drifted, but the diff has no
    // hunks because the content never changed, so the historical side is the
    // content itself. Reconstructing would throw on the empty hunk list.
    return { kind: 'drifted', historical: currentEntry.content, current: currentEntry.content };
  }
  // A rename block's old side lives in the old address's line space and its
  // new side in the declared address's, so each side rebases against its own
  // extent start -- exactly like the ladder's rename rung does.
  const renameFrom = extractRenameFrom(currentEntry.diff);
  return {
    kind: 'drifted',
    historical: reconstructOriginal(
      currentEntry.diff,
      currentEntry.content,
      extentStartLineOf(liveAddress),
      renameFrom === undefined ? extentStartLineOf(liveAddress) : extentStartLineOf(renameFrom)
    ),
    current: currentEntry.content
  };
}

/**
 * Match every live anchor in a span file against a history document.
 *
 * @param liveAnchors - Anchors read from the live `.span/*` file, in file order.
 * @param history - The parsed history document for this span.
 * @returns One render plan per anchor, in the same order as `liveAnchors`.
 * @throws {ReconstructionError} When any anchor's ordinary-drift `diff`
 *   cannot be reverse-applied onto its `content`.
 */
export function matchAllAnchors(liveAnchors: LiveAnchor[], history: HistoryDocument): AnchorPlan[] {
  return liveAnchors.map((anchor) => matchAnchor(formatAnchorAddress(anchor.path, anchor.range), history));
}
