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
  it('rewrites docs link targets to the .md representation', () => {
    expect(withMdLinks('- [Overview](/docs/overview): What git-span is.')).toBe(
      '- [Overview](/docs/overview.md): What git-span is.'
    );
  });

  it('is idempotent for already-.md targets', () => {
    const input = '- [Commands](/docs/commands.md): Every subcommand.';
    expect(withMdLinks(input)).toBe(input);
  });

  it('is idempotent for .md targets carrying a fragment', () => {
    const input = '- [Commands](/docs/commands.md#flags): Flags detail.';
    expect(withMdLinks(input)).toBe(input);
  });

  it('places .md after the slug, before any fragment or query', () => {
    expect(withMdLinks('- [Commands](/docs/commands#flags): Flags detail.')).toBe(
      '- [Commands](/docs/commands.md#flags): Flags detail.'
    );
    expect(withMdLinks('- [Commands](/docs/commands?raw=1): Raw output.')).toBe(
      '- [Commands](/docs/commands.md?raw=1): Raw output.'
    );
  });

  it('does not corrupt short slugs that collide with the link prefix', () => {
    expect(withMdLinks('- [Short](/docs/s): Short chapter.')).toBe('- [Short](/docs/s.md): Short chapter.');
    expect(withMdLinks('- [Short](/docs/oc): Short chapter.')).toBe('- [Short](/docs/oc.md): Short chapter.');
  });

  it('leaves external and non-docs links untouched', () => {
    const input = [
      '- [GitHub](https://github.com/goodfoot-io/git-span) - The source.',
      '- [Docs root](/docs): The documentation root.',
      '- [Other](/other/path): Not a docs page.'
    ].join('\n');
    expect(withMdLinks(input)).toBe(input);
  });
});

describe('collectPageNodes', () => {
  it('emits pages in order with a folder index before its children and separators skipped', () => {
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
  it('yields the real pages in the authored meta.json order', () => {
    const urls = collectPageNodes(source.pageTree.children).map((node) => source.getNodePage(node)?.url);
    expect(urls).toEqual(expectedDocsSlugs().map((slug) => `/docs/${slug}`));
  });
});

describe('renderDocsCorpus', () => {
  it('opens with the overview chapter and its description preamble', async () => {
    const corpus = await renderDocsCorpus();
    const overview = source.getPage(['overview']);
    expect(overview).toBeDefined();
    if (!overview) return;
    expect(
      corpus.startsWith(`---\ndescription: "${overview.data.description}"\n---\n\n# Introduction (${overview.url})`)
    ).toBe(true);
  });

  it('contains all ten chapter headers in authored order', async () => {
    const corpus = await renderDocsCorpus();
    const headers = [...corpus.matchAll(/^# .+ \((\/docs\/[^)]+)\)$/gm)].map((match) => match[1]);
    expect(headers).toEqual(expectedDocsSlugs().map((slug) => `/docs/${slug}`));
  });
});
