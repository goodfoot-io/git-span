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
