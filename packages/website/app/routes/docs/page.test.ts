import type { LoaderFunctionArgs } from 'react-router';
import { describe, expect, it } from 'vitest';
import { loader } from './page';

// Every published docs URL must resolve whether or not it carries a trailing
// slash, and the two forms must settle on one canonical address. The loader's
// page lookup once dead-ended the trailing-slash form: for `overview/`,
// `urlPath.split('/')` yields ['overview', ''] and matches no page.

type Outcome = { kind: 'data'; data: Awaited<ReturnType<typeof loader>> } | { kind: 'response'; response: Response };

async function resolveDoc(urlPath: string): Promise<Outcome> {
  const args = {
    params: { '*': urlPath },
    request: new Request(`https://git-span.com/docs/${urlPath}`),
    url: new URL(`https://git-span.com/docs/${urlPath}`),
    pattern: '',
    // The loader only reads params['*']; the request, url, and pattern keep the
    // args faithful to a real route hit, while context cannot be constructed
    // meaningfully outside the router, hence the cast.
    context: {}
  } as unknown as LoaderFunctionArgs;
  try {
    return { kind: 'data', data: await loader(args) };
  } catch (error) {
    return { kind: 'response', response: error as Response };
  }
}

async function expectRedirect(urlPath: string, status: number, location: string): Promise<void> {
  const outcome = await resolveDoc(urlPath);
  expect(outcome.kind).toBe('response');
  if (outcome.kind !== 'response') return;
  expect(outcome.response.status).toBe(status);
  expect(outcome.response.headers.get('Location')).toBe(location);
}

async function expectNotFound(urlPath: string): Promise<void> {
  const outcome = await resolveDoc(urlPath);
  expect(outcome.kind).toBe('response');
  if (outcome.kind !== 'response') return;
  expect(outcome.response.status).toBe(404);
}

async function expectDocData(urlPath: string, title: string): Promise<void> {
  const outcome = await resolveDoc(urlPath);
  expect(outcome.kind).toBe('data');
  if (outcome.kind !== 'data') return;
  expect(outcome.data.title).toBe(title);
}

describe('docs loader trailing-slash resolution', () => {
  it.each([
    ['overview/', 'Introduction'],
    ['overview//', 'Introduction'],
    ['guides/mine-span-candidates/', 'Mine span candidates from history']
  ])('resolves /docs/%s', async (urlPath, title) => {
    const outcome = await resolveDoc(urlPath);
    if (outcome.kind === 'response') {
      // A permanent redirect to the canonical, slashless address is also a
      // resolution. Any other response — the 404 among them — is the bug.
      expect(outcome.response).toMatchObject({ status: 301 });
      expect(outcome.response.headers.get('Location')).toBe(`/docs/${urlPath.replace(/\/+$/, '')}`);
      return;
    }
    expect(outcome.data.title).toBe(title);
  });
});

describe('docs loader renamed-slug redirects', () => {
  it('redirects a renamed slug to its current address', async () => {
    await expectRedirect('guides/reconcile-stale-spans', 301, '/docs/guides/reconcile-drifted-spans');
  });

  it('redirects a renamed slug with a trailing slash straight to the current address', async () => {
    await expectRedirect('guides/reconcile-stale-spans/', 301, '/docs/guides/reconcile-drifted-spans');
  });

  it('redirects a renamed target with a trailing slash to the slashless address', async () => {
    await expectRedirect('guides/reconcile-drifted-spans/', 301, '/docs/guides/reconcile-drifted-spans');
  });
});

describe('docs loader bare /docs', () => {
  it.each(['', '/'])('redirects /docs%s to the overview page', async (urlPath) => {
    await expectRedirect(urlPath, 302, '/docs/overview');
  });
});

describe('docs loader unknown slugs', () => {
  it.each(['no-such-page', 'no-such-page/'])('404s /docs/%s', async (urlPath) => {
    await expectNotFound(urlPath);
  });
});

describe('docs loader canonical rendering', () => {
  it('renders a canonical slug without redirecting', async () => {
    await expectDocData('overview', 'Introduction');
  });
});
