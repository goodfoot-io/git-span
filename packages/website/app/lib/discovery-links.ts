/**
 * Discovery relation mapping for public content pages: the classifier that
 * decides which `Link` relations a page advertises, the RFC 8288 serializer,
 * and the Worker response finalizer.
 *
 * One module owns the contract because two consumers share it — the Worker
 * appends the relations as HTTP `Link` headers and the root layout renders
 * them as `<link>` elements — so the head contract and the header contract
 * cannot drift.
 *
 * @summary Pathname-keyed discovery classifier, Link serializer, response finalizer
 */
import { isPublicContentPath } from '~/lib/content-negotiation';
import { source } from '~/lib/source';

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

/** The fixed relations for a canonical docs path: its `.md` twin and the
 * docs-scope llms.txt index. */
function docsLinks(pathname: string): DiscoveryLinkDescriptor[] {
  return [
    { rel: 'alternate', href: `${pathname}.md`, type: 'text/markdown' },
    { rel: 'describedby', href: '/docs/llms.txt' }
  ];
}

/**
 * The relations a public content path advertises, or `[]` for anything else.
 *
 * A `.md` twin resolves to its canonical content path first, so both
 * representations of one page emit the identical header set — the worker 404s
 * trailing-slash `.md` variants, so those are deliberately not normalized.
 * Existence is `source.getPage`, the same predicate the HTML loader and the
 * `.md` resolver use, so an advertised twin cannot 404.
 *
 * @param pathname - A decoded request pathname.
 * @summary Discovery relations for a pathname, empty outside the content set
 */
export function getDiscoveryLinks(pathname: string): DiscoveryLinkDescriptor[] {
  if (pathname === '/' || pathname === '/index.md') return HOMEPAGE_LINKS;

  const mdMatch = /^\/docs\/(.+)\.md$/.exec(pathname);
  const docsPath = mdMatch ? `/docs/${mdMatch[1]}` : pathname.replace(/\/+$/, '');

  if (isPublicContentPath(docsPath)) {
    const slug = docsPath.slice('/docs/'.length);
    if (source.getPage(slug.split('/'))) return docsLinks(docsPath);
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
 * Wraps the response so the header map is mutable without buffering the body;
 * appends rather than sets, so upstream `Link` values survive.
 *
 * @param response - The response to finalize.
 * @param pathname - A decoded request pathname.
 * @summary Response carrying the pathname's Link relations, metadata preserved
 */
export function applyDiscoveryHeaders(response: Response, pathname: string): Response {
  const wrapped = new Response(response.body, response);
  for (const descriptor of getDiscoveryLinks(pathname)) {
    wrapped.headers.append('Link', serializeDiscoveryLink(descriptor));
  }
  return wrapped;
}
