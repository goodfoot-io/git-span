/**
 * The disclosure chevron's codicon class for a collapsible card.
 *
 * Lives in its own module for two reasons. It is the single source of truth
 * for the two class strings, so a card's initial render and its `toggle`
 * handler cannot drift apart and leave a chevron pointing the wrong way. And
 * it is DOM-free, so it is exercisable from the extension host's test runner,
 * which has no DOM.
 *
 * The right/down pair is what VS Code's own multi-diff editor uses for this
 * exact control -- `diffEditorItemTemplate.ts` picks `Codicon.chevronRight`
 * when collapsed and `Codicon.chevronDown` when expanded -- so the span
 * viewer's cards read as the same affordance.
 *
 * @summary Maps a card's open state to its disclosure-chevron codicon class.
 * @module spanViewer/webview/disclosureIcon
 */

/** Class attribute for an expanded card's chevron. */
const EXPANDED_CHEVRON = 'codicon codicon-chevron-down';

/** Class attribute for a collapsed card's chevron. */
const COLLAPSED_CHEVRON = 'codicon codicon-chevron-right';

/**
 * The full `class` attribute a disclosure chevron wears at a given open state.
 *
 * Returns the whole attribute rather than a modifier suffix so callers assign
 * it directly to `className`, which is what keeps the expanded and collapsed
 * forms from being spelled independently at the two call sites.
 *
 * @param open - Whether the card is currently expanded.
 * @returns The `class` value for the chevron element.
 * @throws Never.
 */
export function disclosureIconClass(open: boolean): string {
  return open ? EXPANDED_CHEVRON : COLLAPSED_CHEVRON;
}
