/**
 * The file-absolute first line of an anchor address's extent.
 *
 * A relocated anchor is the one card whose rendered bytes do not live at its
 * declared range: `range` is where the anchor was declared, `proposed` is
 * where the resolver found the block, and `content` is the block at
 * `proposed`. Numbering that content against `range` would print a confident
 * wrong file location -- worse than Monaco's default from-1 numbering, which
 * at least reads as local coordinates. The gutter therefore takes its offset
 * from the proposed address, which is only ever available as an address
 * string.
 *
 * Lives in its own module because it is DOM-free and therefore exercisable
 * from the extension host's test runner, which has no DOM.
 *
 * @summary Parses an anchor address's extent start line.
 * @module spanViewer/webview/addressStartLine
 */

/** The `#L<start>` fragment of an anchor address. */
const RANGE_START = /#L(\d+)/;

/**
 * The 1-based first line of the extent an address names.
 *
 * A whole-file address carries no `#L` fragment and starts at line 1, which is
 * also Monaco's default numbering, so the whole-file case needs no special
 * handling at the call site.
 *
 * @param address - An anchor address such as `web/checkout.tsx#L10-L12`, or a
 *   bare path for a whole-file anchor.
 * @returns The extent's 1-based first line, or 1 when the address names no
 *   range.
 * @throws Never.
 */
export function addressStartLine(address: string): number {
  const match = RANGE_START.exec(address);
  return match === null ? 1 : Number(match[1]);
}
