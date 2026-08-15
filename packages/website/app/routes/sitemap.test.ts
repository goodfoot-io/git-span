// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { matchRoutes, type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { loader } from './sitemap.xml';
import { indexableRoutes } from '~/lib/indexable-routes';
import { SITE_URL } from '~/lib/meta';
import { RENAMED_DOC_SLUGS } from '~/lib/renamed-doc-slugs';
import routes from '~/routes';
import { expectedDocsSlugs } from '~/test/expected-docs-slugs';

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
}

describe('GET /sitemap.xml', () => {
  it('serves the XML content type', async () => {
    expect((await loader()).headers.get('content-type')).toBe('application/xml; charset=utf-8');
  });

  it('emits exactly the homepage plus every published docs page', async () => {
    // Set comparison, never ordered equality: the loader emits the page
    // registry's (alphabetical) order, while expectedDocsSlugs() is authored
    // meta.json order. Only the set is load-bearing, and reordering the loader
    // to satisfy ordered equality would reintroduce the hand-maintained list
    // this card forbids.
    const body = await (await loader()).text();
    const expected = [`${SITE_URL}/`, ...expectedDocsSlugs().map((slug) => `${SITE_URL}/docs/${slug}`)].sort();
    expect([...locs(body)].sort()).toEqual(expected);
  });

  it('includes the homepage and never the bare /docs redirect', async () => {
    const body = await (await loader()).text();
    const locations = locs(body);
    expect(locations).toContain(`${SITE_URL}/`);
    expect(locations).not.toContain(`${SITE_URL}/docs`);
  });

  it('never emits renamed (redirected) docs URLs', async () => {
    // Imported live from the rename map, so a future rename is covered
    // automatically.
    const body = await (await loader()).text();
    const locations = locs(body);
    for (const oldSlug of Object.keys(RENAMED_DOC_SLUGS)) {
      expect(locations).not.toContain(`${SITE_URL}/docs/${oldSlug}`);
    }
  });

  it('structurally excludes every machine-readable path', async () => {
    // None of the llms.txt family, and no `<path>.md` alternates, can enter:
    // the path list has exactly three sources and none of them contains these.
    const body = await (await loader()).text();
    const locations = locs(body);
    for (const forbidden of ['llms.txt', 'llms-full.txt', 'docs/llms.txt', 'docs/llms-full.txt']) {
      expect(locations).not.toContain(`${SITE_URL}/${forbidden}`);
    }
    expect(locations.filter((loc) => loc.endsWith('.md'))).toEqual([]);
  });

  it('serves the settled seven-agent robots policy from public/', () => {
    const robots = readFileSync(path.join(process.cwd(), 'public/robots.txt'), 'utf8');
    for (const crawler of [
      'GPTBot',
      'ClaudeBot',
      'OAI-SearchBot',
      'Claude-SearchBot',
      'ChatGPT-User',
      'Claude-User',
      '*'
    ]) {
      expect(robots).toContain(`User-agent: ${crawler}\nAllow: /`);
    }
    // Computed from meta.ts so the static file and the code constant cannot
    // drift.
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    expect(robots).not.toContain('Disallow:');
  });

  it('registers the sitemap route and resolves it at runtime', () => {
    // Reachability, not just table presence — the llms-resources pattern. The
    // route table is the dev RouteConfig, which the matcher accepts at
    // runtime; the cast narrows only for the type checker.
    expect(routes).toContainEqual({ path: 'sitemap.xml', file: 'routes/sitemap.xml.ts' });
    const table = routes as unknown as RouteObject[];
    const match = matchRoutes(table, '/sitemap.xml');
    const file = (match?.[0]?.route as (RouteObject & { file?: string }) | undefined)?.file;
    expect(file).toBe('routes/sitemap.xml.ts');
  });

  it('keeps every indexable route in sync with routes.ts and the sitemap', async () => {
    // Vacuously true while the array is empty; these are the pins that fire
    // when the first marketing route lands. (b) and (c) catch a leading-slash
    // declaration, which would compose to `//pricing` and resolve
    // protocol-relative to a foreign host the origin does not serve.
    const body = await (await loader()).text();
    for (const { path: routePath, file } of indexableRoutes) {
      expect(routes).toContainEqual({ path: routePath, file });
      expect(body).toContain(`<loc>${SITE_URL}/${routePath}</loc>`);
      expect(routePath.startsWith('/')).toBe(false);
      expect(routePath.endsWith('/')).toBe(false);
    }
  });
});
