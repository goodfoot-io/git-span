// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { llms } from 'fumadocs-core/source/llms';
import { describe, expect, it } from 'vitest';
import { loader as docsIndexLoader } from './docs.llms.txt';
import { loader as docsFullLoader } from './docs.llms-full.txt';
import { loader as rootMapLoader } from './llms.txt';
import { loader as rootFullLoader } from './llms-full.txt';
import { renderDocsCorpus, withMdLinks } from '~/lib/llms-resources';
import { SITE_URL } from '~/lib/meta';
import { source } from '~/lib/source';
import routes from '~/routes';

/**
 * The expected docs slug list in authored reading order, derived from the
 * same meta.json files that drive the page tree — independent of Fumadocs, so
 * the contract pins authored order rather than whatever the loader emits.
 */
function expectedDocsSlugs(): string[] {
  const root = JSON.parse(readFileSync(path.join(process.cwd(), 'content/docs/meta.json'), 'utf8')) as {
    pages: string[];
  };
  const guides = JSON.parse(readFileSync(path.join(process.cwd(), 'content/docs/guides/meta.json'), 'utf8')) as {
    pages: string[];
  };
  return root.pages.flatMap((slug) => (slug === 'guides' ? guides.pages.map((child) => `guides/${child}`) : [slug]));
}

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
});

describe('GET /llms.txt — root system map', () => {
  it.skip('serves text/plain and opens with the system one-liner', async () => {
    const res = rootMapLoader();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toMatch(/^# git-span\n\n> .+/);
  });

  it.skip('carries the five annotated sections', async () => {
    const body = await rootMapLoader().text();
    for (const section of ['## Start here', '## Source', '## CLI', '## Agent integrations', '## Optional']) {
      expect(body).toContain(section);
    }
  });

  it.skip('annotates every advertised URL with a description', async () => {
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

  it.skip('stays a map: no individual chapter paths', async () => {
    const body = await rootMapLoader().text();
    for (const forbidden of ['/docs/overview', '/docs/ci', '/docs/reference', '/docs/guides/']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('GET /docs/llms.txt — docs index', () => {
  it.skip('serves text/plain', async () => {
    const res = docsIndexLoader();
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it.skip('equals the live generator output with .md link targets', async () => {
    expect(await docsIndexLoader().text()).toBe(withMdLinks(llms(source).index()));
  });

  it.skip('points every docs link target at the .md representation', async () => {
    const body = await docsIndexLoader().text();
    const targets = [...body.matchAll(/\]\(\/docs\/[^)]+\)/g)].map((match) => match[0]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target).toMatch(/\]\(\/docs\/.+\.md\)$/);
    }
  });

  it.skip('lists the ten chapters in authored meta.json order', async () => {
    const body = await docsIndexLoader().text();
    const targets = [...body.matchAll(/\]\(\/docs\/([^)]+)\)/g)].map((match) => match[1]);
    expect(targets).toEqual(expectedDocsSlugs());
  });
});

describe('full corpus', () => {
  it.skip('serves both full files as text/plain', async () => {
    expect((await docsFullLoader()).headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect((await rootFullLoader()).headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it.skip('composes the root full file from the homepage and the one shared corpus', async () => {
    const rootBody = await (await rootFullLoader()).text();
    const corpus = await renderDocsCorpus();
    expect(rootBody.startsWith('# Agents should read between the lines.')).toBe(true);
    expect(rootBody.endsWith(corpus)).toBe(true);
  });

  it.skip('emits corpus chapters in the same order as the index', async () => {
    const indexBody = withMdLinks(llms(source).index());
    const corpus = await renderDocsCorpus();
    const indexSlugs = [...indexBody.matchAll(/\]\(\/docs\/([^)]+)\)/g)].map((match) => match[1]);
    const corpusSlugs = [...corpus.matchAll(/^# .+ \((\/docs\/[^)]+)\)$/gm)].map((match) =>
      match[1].replace(/^\/docs\//, '')
    );
    expect(corpusSlugs).toEqual(indexSlugs);
  });
});
