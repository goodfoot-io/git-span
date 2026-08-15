/**
 * Cloudflare Worker entry point — React Router SSR plus the site's Markdown
 * representations.
 *
 * The worker is the single gate for both access paths to Markdown: `Accept`
 * negotiation over canonical public URLs, and the `.md` URL family
 * (`/index.md`, `/docs/<slug…>.md`). Everything else is SSR, re-wrapped so a
 * negotiated-eligible HTML response carries `Vary: Accept` — caches must never
 * serve one representation for the other. Every response class leaves through
 * one discovery finalizer that appends the page's `Link` relations, so the
 * Markdown twin and llms.txt index are announced identically on HTML,
 * negotiated Markdown, and `.md` URLs.
 *
 * @summary Cloudflare Worker entry: Markdown negotiation and .md URLs before SSR
 * @module worker
 */

import { createRequestHandler } from 'react-router';
import {
  isPublicContentPath,
  markdownForPathname,
  markdownResponse,
  markdownUrlResponse,
  mergeVary,
  prefersMarkdown
} from '~/lib/content-negotiation';
import { applyDiscoveryHeaders } from '~/lib/discovery-links';

// React Router v8's virtual:react-router/server-build module exports individual
// named fields (routes, assets, entry, ssr, etc.) matching the ServerBuild
// interface — there is no default export. Pass the module directly so
// createRequestHandler receives the full ServerBuild shape.
const rrHandler = createRequestHandler(() => import('virtual:react-router/server-build'));

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Decode once, before any predicate runs, mirroring React Router's own
    // decodePath so percent-encoded slugs negotiate like their decoded twins.
    // Malformed sequences fall through to the raw string — fail-closed, since
    // the raw form matches no registered path and the SSR path 404s it.
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = url.pathname;
    }

    const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';
    const eligible = isGetOrHead && isPublicContentPath(pathname);

    let response: Response | null = null;

    if (eligible && prefersMarkdown(request.headers.get('Accept'))) {
      try {
        const markdown = await markdownForPathname(pathname);
        if (markdown !== null) response = markdownResponse(request, markdown);
      } catch (error) {
        // Fail-closed: a thrown Response (getLLMText's 404/500) is returned
        // verbatim. Anything else propagates — swallowing it into the SSR path
        // would silently serve HTML for a page that should have negotiated.
        if (error instanceof Response) response = error;
        else throw error;
      }
      // Registry miss — fall through so SSR produces the standard 404.
    } else if (isGetOrHead) {
      try {
        // The .md URL family: exact URLs, not an address family. Unknown slugs
        // return null so SSR produces the 404; the rename-map 301 keeps .md
        // URLs in step with their HTML twins.
        const mdResponse = await markdownUrlResponse(request, pathname);
        if (mdResponse) response = mdResponse;
      } catch (error) {
        if (error instanceof Response) response = error;
        else throw error;
      }
    }

    if (response === null) {
      // SSR HTML. Re-wrap so the (possibly streamed) response keeps its
      // metadata, and merge Accept variance onto eligible HTML so caches
      // separate the representations.
      const rendered = await rrHandler(request);
      response = new Response(rendered.body, rendered);
      if (eligible) mergeVary(response.headers);
    }

    // The discovery finalizer: every response class — SSR HTML, negotiated
    // Markdown, .md URLs, and thrown Responses — leaves through this one
    // return, so the Link relations are structurally present on every
    // representation. It receives the raw pathname — the same form the head
    // consumer passes — because the classifier decodes internally, so
    // encoded and decoded spellings of one page advertise identically. The
    // classifier emits nothing outside content paths, and redirects pass
    // through untouched, so 301s, 404s, and assets carry no extra headers.
    return applyDiscoveryHeaders(response, url.pathname);
  }
} satisfies ExportedHandler;
