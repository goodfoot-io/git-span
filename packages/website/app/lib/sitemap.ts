/**
 * Pure sitemap renderer: owns the whole XML transform so the contract is
 * testable with fixture input and the route stays a thin wrapper.
 *
 * Dedupes on the raw path strings before URL resolution (so `'/'` and `''`
 * stay distinct keys), resolves each path against `origin` with WHATWG URL
 * semantics, XML-escapes `& < > "`, and emits the sitemap-protocol document.
 */
export function renderSitemap(_paths: readonly string[], _origin: string): string {
  throw new Error('Not Implemented');
}
