/**
 * Pure anchor-matching state machine: given a live anchor address and a
 * parsed `HistoryDocument`, decide which of clean/drifted/reconciled/dangling
 * render plan applies and what content backs each side of the diff pane.
 *
 * @summary Matches live anchor addresses against `git span history` output.
 * @module spanViewer/anchorMatcher
 */

import { formatAnchorAddress } from './spanFileGrammar.js';
import type { AnchorPlan, HistoryDocument, LiveAnchor } from './types.js';

/**
 * Match a single live anchor address against a history document.
 *
 * @param liveAddress - The anchor's current header address (e.g. from
 *   `formatAnchorAddress`), as found in the live `.span/*` file.
 * @param history - The parsed history document for this span.
 * @returns The render plan for this anchor.
 * @throws Never.
 */
export function matchAnchor(liveAddress: string, history: HistoryDocument): AnchorPlan {
  const currentEntry = history.current?.anchors.find((anchor) => anchor.path === liveAddress);

  let mostRecentEvent: 'added' | 'modified' | 'removed' | undefined;
  let mostRecentContent: string | undefined;
  outer: for (const commit of history.commits) {
    for (const anchor of commit.anchors) {
      if (anchor.path === liveAddress) {
        mostRecentEvent = anchor.event;
        mostRecentContent = anchor.content;
        break outer;
      }
    }
  }

  if (mostRecentEvent === 'added' || mostRecentEvent === 'modified') {
    if (currentEntry !== undefined) {
      return { kind: 'drifted', historical: mostRecentContent ?? null, current: currentEntry.content ?? null };
    }
    return { kind: 'clean', content: mostRecentContent ?? '' };
  }

  if (mostRecentEvent === undefined && currentEntry !== undefined) {
    return { kind: 'reconciled', historical: null, current: currentEntry.content ?? null };
  }

  return { kind: 'dangling' };
}

/**
 * Match every live anchor in a span file against a history document.
 *
 * @param liveAnchors - Anchors read from the live `.span/*` file, in file order.
 * @param history - The parsed history document for this span.
 * @returns One render plan per anchor, in the same order as `liveAnchors`.
 * @throws Never.
 */
export function matchAllAnchors(liveAnchors: LiveAnchor[], history: HistoryDocument): AnchorPlan[] {
  return liveAnchors.map((anchor) => matchAnchor(formatAnchorAddress(anchor.path, anchor.range), history));
}
