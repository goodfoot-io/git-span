import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Folder, Item, Node, Separator } from 'fumadocs-core/page-tree';
import { describe, expect, it } from 'vitest';
import { collectPageNodes, renderDocsCorpus, withMdLinks } from '~/lib/llms-resources';
import { source } from '~/lib/source';

/**
 * The expected docs slug list in authored reading order, derived from the
 * same meta.json files that drive the page tree — independent of Fumadocs, so
 * the contract pins authored order rather than whatever the loader emits. The
 * `guides` entry expands to its nested meta.json's pages in place.
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

function page(name: string, url: string): Item {
  return { type: 'page', name, url };
}

function folder(name: string, children: Node[], index?: Item): Folder {
  return { type: 'folder', name, children, ...(index ? { index } : {}) };
}

const separator: Separator = { type: 'separator', name: 'More' };

describe('withMdLinks', () => {
  it.skip('rewrites docs link targets to the .md representation', () => {
    expect(withMdLinks('- [Overview](/docs/overview): What git-span is.')).toBe(
      '- [Overview](/docs/overview.md): What git-span is.'
    );
  });

  it.skip('is idempotent for already-.md targets', () => {
    const input = '- [Commands](/docs/commands.md): Every subcommand.';
    expect(withMdLinks(input)).toBe(input);
  });

  it.skip('leaves external and non-docs links untouched', () => {
    const input = [
      '- [GitHub](https://github.com/goodfoot-io/git-span) - The source.',
      '- [Docs root](/docs): The documentation root.',
      '- [Other](/other/path): Not a docs page.'
    ].join('\n');
    expect(withMdLinks(input)).toBe(input);
  });
});

describe('collectPageNodes', () => {
  it.skip('emits pages in order with a folder index before its children and separators skipped', () => {
    const fixture: Node[] = [
      page('Alpha', '/docs/alpha'),
      separator,
      folder(
        'Nested',
        [page('Nested B', '/docs/nested/b'), page('Nested A', '/docs/nested/a')],
        page('Nested index', '/docs/nested')
      ),
      page('Zeta', '/docs/zeta')
    ];
    expect(collectPageNodes(fixture).map((node) => node.url)).toEqual([
      '/docs/alpha',
      '/docs/nested',
      '/docs/nested/b',
      '/docs/nested/a',
      '/docs/zeta'
    ]);
  });
});

describe('docs corpus order', () => {
  it.skip('yields the real pages in the authored meta.json order', () => {
    const urls = collectPageNodes(source.pageTree.children).map((node) => source.getNodePage(node)?.url);
    expect(urls).toEqual(expectedDocsSlugs().map((slug) => `/docs/${slug}`));
  });
});

describe('renderDocsCorpus', () => {
  it.skip('opens with the overview chapter', async () => {
    const corpus = await renderDocsCorpus();
    expect(corpus.startsWith('# Introduction (/docs/overview)')).toBe(true);
  });

  it.skip('contains all ten chapter headers in authored order', async () => {
    const corpus = await renderDocsCorpus();
    const headers = [...corpus.matchAll(/^# .+ \((\/docs\/[^)]+)\)$/gm)].map((match) => match[1]);
    expect(headers).toEqual(expectedDocsSlugs().map((slug) => `/docs/${slug}`));
  });
});
