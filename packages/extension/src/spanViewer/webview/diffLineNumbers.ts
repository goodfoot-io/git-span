/**
 * The per-side gutter line-number offset for embedded diff editors whose
 * models carry only an anchor extent's own lines.
 *
 * Every history-block and anchor-card diff renders the extent's text, not the
 * whole file, so Monaco would number the gutter from 1. The extent's rows are
 * the file's lines from `startLine` up, and a reader cross-references a row
 * against the file on disk -- a block titled `f.txt#L1641-L1996` must read
 * `1641` on its first row, not `1`. The offset is applied per side, because
 * a rename block's old side lives in the from-address's line space and its
 * new side in the declared address's.
 *
 * The renderer is set through Monaco's `lineNumbers` editor option, which
 * accepts a `(lineNumber) => string` function, independently per side via
 * `diffEditor.getOriginalEditor().updateOptions(...)` and
 * `getModifiedEditor().updateOptions(...)` -- the diff editor itself shares
 * one option value across both sides, so a per-side offset cannot go in the
 * diff editor's construction options.
 *
 * Lives in its own module because it is DOM-free and therefore exercisable
 * from the extension host's test runner, which has no DOM.
 *
 * @summary Gutter line-number offset for anchor-extent diff editors.
 * @module spanViewer/webview/diffLineNumbers
 */

/**
 * The Monaco `lineNumbers` renderer for a side whose first row is the file's
 * line `startLine` (1-based): row 1 renders `startLine`, row 2 `startLine + 1`,
 * and so on.
 *
 * @param startLine - The extent's file-absolute first line.
 * @returns A renderer that maps each model row to its file line.
 * @throws Never.
 */
export function gutterLineNumbers(startLine: number): (lineNumber: number) => string {
  return (lineNumber) => String(startLine + lineNumber - 1);
}
