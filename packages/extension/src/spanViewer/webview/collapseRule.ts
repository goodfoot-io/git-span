/**
 * The rule deciding whether a span-viewer card starts collapsed.
 *
 * Cards never scroll internally -- an embedded editor is always sized to its
 * full rendered content -- so an unbounded card would otherwise push the rest
 * of the document off-screen. Cards taller than {@linkcode
 * COLLAPSE_THRESHOLD_LINES} therefore start closed and the reader opens the
 * ones they want.
 *
 * The threshold is measured against *rendered* height, not the raw line count
 * of the underlying text: a large anchor whose diff `hideUnchangedRegions` has
 * squeezed below the threshold stays open, because what matters is how much
 * page the card actually occupies.
 *
 * Kept free of Monaco and DOM imports so it runs in the extension host, where
 * the test suite executes and no DOM exists.
 *
 * @summary Rendered-height threshold deciding a card's initial open state.
 * @module spanViewer/webview/collapseRule
 */

/** Monaco's default line height in px; the unit the threshold is expressed in. */
export const LINE_HEIGHT = 18;

/** Rendered content taller than this many lines starts its card collapsed. */
export const COLLAPSE_THRESHOLD_LINES = 10;

/**
 * Whether a card whose body renders at `contentHeight` px starts collapsed.
 *
 * Non-finite and negative heights mean the body could not be measured. Those
 * resolve to `false` (start open) deliberately: showing content that could
 * have been hidden is recoverable by one click, whereas hiding content because
 * a measurement failed leaves the reader with no signal that anything is
 * there.
 *
 * @param contentHeight - The body's rendered height in px.
 * @param lineHeight - Px per line; defaults to {@linkcode LINE_HEIGHT}.
 * @param thresholdLines - Lines allowed before collapsing; defaults to
 *   {@linkcode COLLAPSE_THRESHOLD_LINES}.
 * @returns True when the card should start collapsed.
 * @throws Never.
 */
export function shouldCollapse(
  contentHeight: number,
  lineHeight: number = LINE_HEIGHT,
  thresholdLines: number = COLLAPSE_THRESHOLD_LINES
): boolean {
  if (!Number.isFinite(contentHeight) || contentHeight < 0) {
    return false;
  }
  return contentHeight > thresholdLines * lineHeight;
}
