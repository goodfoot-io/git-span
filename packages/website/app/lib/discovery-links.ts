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

/** A discovery relation for one public page: its Markdown twin (`alternate`)
 * and the llms.txt index that describes it (`describedby`). */
export interface DiscoveryLinkDescriptor {
  rel: 'alternate' | 'describedby';
  href: string;
  type?: string;
}

/**
 * The relations a public content path advertises, or `[]` for anything else.
 *
 * @param pathname - A decoded request pathname.
 * @summary Discovery relations for a pathname, empty outside the content set
 */
export function getDiscoveryLinks(_pathname: string): DiscoveryLinkDescriptor[] {
  throw new Error('Not Implemented');
}

/**
 * Render one descriptor as an RFC 8288 link-value: `<href>; rel="…"` with the
 * optional `; type="…"` parameter.
 *
 * @param descriptor - The relation to serialize.
 * @summary RFC 8288 link-value string for one descriptor
 */
export function serializeDiscoveryLink(_descriptor: DiscoveryLinkDescriptor): string {
  throw new Error('Not Implemented');
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
export function applyDiscoveryHeaders(_response: Response, _pathname: string): Response {
  throw new Error('Not Implemented');
}
