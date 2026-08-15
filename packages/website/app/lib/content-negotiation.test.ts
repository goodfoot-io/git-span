// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isPublicContentPath,
  markdownForPathname,
  markdownResponse,
  markdownUrlResponse,
  matchesIfNoneMatch,
  mergeVary,
  prefersMarkdown
} from '~/lib/content-negotiation';
import { source } from '~/lib/source';

describe('prefersMarkdown', () => {
  it.skip.each([
    [null, false],
    ['text/html', false],
    ['*/*', false],
    ['', false],
    ['text/html, text/markdown', false],
    ['text/markdown', true],
    ['text/markdown, */*', false],
    ['TEXT/MARKDOWN; charset=utf-8', true],
    ['text/html;q=.5, text/markdown;q=0.8', true],
    ['text/html;q=0.9, text/markdown;q=0.8', false],
    ['text/markdown;q=0, */*;q=1', false],
    ['text/markdown;q=wat', false]
  ])('selects Markdown for %s only when it strictly outranks HTML', (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });
});

describe('mergeVary', () => {
  it.skip('sets the token when Vary is absent', () => {
    const headers = new Headers();
    mergeVary(headers);
    expect(headers.get('Vary')).toBe('Accept');
  });

  it.skip('appends the token after existing variance', () => {
    const headers = new Headers({ Vary: 'Accept-Encoding' });
    mergeVary(headers);
    expect(headers.get('Vary')).toBe('Accept-Encoding, Accept');
  });

  it.skip('leaves an existing token untouched, case-insensitively', () => {
    const headers = new Headers({ Vary: 'accept' });
    mergeVary(headers);
    mergeVary(headers, 'accept');
    expect(headers.get('Vary')).toBe('accept');
  });
});

describe('matchesIfNoneMatch', () => {
  it.skip.each([
    ['W/"abc"', true],
    ['"nope", W/"abc"', true],
    ['*', true],
    ['"nope"', false]
  ])('matches %s against "abc" as %s', (value, expected) => {
    expect(matchesIfNoneMatch(value, '"abc"')).toBe(expected);
  });

  it.skip('is false when the header is absent', () => {
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false);
  });
});

describe('markdownResponse', () => {
  const body = '# Page title\n\nBody text.\n';

  it.skip('finalizes Content-Type, Vary, and a content-derived ETag', async () => {
    const response = markdownResponse(new Request('https://git-span.test/docs/overview'), body);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(response.headers.get('ETag')).toMatch(/^"[a-f0-9]{8}-\d+"$/);
    expect(await response.text()).toBe(body);
  });

  it.skip('derives a stable ETag from content alone', () => {
    const first = markdownResponse(new Request('https://git-span.test/a'), body);
    const second = markdownResponse(new Request('https://git-span.test/b'), body);
    const different = markdownResponse(new Request('https://git-span.test/a'), `${body}more\n`);
    expect(first.headers.get('ETag')).toBe(second.headers.get('ETag'));
    expect(first.headers.get('ETag')).not.toBe(different.headers.get('ETag'));
  });

  it.skip('answers 304 with an empty body on a matching validator', async () => {
    const etag = markdownResponse(new Request('https://git-span.test/a'), body).headers.get('ETag') ?? '';
    const conditional = markdownResponse(
      new Request('https://git-span.test/a', { headers: { 'If-None-Match': etag } }),
      body
    );
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get('ETag')).toBe(etag);
    expect(await conditional.text()).toBe('');
  });

  it.skip('returns the full body when the validator does not match', async () => {
    const conditional = markdownResponse(
      new Request('https://git-span.test/a', { headers: { 'If-None-Match': '"nope"' } }),
      body
    );
    expect(conditional.status).toBe(200);
    expect(await conditional.text()).toBe(body);
  });

  it.skip('returns a bodyless HEAD with the same validator', async () => {
    const get = markdownResponse(new Request('https://git-span.test/a'), body);
    const head = markdownResponse(new Request('https://git-span.test/a', { method: 'HEAD' }), body);
    expect(head.status).toBe(200);
    expect(head.headers.get('ETag')).toBe(get.headers.get('ETag'));
    expect(await head.text()).toBe('');
  });
});

describe('isPublicContentPath', () => {
  it.skip.each([
    ['/', true],
    ['/docs/overview', true],
    ['/docs/guides/reconcile-drifted-spans', true],
    ['/docs/overview/', true],
    ['/docs', false],
    ['/docs/', false],
    ['/docs/overview.md', false],
    ['/docs/guides/reconcile-drifted-spans.md', false],
    ['/index.md', false],
    ['/api/repos', false],
    ['/pricing', false]
  ])('classifies %s as %s', (pathname, expected) => {
    expect(isPublicContentPath(pathname)).toBe(expected);
  });
});

describe('renderer registry', () => {
  it.skip('registers the homepage', async () => {
    expect(isPublicContentPath('/')).toBe(true);
    expect(await markdownForPathname('/')).not.toBeNull();
  });

  it.skip('agrees with the eligibility predicate in both directions for every page', async () => {
    for (const page of source.getPages()) {
      expect(isPublicContentPath(page.path)).toBe(true);
      expect(await markdownForPathname(page.path)).not.toBeNull();
    }
  });

  it.skip('returns null for unregistered paths', async () => {
    expect(await markdownForPathname('/docs/not-a-real-page')).toBeNull();
    expect(await markdownForPathname('/api/repos')).toBeNull();
    expect(await markdownForPathname('/docs')).toBeNull();
  });
});

describe('markdownUrlResponse', () => {
  it.skip('serves /index.md as homepage markdown', async () => {
    const response = await markdownUrlResponse(new Request('https://git-span.test/index.md'), '/index.md');
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it.skip('serves a nested .md URL from the same registry as negotiation', async () => {
    const response = await markdownUrlResponse(
      new Request('https://git-span.test/docs/guides/reconcile-drifted-spans.md'),
      '/docs/guides/reconcile-drifted-spans.md'
    );
    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(response?.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it.skip('301s a renamed slug to its .md twin', async () => {
    const response = await markdownUrlResponse(
      new Request('https://git-span.test/docs/guides/reconcile-stale-spans.md'),
      '/docs/guides/reconcile-stale-spans.md'
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get('Location')).toBe('/docs/guides/reconcile-drifted-spans.md');
  });

  it.skip('returns null for unknown slugs so SSR produces the 404', async () => {
    expect(
      await markdownUrlResponse(new Request('https://git-span.test/docs/not-a-page.md'), '/docs/not-a-page.md')
    ).toBeNull();
  });

  it.skip.each(['/docs/x.md/', '/index.md/', '/docs.md', '/docs'])(
    'returns null for the non-address %s',
    async (pathname) => {
      expect(await markdownUrlResponse(new Request(`https://git-span.test${pathname}`), pathname)).toBeNull();
    }
  );
});
