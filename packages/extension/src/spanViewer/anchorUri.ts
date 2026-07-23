/**
 * Pure build/parse helpers for the `gitspan-anchor:` virtual document
 * identity used by the Multi-Diff viewer. Returns plain `{path, query}`
 * objects -- the actual `vscode.Uri.parse`/`.with()` wrapping happens in the
 * integration layer, added in a later group.
 *
 * @summary Encodes/decodes anchor identity into URI path/query components.
 * @module spanViewer/anchorUri
 */

import type { AnchorUriParams } from './types.js';

/**
 * Build the `{path, query}` components of a `gitspan-anchor:` URI for one
 * side of one anchor.
 *
 * The query string is the self-contained source of truth for
 * `parseAnchorUri` -- it carries all four params. `path` is set to the
 * anchor's own file path (not the span file's path) purely so panes read as
 * clean file paths per the card's requirement.
 *
 * @param params - The anchor identity to encode.
 * @returns The URI's path (the anchor's own file path, so panes read as
 *   clean file paths) and its query string (span path, anchor path, anchor
 *   index, side).
 * @throws Never.
 */
export function buildAnchorUri(params: AnchorUriParams): { path: string; query: string } {
  const query = new URLSearchParams({
    spanPath: params.spanPath,
    anchorPath: params.anchorPath,
    anchorIndex: String(params.anchorIndex),
    side: params.side
  }).toString();
  return { path: params.anchorPath, query };
}

/**
 * Parse a `gitspan-anchor:` URI's path and query back into its params.
 *
 * Decodes entirely from `query`, which is self-contained -- `path` is not
 * consulted, since it is only a display convenience and may be reshaped by
 * URI encoding along the way.
 *
 * @param path - The URI's path component.
 * @param query - The URI's query string.
 * @returns The decoded anchor identity.
 * @throws Never.
 */
export function parseAnchorUri(path: string, query: string): AnchorUriParams {
  void path;
  const params = new URLSearchParams(query);
  const spanPath = params.get('spanPath') ?? '';
  const anchorPath = params.get('anchorPath') ?? '';
  const anchorIndex = Number.parseInt(params.get('anchorIndex') ?? '0', 10);
  const side = params.get('side') === 'modified' ? 'modified' : 'original';
  return { spanPath, anchorPath, anchorIndex, side };
}
