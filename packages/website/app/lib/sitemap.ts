/**
 * Pure sitemap renderer: owns the whole XML transform so the contract is
 * testable with fixture input and the route stays a thin wrapper.
 *
 * Dedupes on the raw path strings before URL resolution (so `'/'` and `''`
 * stay distinct keys), resolves each path against `origin` with WHATWG URL
 * semantics, XML-escapes `& < > "`, and emits the sitemap-protocol document.
 */
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
};

// Exactly `& < > "` — apostrophes are legal in XML text content, so escaping
// them would widen the entity set. A single-pass replace keeps the entities
// themselves from being re-escaped.
function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => XML_ESCAPES[ch]);
}

export function renderSitemap(paths: readonly string[], origin: string): string {
  // Dedupe on the raw path strings before URL resolution, so `'/'` and `''`
  // stay distinct keys.
  const unique = [...new Set(paths)];
  const locations = unique.map((path) => `  <url>\n    <loc>${escapeXml(new URL(path, origin).href)}</loc>\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locations,
    '</urlset>',
    ''
  ].join('\n');
}
