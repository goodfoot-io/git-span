// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const rr = vi.hoisted(() => ({
  response: new Response('SSR response', { status: 207, statusText: 'Multi-Status' })
}));

vi.mock('react-router', () => ({
  createRequestHandler: vi.fn(() => async () => rr.response)
}));

// The real negotiation, registry, Fumadocs collection, and response builders
// all run unmocked; only the registry entry is wrapped so one path can reject
// with a fail-closed Response (the worker-level 500 path).
vi.mock('~/lib/content-negotiation', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/lib/content-negotiation')>();
  return {
    ...real,
    markdownForPathname: vi.fn(async (pathname: string) => {
      if (pathname === '/docs/trigger-500') {
        throw new Response('Processed text unavailable', { status: 500 });
      }
      return real.markdownForPathname(pathname);
    })
  };
});

import worker from '~/worker';

function request(pathname: string, init?: RequestInit): Request {
  return new Request(`https://git-span.test${pathname}`, init);
}

function markdownRequest(pathname: string, init?: RequestInit): Request {
  return request(pathname, { ...init, headers: { Accept: 'text/markdown', ...init?.headers } });
}

afterEach(() => {
  rr.response = new Response('SSR response', { status: 207, statusText: 'Multi-Status' });
});

describe('worker Markdown negotiation', () => {
  it('negotiates the homepage for GET /', async () => {
    const response = await worker.fetch(markdownRequest('/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(response.headers.get('ETag')).toBeTruthy();
    expect(await response.text()).toContain('# Agents should read between the lines.');
  });

  it('negotiates a nested guide slug', async () => {
    const response = await worker.fetch(markdownRequest('/docs/guides/reconcile-drifted-spans'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(await response.text()).toContain('(/docs/guides/reconcile-drifted-spans)');
  });

  it('negotiates a single-segment page', async () => {
    const response = await worker.fetch(markdownRequest('/docs/overview'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('(/docs/overview)');
  });

  it('negotiates a trailing-slash docs URL', async () => {
    const response = await worker.fetch(markdownRequest('/docs/overview/'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it('negotiates a percent-encoded slug', async () => {
    const response = await worker.fetch(markdownRequest('/docs/guides/reconcile%2Ddrifted-spans'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it('serves a percent-encoded .md URL', async () => {
    const response = await worker.fetch(request('/docs/guides/reconcile%2Ddrifted-spans.md'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it('adds Accept variance to eligible HTML without changing SSR metadata', async () => {
    const response = await worker.fetch(request('/docs/overview'));
    expect(response.status).toBe(207);
    expect(response.statusText).toBe('Multi-Status');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(await response.text()).toBe('SSR response');
  });

  it('leaves non-public paths untouched, with no Vary', async () => {
    const response = await worker.fetch(markdownRequest('/api/repos'));
    expect(response.status).toBe(207);
    expect(response.headers.get('Content-Type')).not.toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBeNull();
  });

  it('merges Accept into existing HTML variance', async () => {
    rr.response = new Response('SSR response', { headers: { Vary: 'Accept-Encoding' } });
    const response = await worker.fetch(request('/docs/overview'));
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Accept');
  });

  it('lets unknown docs slugs fall through to the SSR 404 with Vary merged', async () => {
    rr.response = new Response('not found', { status: 404 });
    const response = await worker.fetch(markdownRequest('/docs/not-a-real-page'));
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).not.toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(await response.text()).toBe('not found');
  });

  it('serves /index.md without negotiation', async () => {
    const response = await worker.fetch(request('/index.md'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(await response.text()).toContain('# Agents should read between the lines.');
  });

  it('serves a nested .md URL without negotiation', async () => {
    const response = await worker.fetch(request('/docs/guides/reconcile-drifted-spans.md'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it('301s a renamed .md URL to its .md twin', async () => {
    const response = await worker.fetch(request('/docs/guides/reconcile-stale-spans.md'));
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/docs/guides/reconcile-drifted-spans.md');
  });

  it('leaves trailing-slash .md variants to the SSR 404 path', async () => {
    rr.response = new Response('not found', { status: 404 });
    for (const pathname of ['/docs/overview.md/', '/index.md/']) {
      const response = await worker.fetch(request(pathname));
      expect(response.status, pathname).toBe(404);
    }
  });

  it('returns a thrown registry Response verbatim', async () => {
    const response = await worker.fetch(markdownRequest('/docs/trigger-500'));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Processed text unavailable');
  });

  it('supports conditional GET through the worker', async () => {
    const first = await worker.fetch(markdownRequest('/docs/overview'));
    const etag = first.headers.get('ETag') ?? '';
    const conditional = await worker.fetch(markdownRequest('/docs/overview', { headers: { 'If-None-Match': etag } }));
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe('');
  });

  it('returns bodyless HEAD with the same validator as GET', async () => {
    const get = await worker.fetch(markdownRequest('/docs/overview'));
    const head = await worker.fetch(markdownRequest('/docs/overview', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('ETag')).toBe(get.headers.get('ETag'));
    expect(await head.text()).toBe('');
  });

  it('passes eligible HEAD with HTML Accept through with Vary merged', async () => {
    const response = await worker.fetch(request('/docs/overview', { method: 'HEAD' }));
    expect(response.status).toBe(207);
    expect(response.headers.get('Vary')).toBe('Accept');
  });

  it('leaves non-GET/HEAD methods on the untouched SSR path', async () => {
    const response = await worker.fetch(markdownRequest('/docs/overview', { method: 'POST' }));
    expect(response.status).toBe(207);
    expect(response.headers.get('Content-Type')).not.toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBeNull();
  });
});

describe('worker discovery headers', () => {
  it('emits both relations on an SSR docs response', async () => {
    const response = await worker.fetch(request('/docs/overview'));
    expect(response.status).toBe(207);
    expect(response.statusText).toBe('Multi-Status');
    expect(await response.text()).toBe('SSR response');
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits the homepage relations on /', async () => {
    const response = await worker.fetch(request('/'));
    expect(response.headers.get('Link')).toBe(
      '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"'
    );
  });

  it('emits the identical relations on negotiated Markdown', async () => {
    const response = await worker.fetch(markdownRequest('/docs/overview'));
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits the identical relations on .md URL responses', async () => {
    const response = await worker.fetch(request('/docs/overview.md'));
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits nothing on non-content paths', async () => {
    const response = await worker.fetch(request('/api/repos'));
    expect(response.headers.get('Link')).toBeNull();
  });

  it('emits nothing on an unknown docs slug 404', async () => {
    rr.response = new Response('not found', { status: 404 });
    const response = await worker.fetch(request('/docs/not-a-real-page'));
    expect(response.status).toBe(404);
    expect(response.headers.get('Link')).toBeNull();
  });

  it('preserves an upstream Link alongside the appended relations', async () => {
    rr.response = new Response('SSR response', {
      status: 207,
      statusText: 'Multi-Status',
      headers: { Link: '</styles.css>; rel="stylesheet"' }
    });
    const response = await worker.fetch(request('/docs/overview'));
    expect(response.headers.get('Link')).toBe(
      '</styles.css>; rel="stylesheet", </docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('keeps both relations on a HEAD response', async () => {
    const response = await worker.fetch(request('/docs/overview', { method: 'HEAD' }));
    expect(response.status).toBe(207);
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits decoded relations for a percent-encoded request', async () => {
    const response = await worker.fetch(request('/docs/guides/reconcile%2Ddrifted-spans'));
    expect(response.headers.get('Link')).toBe(
      '</docs/guides/reconcile-drifted-spans.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits decoded relations on negotiated Markdown for a percent-encoded request', async () => {
    const response = await worker.fetch(markdownRequest('/docs/guides/reconcile%2Ddrifted-spans'));
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Link')).toBe(
      '</docs/guides/reconcile-drifted-spans.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits decoded relations on a percent-encoded .md URL', async () => {
    const response = await worker.fetch(request('/docs/guides/reconcile%2Ddrifted-spans.md'));
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Link')).toBe(
      '</docs/guides/reconcile-drifted-spans.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits nothing on a trailing-slash HTML redirect', async () => {
    rr.response = new Response('', { status: 301, headers: { Location: '/docs/overview' } });
    const response = await worker.fetch(request('/docs/overview/'));
    expect(response.status).toBe(301);
    expect(response.headers.get('Link')).toBeNull();
  });

  it('keeps relations on negotiated Markdown for a trailing-slash URL', async () => {
    const response = await worker.fetch(markdownRequest('/docs/overview/'));
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });

  it('emits nothing on a renamed-slug .md redirect', async () => {
    const response = await worker.fetch(request('/docs/guides/reconcile-stale-spans.md'));
    expect(response.status).toBe(301);
    expect(response.headers.get('Link')).toBeNull();
  });

  it('emits the canonical relations for a case-variant docs prefix', async () => {
    const response = await worker.fetch(request('/DOCS/overview'));
    expect(response.headers.get('Link')).toBe(
      '</docs/overview.md>; rel="alternate"; type="text/markdown", </docs/llms.txt>; rel="describedby"'
    );
  });
});
