/**
 * Discovery relation mapping for public content pages: the classifier that
 * decides which `Link` relations a page advertises, the RFC 8288 serializer,
 * and the Worker response finalizer.
 *
 * One module owns the contract because two consumers share it — the Worker
 * appends the relations as HTTP `Link` headers and the root layout renders
 * them as `<link>` elements from the active pathname — so the head contract
 * and the header contract cannot drift. Both consumers feed the classifier
 * the raw pathname (the worker's `url.pathname`, the head's
 * `useLocation().pathname`), and the classifier decodes exactly once,
 * internally, so percent-encoded requests classify identically on both
 * surfaces.
 *
 * The module is client-safe by construction: the existence gate is a slug
 * set derived from the keys of a `?url` glob over the authored docs files —
 * the same file set the server collection indexes — so the head consumer
 * ships the file names to the client, never the MDX corpus. A key the server
 * collection maps to a different slug is caught by the fail-closed invariant
 * test, not at runtime.
 *
 * @summary Pathname-keyed discovery classifier, Link serializer, response finalizer
 */
import { AGENT_SKILLS_LINK } from './agent-skills';

/** A discovery relation for one public page: its Markdown twin (`alternate`)
 * and the llms.txt index that describes it (`describedby`). */
export interface DiscoveryLinkDescriptor {
  rel: 'alternate' | 'describedby';
  href: string;
  type?: string;
}

const HOMEPAGE_LINKS: DiscoveryLinkDescriptor[] = [
  { rel: 'alternate', href: '/index.md', type: 'text/markdown' },
  { rel: 'describedby', href: '/llms.txt' }
];

/**
 * The docs slugs the classifier may advertise: every authored docs page's
 * path relative to `content/docs`, minus its extension — the same file set
 * the server collection globs (`.source/server.ts`). The `?url` query keeps
 * each value a path string, so importing this module into the client bundle
 * carries the file names, not the page content.
 */
export const DOC_SLUGS: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob('/content/docs/**/*.{mdx,md}', { eager: true, query: '?url' })).map((path) =>
    path.slice('/content/docs/'.length).replace(/\.(mdx|md)$/, '')
  )
);

/** The fixed relations for a canonical docs path: its `.md` twin and the
 * docs-scope llms.txt index. */
function docsDiscoveryLinks(pathname: string): DiscoveryLinkDescriptor[] {
  return [
    { rel: 'alternate', href: `${pathname}.md`, type: 'text/markdown' },
    { rel: 'describedby', href: '/docs/llms.txt' }
  ];
}

/**
 * Decode a raw pathname the way the worker decodes request URLs: once, with
 * malformed sequences falling back to the raw string. Because both consumers
 * pass raw forms, decoding here — exactly once, in the shared classifier —
 * is what keeps percent-encoded requests from splitting the head/header
 * contract.
 */
function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * The relations a public content path advertises, or `[]` for anything else.
 *
 * A `.md` twin resolves to its canonical content path first, so both
 * representations of one page emit the identical descriptor set — the worker
 * 404s trailing-slash `.md` variants, so those are deliberately not
 * normalized. Existence is slug membership in `DOC_SLUGS`, derived from the
 * same authored files the server collection indexes, so an advertised twin
 * cannot 404; the invariant test pins the two in agreement.
 *
 * @param rawPathname - A raw, not-yet-decoded request pathname.
 * @summary Discovery relations for a pathname, empty outside the content set
 */
export function getDiscoveryLinks(rawPathname: string): DiscoveryLinkDescriptor[] {
  const pathname = decodePathname(rawPathname);
  if (pathname === '/' || pathname === '/index.md') return HOMEPAGE_LINKS;

  const mdMatch = /^\/docs\/(.+)\.md$/.exec(pathname);
  const docsPath = mdMatch ? `/docs/${mdMatch[1]}` : pathname.replace(/\/+$/, '');
  // The content-path prefix match is case-insensitive to mirror react-router's
  // route matching — /DOCS/overview is a served content page, so it must
  // advertise. The .md family stays exact-case above (the worker 404s
  // /DOCS/overview.md), and the emitted hrefs are canonicalized, so a
  // case-variant page advertises the canonical twin, never a case-variant one.
  const docsMatch = /^\/docs\/(.+)$/i.exec(docsPath);
  if (docsMatch && DOC_SLUGS.has(docsMatch[1])) {
    return docsDiscoveryLinks(docsPath.replace(/^\/docs/i, '/docs'));
  }
  return [];
}

/**
 * Render one descriptor as an RFC 8288 link-value: `<href>; rel="…"` with the
 * optional `; type="…"` parameter.
 *
 * @param descriptor - The relation to serialize.
 * @summary RFC 8288 link-value string for one descriptor
 */
export function serializeDiscoveryLink(descriptor: DiscoveryLinkDescriptor): string {
  const typeParameter = descriptor.type === undefined ? '' : `; type="${descriptor.type}"`;
  return `<${descriptor.href}>; rel="${descriptor.rel}"${typeParameter}`;
}

/**
 * Append a pathname's discovery relations to a response as `Link` headers.
 * Redirects pass through untouched — a client following the `Location` finds
 * the relations on the page it lands on, and Cloudflare's redirect passthrough
 * contract stays intact. Otherwise the response is wrapped so the header map
 * is mutable without buffering the body; headers are appended rather than
 * set, so upstream `Link` values survive.
 *
 * The agent-skills index link is appended to every non-redirect response,
 * after the page descriptors: it advertises the site-wide well-known surface,
 * not the requested pathname, so it is constant where the descriptors are
 * per-page.
 *
 * @param response - The response to finalize.
 * @param rawPathname - A raw, not-yet-decoded request pathname.
 * @summary Response carrying the pathname's Link relations, metadata preserved
 */
export function applyDiscoveryHeaders(response: Response, rawPathname: string): Response {
  if (response.status >= 300 && response.status < 400 && response.headers.has('Location')) return response;
  const wrapped = new Response(response.body, response);
  for (const descriptor of getDiscoveryLinks(rawPathname)) {
    wrapped.headers.append('Link', serializeDiscoveryLink(descriptor));
  }
  wrapped.headers.append('Link', AGENT_SKILLS_LINK);
  return wrapped;
}
