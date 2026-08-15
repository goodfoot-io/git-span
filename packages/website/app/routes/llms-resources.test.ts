// @vitest-environment node
import type { Item } from 'fumadocs-core/page-tree';
import { llms } from 'fumadocs-core/source/llms';
import { matchRoutes, type RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { loader as docsIndexLoader } from './docs.llms.txt';
import { loader as docsFullLoader } from './docs.llms-full.txt';
import { loader as rootMapLoader } from './llms.txt';
import { loader as rootFullLoader } from './llms-full.txt';
import { renderChapter, renderDocsCorpus, withMdLinks } from '~/lib/llms-resources';
import { SITE_URL } from '~/lib/meta';
import { source } from '~/lib/source';
import routes from '~/routes';
import { expectedDocsSlugs } from '~/test/expected-docs-slugs';

describe('route precedence', () => {
  it('registers both docs-scope resources above the docs splat', () => {
    const splat = routes.findIndex((r) => r.path === 'docs/*' && r.file === 'routes/docs/page.tsx');
    const index = routes.findIndex((r) => r.path === 'docs/llms.txt' && r.file === 'routes/docs.llms.txt.ts');
    const full = routes.findIndex((r) => r.path === 'docs/llms-full.txt' && r.file === 'routes/docs.llms-full.txt.ts');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(full).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(splat);
    expect(full).toBeLessThan(splat);
  });

  it('matches the docs-scope resources ahead of the splat at runtime', () => {
    // React Router ranks static segments above the splat regardless of table
    // order; the outcome is the behavior that must not regress, so pin it.
    // The route table is the dev RouteConfig, which the matcher accepts at
    // runtime — the cast narrows only for the type checker.
    const table = routes as unknown as RouteObject[];
    const fileOf = (match: ReturnType<typeof matchRoutes>): string | undefined =>
      (match?.[0]?.route as (RouteObject & { file?: string }) | undefined)?.file;
    expect(fileOf(matchRoutes(table, '/docs/llms.txt'))).toBe('routes/docs.llms.txt.ts');
    expect(fileOf(matchRoutes(table, '/docs/llms-full.txt'))).toBe('routes/docs.llms-full.txt.ts');
  });
});

describe('GET /llms.txt — root system map', () => {
  it('serves text/plain and opens with the system one-liner', async () => {
    const res = rootMapLoader();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toMatch(/^# git-span\n\n> .+/);
  });

  it('carries the five annotated sections', async () => {
    const body = await rootMapLoader().text();
    for (const section of ['## Start here', '## Source', '## CLI', '## Agent integrations', '## Optional']) {
      expect(body).toContain(section);
    }
  });

  it('annotates every advertised URL with a description', async () => {
    const body = await rootMapLoader().text();
    const urls = [
      `${SITE_URL}/docs/llms.txt`,
      'https://github.com/goodfoot-io/git-span',
      `${SITE_URL}/docs/getting-started.md`,
      `${SITE_URL}/docs/commands.md`,
      `${SITE_URL}/docs/agent-integration.md`,
      `${SITE_URL}/docs/concepts.md`,
      `${SITE_URL}/docs/llms-full.txt`
    ];
    for (const url of urls) {
      expect(body).toMatch(new RegExp(`\\[.+\\]\\(${url.replace(/\./g, '\\.')}\\) - .+`));
    }
  });

  it('stays a map: no individual chapter paths', async () => {
    const body = await rootMapLoader().text();
    for (const forbidden of ['/docs/overview', '/docs/ci', '/docs/reference', '/docs/guides/']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('links only chapters that resolve in the live page registry', async () => {
    const body = await rootMapLoader().text();
    const slugs = [...body.matchAll(/\]\([^)]*\/docs\/([^)]+)\.md\)/g)].map((match) => match[1]);
    expect(slugs.length).toBe(4);
    for (const slug of slugs) {
      expect(source.getPage(slug.split('/'))).toBeDefined();
    }
  });
});

describe('GET /docs/llms.txt — docs index', () => {
  it('serves text/plain', async () => {
    const res = docsIndexLoader();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('equals the live generator output with .md link targets', async () => {
    expect(await docsIndexLoader().text()).toBe(withMdLinks(llms(source).index()));
  });

  it('points every docs link target at the .md representation', async () => {
    const body = await docsIndexLoader().text();
    const targets = [...body.matchAll(/\]\(\/docs\/[^)]+\)/g)].map((match) => match[0]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target).toMatch(/\]\(\/docs\/.+\.md\)$/);
    }
  });

  it('lists the ten chapters in authored meta.json order', async () => {
    const body = await docsIndexLoader().text();
    const targets = [...body.matchAll(/\]\(\/docs\/([^)]+)\)/g)].map((match) => match[1].replace(/\.md$/, ''));
    expect(targets).toEqual(expectedDocsSlugs());
  });
});

describe('full corpus', () => {
  it('serves both full files as text/plain', async () => {
    expect((await docsFullLoader()).headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect((await rootFullLoader()).headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('composes the root full file from the homepage and the one shared corpus', async () => {
    const rootBody = await (await rootFullLoader()).text();
    const corpus = await renderDocsCorpus();
    expect(rootBody.startsWith('# Agents should read between the lines.')).toBe(true);
    expect(rootBody.endsWith(corpus)).toBe(true);
  });

  it('emits corpus chapters in the same order as the index', async () => {
    const indexBody = withMdLinks(llms(source).index());
    const corpus = await renderDocsCorpus();
    const indexSlugs = [...indexBody.matchAll(/\]\(\/docs\/([^)]+)\)/g)].map((match) => match[1].replace(/\.md$/, ''));
    const corpusSlugs = [...corpus.matchAll(/^# .+ \((\/docs\/[^)]+)\)$/gm)].map((match) =>
      match[1].replace(/^\/docs\//, '')
    );
    expect(corpusSlugs).toEqual(indexSlugs);
  });

  it('fails a chapter closed with a 500 naming the chapter when it cannot render', async () => {
    const missing: Item = { type: 'page', name: 'Missing', url: '/docs/nonexistent' };
    const error = await renderChapter(missing).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Response);
    if (!(error instanceof Response)) throw new Error('expected a Response rejection');
    expect(error.status).toBe(500);
    expect(await error.text()).toContain('/docs/nonexistent');
  });
});
