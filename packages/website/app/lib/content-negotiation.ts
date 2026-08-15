/**
 * Content negotiation, the public-path renderer registry, and response
 * finalization for the site's Markdown representations.
 *
 * The worker is the single gate for both access paths: `Accept` negotiation
 * over canonical public URLs, and the `.md` URL family (`/index.md`,
 * `/docs/<slug…>.md`). Everything here fails closed — an unregistered path
 * resolves to `null`, which always means "fall through to SSR", never a body.
 *
 * @summary Accept negotiation + Markdown renderer registry + response finalization
 */
import { getLLMText } from '~/lib/get-llm-text';
import { renderHomepageMarkdown } from '~/lib/homepage-markdown';
import { RENAMED_DOC_SLUGS } from '~/lib/renamed-doc-slugs';
import { source } from '~/lib/source';

const MARKDOWN = 'text/markdown';
const HTML = 'text/html';

function normalizePathname(pathname: string): string {
  return pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
}

/** Parse an RFC 9110 q-value; anything malformed is zero, per the spec. */
function quality(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw.trim())) return 0;
  return Number(raw);
}

/**
 * The best matching entry of `accept` for `wanted`: highest specificity wins,
 * q breaks ties at equal specificity. Entries are lowercased, so matching is
 * case-insensitive by construction.
 */
function preference(accept: string | null, wanted: string): { q: number; specificity: number } {
  if (!accept) return { q: wanted === HTML ? 1 : 0, specificity: 0 };
  const [wantedType, wantedSubtype] = wanted.split('/');
  let best = { q: 0, specificity: -1 };
  for (const entry of accept.split(',')) {
    const [media = '', ...parameters] = entry.trim().toLowerCase().split(';');
    const [type, subtype] = media.trim().split('/');
    if (!type || !subtype || (type !== '*' && type !== wantedType) || (subtype !== '*' && subtype !== wantedSubtype)) {
      continue;
    }
    const specificity = type === '*' ? 0 : subtype === '*' ? 1 : 2;
    // Tolerate BWS around the `=` and quoted q-values — `q = 0` and `q="0.5"`
    // both carry the client's explicit intent and must not degrade to the
    // absent-parameter default (1) or the malformed-value fallback (0).
    const qParameter = parameters.map((part) => part.trim()).find((part) => /^q\s*=/.test(part));
    const q = quality(qParameter?.replace(/^q\s*=\s*/, '').replace(/^"(.*)"$/, '$1'));
    if (specificity > best.specificity || (specificity === best.specificity && q > best.q)) best = { q, specificity };
  }
  return best.specificity < 0 ? { q: 0, specificity: -1 } : best;
}

/**
 * Whether the client explicitly accepts Markdown and strictly prefers it to
 * HTML. Browser default strings, the `*`/`*` wildcard, and equal-q ties all
 * resolve to HTML.
 *
 * @param accept - The raw `Accept` header value, or null when absent.
 * @returns True only when Markdown both appears with q > 0 and outranks HTML.
 * @summary Markdown wins only when explicitly acceptable and strictly preferred
 */
export function prefersMarkdown(accept: string | null): boolean {
  const markdown = preference(accept, MARKDOWN);
  const html = preference(accept, HTML);
  return markdown.q > 0 && markdown.q > html.q;
}

/**
 * Merge a cache variance token without discarding or duplicating existing
 * tokens. Never overwrites — existing entries keep their exact spelling.
 *
 * @param headers - The header set to update in place.
 * @param token - The variance token to ensure, `Accept` by default.
 * @summary Merge a Vary token case-insensitively, appending only when absent
 */
export function mergeVary(headers: Headers, token = 'Accept'): void {
  const existing = headers.get('Vary');
  if (!existing) return void headers.set('Vary', token);
  const tokens = existing.split(',').map((value) => value.trim());
  if (!tokens.some((value) => value.toLowerCase() === token.toLowerCase())) {
    headers.set('Vary', `${existing}, ${token}`);
  }
}

/**
 * Whether an `If-None-Match` value matches an ETag — handles `*`, comma
 * lists, and `W/` weak prefixes on both sides.
 *
 * @param value - The raw `If-None-Match` header value, or null when absent.
 * @param etag - The response's strong ETag.
 * @summary Weak validator matching for conditional GET requests
 */
export function matchesIfNoneMatch(value: string | null, etag: string): boolean {
  if (!value) return false;
  const target = etag.replace(/^W\//i, '');
  return value.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === '*' || trimmed.replace(/^W\//i, '') === target;
  });
}

/** FNV-1a over the UTF-8 bytes, formatted `<8 hex digits>-<byte length>`. */
function entityTag(body: string): string {
  const bytes = new TextEncoder().encode(body);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `"${(hash >>> 0).toString(16).padStart(8, '0')}-${bytes.length}"`;
}

/**
 * Build the final Markdown GET/HEAD response: `text/markdown; charset=utf-8`,
 * a content-derived ETag, merged `Vary`, a 304 on validator match, and a null
 * body for HEAD.
 *
 * @param request - The inbound request, for method and `If-None-Match`.
 * @param body - The rendered Markdown body.
 * @summary Finalize a Markdown response with validators and HEAD/304 handling
 */
export function markdownResponse(request: Request, body: string): Response {
  const etag = entityTag(body);
  const headers = new Headers({ 'Content-Type': 'text/markdown; charset=utf-8', ETag: etag });
  mergeVary(headers);
  if (matchesIfNoneMatch(request.headers.get('If-None-Match'), etag))
    return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

/**
 * The eligibility predicate the worker gates on: true for `/` (normalized)
 * and `/docs/<slug…>` with one or more segments, excluding bare `/docs` and
 * any path ending in `.md` (those belong to the `.md` URL family).
 *
 * @param pathname - A decoded pathname.
 * @summary True when a pathname identifies a negotiable public page
 */
export function isPublicContentPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') return true;
  if (normalized.endsWith('.md')) return false;
  return /^\/docs\/[^/]+(?:\/[^/]+)*$/.test(normalized);
}

/**
 * The renderer registry: resolve the Markdown body for a canonical public
 * path, or `null` to fall through. `null` always means "fall through to SSR",
 * never a body. A fail-closed `Response` thrown by a renderer propagates as a
 * rejection — the worker catches and returns it verbatim.
 *
 * @param pathname - A decoded pathname.
 * @summary Markdown body for a registered public path, or null to fall through
 */
export async function markdownForPathname(pathname: string): Promise<string | null> {
  const normalized = normalizePathname(pathname);
  if (normalized === '/') return renderHomepageMarkdown();
  const docsMatch = /^\/docs\/(.+)$/.exec(normalized);
  if (docsMatch) {
    const page = source.getPage(docsMatch[1].split('/'));
    return page ? getLLMText(page) : null;
  }
  return null;
}

/**
 * Serve the `.md` URL family: `/index.md` and `/docs/<slug…>.md`, including
 * the rename-map 301 that keeps `.md` URLs in step with their HTML twins.
 * Unknown slugs return `null` so SSR produces the standard 404.
 *
 * @param request - The inbound request, for method and `If-None-Match`.
 * @param pathname - A decoded pathname.
 * @summary Markdown response for a .md URL, rename 301, or null to fall through
 */
export async function markdownUrlResponse(request: Request, pathname: string): Promise<Response | null> {
  if (pathname === '/index.md') return markdownResponse(request, renderHomepageMarkdown());
  const docsMatch = /^\/docs\/(.+)\.md$/.exec(pathname);
  if (!docsMatch) return null;
  const slug = docsMatch[1];
  const renamedTo = RENAMED_DOC_SLUGS[slug];
  if (renamedTo) {
    return new Response(null, { status: 301, headers: { Location: `/docs/${renamedTo}.md` } });
  }
  const page = source.getPage(slug.split('/'));
  return page ? markdownResponse(request, await getLLMText(page)) : null;
}
