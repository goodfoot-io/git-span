/**
 * The line-range suffix rendered after an anchor card's filename, e.g. the
 * `L4-L100` in `perf-baseline.json L4-L100`.
 *
 * A whole-file anchor carries no range and renders no suffix: "the whole file"
 * reads as the absence of a range, so the caller omits the element outright
 * rather than emitting an empty one that still occupies a flex gap. That is
 * why the return type is nullable rather than an empty string.
 *
 * A single-line anchor renders `L4`, not `L4-L4`. The declaration's on-disk
 * address form is always `#L<start>-L<end>`, but this header is a presentation
 * of the anchor, not an echo of the file -- it already splits the path into
 * basename and directory -- and `L4` is the form every editor and forge uses
 * for a one-line reference.
 *
 * Lives in its own module because it is DOM-free and therefore exercisable
 * from the extension host's test runner, which has no DOM.
 *
 * @summary Formats a posted anchor's line range as its header suffix.
 * @module spanViewer/webview/anchorRangeLabel
 */

import type { PostedAnchorBase } from '../types.js';

/**
 * Format an anchor's declared line range for display beside its filename.
 *
 * The range arrives already validated by the span-file grammar, which rejects
 * any address whose start is below 1 or whose end precedes its start, so no
 * ordering or bounds check is repeated here.
 *
 * @param range - The anchor's 1-based inclusive range, or `null` for a
 *   whole-file anchor.
 * @returns The suffix to render (`L4`, `L4-L100`), or `null` when the anchor
 *   spans the whole file and no suffix should be rendered.
 * @throws Never.
 */
export function anchorRangeLabel(range: PostedAnchorBase['range']): string | null {
  if (range === null) {
    return null;
  }
  if (range.start === range.end) {
    return `L${range.start}`;
  }
  return `L${range.start}-L${range.end}`;
}
