// @vitest-environment node
import { matchRoutes, type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { markdownUrlResponse } from '~/lib/content-negotiation';
import { applyDiscoveryHeaders, DOC_SLUGS, getDiscoveryLinks, serializeDiscoveryLink } from '~/lib/discovery-links';
import { collectPageNodes } from '~/lib/llms-resources';
import { source } from '~/lib/source';
import routes from '~/routes';

describe('getDiscoveryLinks', () => {
  it('returns the homepage set for /', () => {
    expect(getDiscoveryLinks('/')).toEqual([
      { rel: 'alternate', href: '/index.md', type: 'text/markdown' },
      { rel: 'describedby', href: '/llms.txt' }
    ]);
  });

  it('returns the identical homepage set for /index.md', () => {
    expect(getDiscoveryLinks('/index.md')).toEqual(getDiscoveryLinks('/'));
  });

  it('returns the docs set for a single-segment page', () => {
    expect(getDiscoveryLinks('/docs/overview')).toEqual([
      { rel: 'alternate', href: '/docs/overview.md', type: 'text/markdown' },
      { rel: 'describedby', href: '/docs/llms.txt' }
    ]);
  });

  it('returns the docs set for a nested guide slug', () => {
    expect(getDiscoveryLinks('/docs/guides/reconcile-drifted-spans')).toEqual([
      { rel: 'alternate', href: '/docs/guides/reconcile-drifted-spans.md', type: 'text/markdown' },
      { rel: 'describedby', href: '/docs/llms.txt' }
    ]);
  });

  it('normalizes a trailing slash on a content path', () => {
    expect(getDiscoveryLinks('/docs/overview/')).toEqual(getDiscoveryLinks('/docs/overview'));
  });

  it('returns the identical set for a .md twin', () => {
    expect(getDiscoveryLinks('/docs/overview.md')).toEqual(getDiscoveryLinks('/docs/overview'));
  });

  it('returns nothing for the renamed slug', () => {
    expect(getDiscoveryLinks('/docs/guides/reconcile-stale-spans')).toEqual([]);
    expect(getDiscoveryLinks('/docs/guides/reconcile-stale-spans.md')).toEqual([]);
  });

  it('returns nothing for bare /docs and its trailing-slash form', () => {
    expect(getDiscoveryLinks('/docs')).toEqual([]);
    expect(getDiscoveryLinks('/docs/')).toEqual([]);
  });

  it('returns nothing for unknown slugs', () => {
    expect(getDiscoveryLinks('/docs/not-a-real-page')).toEqual([]);
    expect(getDiscoveryLinks('/docs/not-a-real-page.md')).toEqual([]);
  });

  it('returns nothing for trailing-slash .md variants the worker 404s', () => {
    expect(getDiscoveryLinks('/docs/overview.md/')).toEqual([]);
    expect(getDiscoveryLinks('/index.md/')).toEqual([]);
  });

  it('returns nothing for the llms.txt resources', () => {
    expect(getDiscoveryLinks('/llms.txt')).toEqual([]);
    expect(getDiscoveryLinks('/docs/llms.txt')).toEqual([]);
    expect(getDiscoveryLinks('/llms-full.txt')).toEqual([]);
    expect(getDiscoveryLinks('/docs/llms-full.txt')).toEqual([]);
  });

  it('returns nothing for assets and non-content paths', () => {
    expect(getDiscoveryLinks('/favicon.svg')).toEqual([]);
    expect(getDiscoveryLinks('/og.png')).toEqual([]);
    expect(getDiscoveryLinks('/api/repos')).toEqual([]);
  });

  it('decodes percent-encoded pathnames before classifying', () => {
    expect(getDiscoveryLinks('/docs/guides/reconcile%2Ddrifted-spans')).toEqual(
      getDiscoveryLinks('/docs/guides/reconcile-drifted-spans')
    );
    expect(getDiscoveryLinks('/docs/guides%2Freconcile-drifted-spans')).toEqual(
      getDiscoveryLinks('/docs/guides/reconcile-drifted-spans')
    );
  });

  it('fails closed on malformed percent-encodings', () => {
    expect(getDiscoveryLinks('/docs/overview%2')).toEqual([]);
    expect(getDiscoveryLinks('/docs/%E0%A4%A')).toEqual([]);
  });
});

describe('serializeDiscoveryLink', () => {
  it('emits href, rel, and type in RFC 8288 form', () => {
    expect(serializeDiscoveryLink({ rel: 'alternate', href: '/index.md', type: 'text/markdown' })).toBe(
      '</index.md>; rel="alternate"; type="text/markdown"'
    );
  });

  it('omits the type parameter when absent', () => {
    expect(serializeDiscoveryLink({ rel: 'describedby', href: '/llms.txt' })).toBe('</llms.txt>; rel="describedby"');
  });
});

describe('applyDiscoveryHeaders', () => {
  it('appends both relations to a content-path response without touching its metadata', async () => {
    const response = applyDiscoveryHeaders(
      new Response('body', { status: 207, statusText: 'Multi-Status' }),
      '/docs/overview'
    );
    expect(response.status).toBe(207);
    expect(response.statusText).toBe('Multi-Status');
    expect(await response.text()).toBe('body');
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('appends to an upstream Link instead of clobbering it', () => {
    const response = applyDiscoveryHeaders(
      new Response(null, { headers: { Link: '</styles.css>; rel="stylesheet"' } }),
      '/docs/overview'
    );
    expect(response.headers.get('Link')).toBe(
      '</styles.css>; rel="stylesheet", </docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('adds nothing on a non-content path', async () => {
    const response = applyDiscoveryHeaders(new Response('body'), '/api/repos');
    expect(response.headers.get('Link')).toBeNull();
    expect(await response.text()).toBe('body');
  });

  it('leaves redirect responses untouched', () => {
    const response = applyDiscoveryHeaders(
      new Response(null, { status: 301, headers: { Location: '/docs/overview' } }),
      '/docs/overview/'
    );
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/docs/overview');
    expect(response.headers.get('Link')).toBeNull();
  });

  it('keeps relations on a 304 that carries no Location', () => {
    const response = applyDiscoveryHeaders(new Response(null, { status: 304 }), '/docs/overview');
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });
});

describe('every advertised href resolves', () => {
  const table = routes as unknown as RouteObject[];

  async function assertResolves(href: string, context: string): Promise<void> {
    if (href.endsWith('.md')) {
      const response = await markdownUrlResponse(new Request(`https://git-span.test${href}`), href);
      expect(response, `${context}: ${href} did not resolve`).not.toBeNull();
      expect(response?.status, `${context}: ${href} status`).toBe(200);
      expect(response?.headers.get('Content-Type'), `${context}: ${href} content type`).toBe(
        'text/markdown; charset=utf-8'
      );
    } else {
      expect(matchRoutes(table, href), `${context}: ${href} matches no route`).not.toBeNull();
    }
  }

  it('every page the classifier advertises has a working Markdown twin and index', async () => {
    for (const node of collectPageNodes(source.pageTree.children)) {
      const descriptors = getDiscoveryLinks(node.url);
      expect(descriptors, `no relations for ${node.url}`).not.toEqual([]);
      const alternate = descriptors.find((descriptor) => descriptor.rel === 'alternate');
      const describedby = descriptors.find((descriptor) => descriptor.rel === 'describedby');
      expect(alternate, `no alternate relation for ${node.url}`).toBeDefined();
      expect(describedby, `no describedby relation for ${node.url}`).toBeDefined();
      if (!alternate || !describedby) continue;
      expect(alternate.href).toBe(`${node.url}.md`);
      await assertResolves(alternate.href, node.url);
      await assertResolves(describedby.href, node.url);
    }
  });

  it('the homepage relations resolve on both representations', async () => {
    for (const pathname of ['/', '/index.md']) {
      for (const descriptor of getDiscoveryLinks(pathname)) {
        await assertResolves(descriptor.href, pathname);
      }
    }
  });

  it('every slug the classifier can advertise is a page in the live source', () => {
    for (const slug of DOC_SLUGS) {
      expect(source.getPage(slug.split('/')), `DOC_SLUGS has ${slug} but the source does not`).toBeTruthy();
    }
  });
});
